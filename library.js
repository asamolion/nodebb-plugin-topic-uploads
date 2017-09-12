"use strict";

var Plugin = {};
var categoryController = require("./lib/category.js");

Plugin.load = function(params, callback) {
  var router = params.router;
  var middleware = params.middleware;

  router.get('/category/:category_id/:slug?/mini', middleware.buildHeader, categoryController.get);
};

module.exports = Plugin;
