'use strict';

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var glob = require('glob');

var util = require('./util.js');

var logger = null;

var ServiceManagerConfig = function () {
  // var appName = this._config.appName || this._defaultAppName;
  function ServiceManagerConfig(appName, $logger, config) {
    (0, _classCallCheck3.default)(this, ServiceManagerConfig);

    this._appName = appName;
    this._config = config;
    if (!this._config) {
      this._config = {};
    }

    logger = util.logger({ name: 'ServicesConfig' }, $logger);
    this._normalize();
  }

  (0, _createClass3.default)(ServiceManagerConfig, [{
    key: 'get',
    value: function get() {
      return this._config;
    }
  }, {
    key: '_normalize',
    value: function _normalize() {
      // copy to be applied to _config
      var config = this._config;
      if (_.isArray(config) || _.isObject(config)) {
        config = _.cloneDeep(this._config);
      }

      // setup normalized object
      this._config = {
        services: {}
      };

      // if array
      if (_.isArray(config)) {
        config.forEach(this._normalizeService.bind(this));
      } else if (_.isObject(config) && config.hasOwnProperty('services')) {
        // has sub services
        _.forEach(config.services, function (service, key) {
          if (!service.hasOwnProperty('name')) {
            service.name = key;
          }

          this._normalizeService(service);
        }.bind(this));
      }
      // if string or object
      else if (_.isString(config) || _.isObject(config)) {
          this._normalizeService(config);
        } else {
          logger.error('Invalid config type:', config);
        }

      // TODO: add to verbose
      // logger.info("normalize service config:", JSON.stringify(this._config, null, 2));
    }
  }, {
    key: '_normalizeService',
    value: function _normalizeService(service) {
      var key = this._appName;
      var defaultService = {
        config: {},
        options: {},
        preRoutes: {},
        routes: [],
        directory: { service: 'lib', controllers: '', resolvers: '', views: '', static: '' }
      };

      // -----------------------------------------------
      if (_.isString(service)) {
        key = service;
        service = defaultService;
        //
        service.name = key;
        service.directory.service = key;
      } else if (_.isObject(service)) {
        if (service.hasOwnProperty('name')) {
          key = service.name;
          defaultService.directory.service = service.name;
        } else {
          service.name = key;
        }

        if (service.hasOwnProperty('directory') && _.isString(service.directory)) {
          defaultService.directory.service = service.directory;
          service.directory = defaultService.directory;
        }

        service = _.merge(defaultService, service);
      } else {
        logger.warn('Invalid service type:', service);
      }
      // -----------------------------------------------

      // check if service.directories exists
      // find dir for each type
      _.forEach(service.directory, function (dir, d) {
        // logger.info("d:", d, ", key:", key, ", directory:", service.directory[d], ", directory.service:", service.directory.service);
        service.directory[d] = this._findDir(d, service.directory[d], key, service.directory.service);
        // logger.info("found directory:", service.directory[d]);

        if (!service.directory[d]) {
          logger.info('Could not find ' + d + ' dir in App dir (' + process.cwd() + ')');
          // service.directory[d] = service.name;
          // if not, set to current working dir
          service.directory[d] = process.cwd();
        }
      }.bind(this));

      // ----------------------------------------
      // TODO: load controllers first
      // ----------------------------------------

      // if config does not contain routes
      // try to load a routes file using app name
      if (!service.hasOwnProperty('routes') || !(_.isArray(service.routes) && service.routes.length)) {
        try {
          // use directory as root to look for routes file
          var fileSearchPath = path.resolve(process.cwd(), service.directory.service) + path.sep + '**' + path.sep + service.name + '.routes.js';
          // logger.log("fileSearchPath:", fileSearchPath);
          var globs = glob.sync(fileSearchPath);
          // logger.log("globs list:", globs);

          // remove all node_modules
          globs = util.filterNodeModules(globs);
          // logger.log("globs after filter:", globs);

          if (globs.length === 0) {
            logger.info('Could not find a routes files and service defined (%s)', fileSearchPath);
          }
          // TODO: also check the controllers didn't have routes defined
          else if (globs.length > 1) {
              logger.warn('More than one route file found', globs);
            }

          if (globs.length === 1) {
            var file = path.resolve(globs[0]);
            service.routes = require(file);
          }
        } catch (err) {
          logger.warn('Could not load routes files.', err);
          return;
        }
      }

      // -----------------------------------------------
      if (this._config.services.hasOwnProperty(key)) {
        logger.warn('Service already in services:', key);
      }

      // logger.log("normalize service:", JSON.stringify(service, null, 2));
      this._config.services[key] = service;
    }

    // directory default: "lib/<service key name in service list>"

  }, {
    key: '_findDir',
    value: function _findDir(type, configDirectory, serviceName, serviceDir) {
      // check if configDir is set, a string and not empty
      if (configDirectory && _.isString(configDirectory) && configDirectory.length > 0) {
        // add cwd, if need be
        configDirectory = path.resolve(configDirectory);
        if (fs.existsSync(configDirectory)) {
          return configDirectory;
        }
      }

      // find it
      var file = '';
      var globs = null;
      if (type === 'service') {
        // look for service/app file
        file = path.sep + 'service.' + serviceName + '.js';
        globs = glob.sync('**' + file);

        // remove all node_modules
        globs = util.filterNodeModules(globs);

        // check if file exists
        if (globs.length > 0) {
          if (globs.length > 1) {
            logger.warn('More than one service file found', globs);
          }
          // dirname removes files from results
          return path.dirname(process.cwd() + path.sep + globs[0]);
        }

        file = path.sep + serviceName + '.js';
        globs = glob.sync('**' + file);
        // remove all node_modules
        globs = util.filterNodeModules(globs);

        // check if file exists
        if (globs.length > 0) {
          if (globs.length > 1) {
            logger.warn('More than one service file found', globs);
          }
          // dirname removes files from results
          return path.dirname(process.cwd() + path.sep + globs[0]);
        }

        // default "<cwd>/<service.dir>/lib"
        return process.cwd() + path.sep + 'lib';
      } else {
        // start in service dir
        globs = glob.sync(serviceDir + path.sep + '**' + path.sep + type);
        // remove all node_modules
        globs = util.filterNodeModules(globs);

        // check if file exists
        if (globs.length > 0) {
          if (globs.length > 1) {
            logger.warn('More than one service file found', globs);
          }
          return globs[0];
        }

        // default "<service.directory>/<type>"
        return serviceDir + path.sep + type;
      }
    }
  }]);
  return ServiceManagerConfig;
}();

module.exports = ServiceManagerConfig;