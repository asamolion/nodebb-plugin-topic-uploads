"use strict";

var Plugin = {};

Plugin.load = function (params, callback) {
  var router = params.router;
  var middleware = params.middleware;

  function render(req, res, next) {
    console.log(req);


    callback();
  }

  router.get('/yourpage', render);
  router.get('/api/yourpage', render);
};

module.exports = Plugin;
