'use strict';

class HelloCtrl {
    constructor($logger) {
        this.logger = $logger;
    }

    $preRoute(){
        
    }

    $postRoute(){

    }

    // localhost:8000/hello
    hello($done, $done)
    {
        $done({ hello: "world" });
    }
}

// node 4/5 does not support export class
module.exports = HelloCtrl;
