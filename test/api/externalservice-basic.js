var common  = require('../util/common.js');
var request = common.request;
var expect  = common.expect;

module.exports = [
    function (server, done) {
        expect(server).to.not.be.null;
        if(server) {
            request(server)
                .get('/service1/hello')
                .expect('Content-Type', /json/)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be.null;
                    expect(res.body).to.be.a('object');

                    expect(res.body).to.have.keys("hello2", "ts");
                    expect(res.body.hello2).to.equal("world1");
                    if(done) done();
                });
        } else {
            if(done) done();
        }
    },
    function (server, done) {
        expect(server).to.not.be.null;
        if(server) {
            request(server)
                .get('/service2/hello')
                .expect('Content-Type', /json/)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be.null;
                    expect(res.body).to.be.a('object');

                    expect(res.body).to.have.keys("hello3", "ts");
                    expect(res.body.hello3).to.equal("world2");
                    if(done) done();
                });
        } else {
            if(done) done();
        }
    },
    function (server, done) {
        expect(server).to.not.be.null;
        if(server) {
            request(server)
                .get('/service2/world?hello=world3')
                .expect('Content-Type', /json/)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be.null;
                    expect(res.body).to.be.a('object');

                    expect(res.body).to.have.keys("hello2", "ts");
                    expect(res.body.hello2).to.equal("world3");
                    if(done) done();
                });
        } else {
            if(done) done();
        }
    }

];