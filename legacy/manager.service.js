'use strict';

/**
 * Manager for Services
 *
 */

var _create = require('babel-runtime/core-js/object/create');

var _create2 = _interopRequireDefault(_create);

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var fs = require('fs');
var path = require('path');
//
var _ = require('lodash');
var when = require('when');
var di = require('di');
var glob = require('glob');
var stack = require('callsite');

var util = require('./util.js');
var defaultAppService = require('./default.service.app.js');
//
var ServiceManagerConfig = require('./manager.service.config.js'); // Normalize Service Configs
var ServiceRouter = require('./router.service.js');
var ResourceManager = require('./manager.resource.js');

var logger = null;

module.exports = ServiceManager;

/** ---------------------------------------------------
 * Public Functions
 * --------------------------------------------------- */
// class Service {
//     /**
//      * initialize service
//      */
//   init () {
//         // TODO
//   }

//     /**
//      * load service routes into http framework
//      */
//   load () {
//         // TODO
//   }

//     /**
//      * adds route to http framework
//      * @param routeConfig
//      */
//   addRoute (routeConfig) {
//         // TODO
//   }
// }

// class _ServiceManager {
//     /**
//      * initialize services
//      * load config
//      * normalize service configs
//      * check files exist
//      * any prep before loading the service into the http framework
//      */
//   init () {
//         // TODO

//         // load service plugins
//         //   - dynamic (api)
//         //   - template (view)
//         //   - static
//         //   - redirect
//         //   - otherwise
//         //   - auth
//         //   - ...
//   }

//     /**
//      * load services routes into http framework
//      * mostly a config to -> addService helper
//      */
//   load () {
//         // TODO
//   }

//     /**
//      * adds a service to the manager
//      * adds all routes defined in the config to http framework
//      * @param serviceConfig
//      * @returns Service Object
//      */
//   add (serviceConfig) {
//         // TODO
//   }

//     /**
//      * get Service Object from serviceId
//      * @param serviceId
//      * @returns Service Object
//      */
//   get (serviceId) {
//         // TODO
//   }
// }

/* ---------------------------------------------------
 * Constructor
 * --------------------------------------------------- */
function ServiceManager(hyperCore, appConfig, servicesManifest, middleware, serviceMiddlewareManager, httpFramework, defaultAppName) {
  var serviceManagerConfig = appConfig.serviceManager;
  this._displayDebuggerInfo = serviceManagerConfig.displayDebuggerInfo;
  this._hyperCore = hyperCore;
  // TODO: remove this after DI in it's own lib
  this._httpFramework = httpFramework;

  // Init Service Router
  this._serviceRouter = new ServiceRouter({
    port: this._httpFramework.port(),
    protocol: this._httpFramework.protocol()
  }, this._hyperCore.logger());

  // TODO: add statsD to middleware as plugin
  // this.stats     = new util.Stats(this.options, "ServiceManager");
  logger = util.logger({ name: '~Services' }, this._hyperCore.logger());

  var manifest = new ServiceManagerConfig(defaultAppName, this._hyperCore.logger(), servicesManifest); // normalizes the configs
  this._servicesManifest = manifest.get();
  this._servicesManifest.shared = appConfig.shared;

  var servicesConfigs = {};
  _.forEach(this._servicesManifest.services, function (service, key) {
    service.config = _.merge(service.config, appConfig[key] || {});
    servicesConfigs[key] = service.config;
  });
  this._serviceRouter.config(servicesConfigs);

  this._services = {};
  // all service wide resoueces
  // TODO: remove this in next major version
  this._resources = new ResourceManager(this, null, logger);

  this._loading = false;

  this._serviceMiddlewareManager = serviceMiddlewareManager;
  this._serviceMiddlewareManager.init(logger, httpFramework, middleware, this);
  // this._serviceMiddlewareManager = new ServiceMiddlewareManager(logger, httpFramework, middleware, this);
  // this._serviceMiddlewareManager.add('defaultRoutes');
  // this._serviceMiddlewareManager.add('apiviewRoutes');
}

/* ---------------------------------------------------
 * Public Functions
 * --------------------------------------------------- */
ServiceManager.prototype.env = function (env) {
  return this._hyperCore.env(env);
};

ServiceManager.prototype.getServiceRouter = function () {
  return this._serviceRouter;
};

// load all services
ServiceManager.prototype.loadHttpFramework = function () {
  return this._httpFramework.load();
};

// load all services
ServiceManager.prototype.loadServices = function () {
  this._loading = true;
  return this._loadServices().then(function (result) {
    this._loading = false;
    return result;
  }.bind(this));
};

ServiceManager.prototype.isLoading = function () {
  return this._loading;
};

ServiceManager.prototype.addToLoadingQ = function (service, promise) {
  service._promiseQueue.push(promise);
};

ServiceManager.prototype._loadServices = function () {
  logger.group('Loading All Services...');

  var serviceList = _.values(this._servicesManifest.services);
  serviceList.reverse();
  serviceList.push({});

  return when.reduceRight(serviceList, function (notUsed, serviceManifest, index) {
    var service = this._services[serviceManifest.name] = {
      name: serviceManifest.name,
      config: serviceManifest.config || {},
      options: serviceManifest.options || {},
      module: serviceManifest.module || {},
      routes: serviceManifest.routes || {},
      preRoutes: serviceManifest.preRoutes || {},
      controller: serviceManifest.controller || {},
      directory: serviceManifest.directory || {
        service: '',
        controllers: '',
        resolvers: '',
        views: '',
        static: ''
      },
      resolver: {}
    };
    service._promiseQueue = [];

    service.logger = util.logger({ name: service.name }, logger);
    service.resources = new ResourceManager(this, service, service.logger);

    // add service to service router
    this._serviceRouter.add(service.name);

    // module default: "./<directory>/<service name>.js"
    if (!serviceManifest.module) {
      service.module = this._loadServiceFile(service.name, service.directory.service);

      if (!service.module || !_.isFunction(service.module)) {
        // use default
        service.module = defaultAppService;
      }
    }

    // create instance of module
    if (service.module) {
      service.logger.group('Loading Service...');

      var module = {
        '$resource': ['value', service.resources],
        '$logger': ['value', service.logger]
      };

      if (service && service.hasOwnProperty('options')) {
        module.$options = ['value', service.options];
      }

      var InjectedModule = this.injectionDependency(module, service, service);
      service.instance = new InjectedModule();

      if (_.isFunction(service.instance.$init)) {
        service.logger.info('Initializing...');
        try {
          var result = this.injectionDependency(module, service, service.instance, service.instance.$init);

          // is promise
          if (_.isObject(result) && _.isFunction(result.then)) {
            service._promiseQueue.push(result);
          }
        } catch (err) {
          service.logger.error('Initializing Service Error:', err);
          return when.reject(err);
        }
      }

      // create instance of module
      if (service.module && service.preRoutes && _.isFunction(service.preRoutes)) {
        service.logger.group('Loading PreRoutes...');
        // DI invoke preRoutes
        this.injectionDependency({}, service, service, service.preRoutes);
        service.logger.groupEnd(' ');
      }

      var p;
      if (service.module) {
        service.logger.group('Loading Setup Routes...');
        // setup service routes
        p = this._setupRoutes(service);
        service._promiseQueue.push(p);
        service.logger.groupEnd(' ');
      }

      if (serviceManifest.resources) {
        p = service.resources.load(serviceManifest.resources);
        service._promiseQueue.push(p);
      }

      // wait for Q'd resources to resolve before letting service resolve
      if (service._promiseQueue.length) {
        // service.logger.info("Wait for Setup...");

        // TODO: need timeout in case resource promise never resolves
        return when.all(service._promiseQueue).then(function () {
          delete service._promiseQueue;
          // service.logger.info("Route Setup Complete");
          service.logger.groupEnd(' ');
        });
      } else {
        service.logger.groupEnd(' ');
        return 1;
      }
    }

    if (this._displayDebuggerInfo) {
      service.logger.info('services["%s"]: %s', serviceManifest.name, (0, _stringify2.default)(service, null, 2));
    }
  }.bind(this)).then(function (result) {
    logger.groupEnd('Done Loading All Services');
    return result;
  });
};

ServiceManager.prototype.addResource = function () {
  var _resources;

  // find service
  return (_resources = this._resources).add.apply(_resources, arguments);
};

// run all post start init on services
ServiceManager.prototype.postStartInit = function () {
  logger.group('Running All Post Start Inits...');

  var serviceList = _.values(this._services);
  serviceList.reverse();
  serviceList.push({});

  return when.reduceRight(serviceList, function (notUsed, service) {
    var result = null;
    service.logger.group('Running Post Start Init...');

    service._promiseQueue = [];

    if (service.instance && _.isFunction(service.instance.$postStartInit)) {
      try {
        result = this.injectionDependency(module, service, service.instance, service.instance.$postStartInit);

        // is promise
        if (_.isObject(result) && _.isFunction(service._promiseQueue.then)) {
          service._promiseQueue.push(result);
        }
      } catch (err) {
        service.logger.error('Post Start Init Service Error:', err);
        return when.reject(err);
      }
    }

    //
    result = service.resources.postStartInit();
    service._promiseQueue.push(result);

    // wait for Q'd resources to resolve before letting service resolve
    if (service._promiseQueue.length) {
      service.logger.info('Wait Post Start Init...');

      // TODO: need timeout in case resource promise never resolves
      return when.all(service._promiseQueue).then(function () {
        delete service._promiseQueue;

        service.logger.info('Loaded');
        service.logger.groupEnd(' ');
      });
    } else {
      service.logger.groupEnd(' ');

      return 1;
    }
  }.bind(this)).then(function (result) {
    logger.groupEnd('Done Running All Post Start Inits');
    return result;
  });
};

ServiceManager.prototype._loadFile = function (type, key, directory) {
  var file = '';

  // try to loading service file
  file = directory + path.sep + key + '.js';
  file = path.join(process.cwd(), file);
  // logger.info('Trying to load:', file);

  // check if file exists
  if (fs.existsSync(file)) {
    try {
      return require(file);
    } catch (err) {
      // this is ok
    }
  } else {
    // try to loading service file
    file = directory + path.sep + type + '.' + key + '.js';
    file = path.join(process.cwd(), file);
    // logger.info('Trying to load:', file);

    // check if file exists
    if (fs.existsSync(file)) {
      try {
        return require(file);
      } catch (err) {
        // this is ok
      }
    }
  }

  return null;
};

/* ---------------------------------------------------
 * Private Functions
 * --------------------------------------------------- */

ServiceManager.prototype._setupRoutes = function (service) {
  return when.reduce(service.routes, function (notUsed, route) {
    // return controller created or from cache
    var controller = this._setupController(service, route);
    if (this._displayDebuggerInfo) {
      logger.info('Controller:', (0, _stringify2.default)(controller, null, 2));
    }

    // Setup Resolver, if they exist
    route.resolve = this._setupResolver(service, route);

    // switch based on the properties
    var p = null;
    if (this._serviceMiddlewareManager.hasHandler(route)) {
      p = this._serviceMiddlewareManager.setup(service, controller, route);
    } else {
      logger.warn('Service "' + service.name + '" has invalid route', route);
    }

    // if 'p' null then return resolved promise
    return p || when.resolve();
  }.bind(this), 0);
};

// TODO: move this to it's own class
ServiceManager.prototype._setupController = function (service, route) {
  var controller;
  var controllerName = service.name;

  // no controller, this is ok
  // create default controller
  if (!route.controller) {
    if (this._displayDebuggerInfo) {
      logger.info('Controller missing for', service.name);
    }

    service.controller[controllerName] = {
      name: controllerName,
      config: service.config,
      module: function module() {},
      instance: function instance() {}
    };
    service.controller[controllerName].instance.config = service.config;

    return service.controller[controllerName];
  } else if (_.isString(route.controller)) {
    controllerName = route.controller;
  } else if (_.isObject(route.controller) && route.controller.hasOwnProperty('name')) {
    controllerName = route.controller.name;
  }

  if (service.controller[controllerName]) {
    if (service.controller[controllerName].instance) {
      // controller already loaded
      return service.controller[controllerName];
    }
  } else {
    // create one, required data should be filled in the section below
    service.controller[controllerName] = {};
  }

  service.logger.group('Loading Controller: ' + controllerName + ' ...');
  // if no controller loaded already
  if (_.keys(service.controller[controllerName]).length === 0) {
    if (_.isString(route.controller)) {
      // try to load controller as file
      var file = route.controller;
      controller = null;
      if (fs.existsSync(file)) {
        try {
          controller = require(file);
        } catch (err) {
          service.logger.error('Loading Controller (' + route.controller + ') Error:', err);
        }
      }

      if (!controller) {
        // controller default: "<service.directory>/controllers/<controller>.js"
        file = path.normalize(service.directory.controllers + path.sep + route.controller + '.js');
        // logger.log("setupController file:", file);
        if (fs.existsSync(file)) {
          // need to add the current cwd because require is relative to this file
          try {
            controller = require(file);
          } catch (err) {
            service.logger.error('Loading Controller (' + route.controller + ') Error:', err);
          }
        }
      }

      if (!controller) {
        // error
        service.logger.warn('Controller (' + route.controller + ') invalid');
        return;
      } else {
        service.controller[controllerName].module = controller;
        service.logger.groupEnd('Loaded Controller: ' + controllerName);
      }
    } else if (_.isObject(route.controller)) {
      if (route.controller.hasOwnProperty('module') && route.controller.hasOwnProperty('instance')) {
        service.controller[controllerName] = route.controller;
      } else {
        service.controller[controllerName].module = route.controller;
      }
    } else {
      // error
      service.logger.warn('Controller (' + route.controller + ') invalid');
      return;
    }
  }

  // if controller does not have a config then pass service along
  if (!service.controller[controllerName].hasOwnProperty('config')) {
    service.controller[controllerName].config = service.config;
  }

  // make sure controller has name
  if (!service.controller[controllerName].name) {
    service.controller[controllerName].name = controllerName;
  }

  if (service.controller[controllerName].instance === null || service.controller[controllerName].instance === undefined) {
    if (_.isFunction(service.controller[controllerName].module)) {
      var module = {
        '$service': ['value', service.instance],
        '$options': ['value', service.options[controllerName]],
        '$logger': ['value', service.logger]
      };

      var InjectedModule = this.injectionDependency(module, service, service.controller[controllerName]);

      service.controller[controllerName].instance = new InjectedModule();
      // service.controller[controllerName].instance = new controller();
    } else {
      service.controller[controllerName].instance = controller;
    }
  }

  return service.controller[controllerName];
};

/**
 * Inject Dependancies
 * TODO: move this to it's own lib
 * @param module
 * @param service
 * @param parent
 * @param func
 * @returns {*}
 * @private
 */
ServiceManager.prototype.injectionDependency = function (module, service, parent, func) {
  var rKey = null;
  var resources = null;

  // ---------------------------------------
  // injection dependency to Controller function
  // NOTE: di does not work when you use cFunc.bind(...) as it hides the function arguments
  module = _.merge({
    '$logger': ['value', logger],
    '$q': ['value', when],
    '_': ['value', _],
    '$hyper': ['value', this._hyperCore],
    '$services': ['value', this._serviceRouter],
    '$http': ['value', this._httpFramework],
    '$sharedConfig': ['value', this._servicesManifest.shared]
  }, module);

  if (parent && parent.hasOwnProperty('config')) {
    module.$config = ['value', parent.config];
  } else if (service && service.hasOwnProperty('config')) {
    module.$config = ['value', service.config];
  }

  // TODO: do we need this???
  // add all _resources to list for DI
  resources = this._resources.getAllInstances();
  for (rKey in resources) {
    module[rKey] = ['value', resources[rKey]];
  }

  // add all service.resources to list for DI
  if (service) {
    resources = service.resources.getAllInstances();
    for (rKey in resources) {
      module[rKey] = ['value', resources[rKey]];
    }
  }

  // creates injector
  var injector = new di.Injector([module]);

  // run function
  if (func) {
    if (parent) {
      return injector.invoke(func, parent);
    } else {
      return injector.invoke(func);
    }
  } else {
    if (parent) {
      if (parent.module.toString().indexOf('function') === 0) {
        var InjectedWrapper = function InjectedWrapper() {
          return injector.invoke(parent.module, this);
        };
        // InjectedWrapper.prototype = _.merge(InjectedWrapper.prototype, parent.module.prototype);
        InjectedWrapper.prototype = (0, _create2.default)(parent.module.prototype);

        return InjectedWrapper;
      } else {
        return injector.invoke(parent.module, this);
      }
    }
  }
  // ---------------------------------------
};

// TODO: remove this in next major version
ServiceManager.prototype._setupResolver = function (service, route) {
  var resolve = {};

  if (!route.resolve) {
    // no resolver, this is ok
    return;
  } else if (!_.isObject(route.resolve)) {
    logger.warn('Service "' + service.name + '" resolver (' + route.resolve + ') invalid');
    return;
  }

  _.forEach(route.resolve, function (resolver, resolverBindName) {
    var resolverName = 'defaultResolver';
    var resolverFile = null;
    var ResolverClass = null;

    if (_.isString(resolver)) {
      resolverName = resolver;
      resolverFile = resolverName + '.js';
    } else if (_.isObject(resolver) && resolver.name) {
      resolverName = resolver.name;
      resolverFile = resolver.file;
    } else {
      // error
      logger.warn('Service "' + service.name + '" resolver (' + resolver + ') invalid');
      return;
    }

    // resolver NOT already loaded
    if (!service.resolver[resolverName]) {
      if (resolverFile) {
        // try to load controller as file
        if (fs.existsSync(resolverFile)) {
          ResolverClass = require(resolverFile);
        } else {
          // default "<service.directory>/resolvers/<template>"
          resolverFile = path.normalize(service.directory.resolvers + path.sep + resolverName + '.js');
          if (fs.existsSync(resolverFile)) {
            // need to add the current cwd because require is relative to this file
            ResolverClass = require(resolverFile);
          } else {
            // error
            logger.warn('Service "' + service.name + '" resolver (' + resolver + ') invalid');
            return;
          }
        }
      }

      // TODO: dependency injection
      if (_.isFunction(ResolverClass)) {
        service.resolver[resolverName] = new ResolverClass(service.instance, service.options[resolverName]);
      } else {
        service.resolver[resolverName] = ResolverClass;
      }
    }

    //
    if (service.resolver[resolverName][resolverBindName] && _.isFunction(service.resolver[resolverName][resolverBindName])) {
      resolve[resolverBindName] = service.resolver[resolverName][resolverBindName];
    } else {
      logger.warn('Service "' + service.name + '" resolver function (' + service.resolver[resolverName][resolverBindName] + ') invalid');
    }
  });

  return resolve;
};

ServiceManager.prototype._loadServiceFile = function (key, directory) {
  var file = '';

  // try to loading service file
  file = directory + path.sep + key + '.js';

  // check if file exists
  if (fs.existsSync(file)) {
    return require(file);
  } else {
    // try to loading service file
    file = directory + path.sep + 'service.' + key + '.js';

    // check if file exists
    if (fs.existsSync(file)) {
      return require(file);
    } else {
      if (this._displayDebuggerInfo) {
        logger.info('Could not find service file "' + key + '" (' + file + ')');
      }
    }
  }

  return null;
};

// TODO: move this to shared funcs with core service manager
ServiceManager.export = function (serviceName) {
  // get calling dir info
  var caller = stack()[2]; // get dir 2 levels up, original calling location
  var file = caller.getFileName();

  // remove calling filename
  var parts = file.split(path.sep);
  parts.pop();
  var filePath = parts.join(path.sep);

  // console.log('dirname:', __dirname, ', cwd:', process.cwd());
  // console.log('filePath:', filePath, ', parts:', parts);

  // service structure
  var service = {
    name: serviceName,
    config: util.require([filePath + path.sep + serviceName + '.config.json', filePath + path.sep + serviceName + '.config.js']),
    module: util.require(filePath + path.sep + serviceName + '.js'),
    routes: util.require([filePath + path.sep + serviceName + '.routes.json', filePath + path.sep + serviceName + '.routes.js']),
    resources: util.require([filePath + path.sep + serviceName + '.resources.json', filePath + path.sep + serviceName + '.resources.js']),
    controller: {}
  };

  // get all controllers in dir
  var files = glob.sync(filePath + path.sep + 'controllers' + path.sep + '*.js');
  // console.log('files:', files);
  _.forEach(files, function (file) {
    // "glob.sync" returns paths with normalized separators, so use "/" over path.sep here
    var parts = file.split('/');
    var name = parts.pop();
    name = name.split('.')[0]; // remove '.js' from name
    service.controller[name] = {
      name: name,
      module: util.require(file)
    };
  });
  // console.log('service:', service);

  return service;
};