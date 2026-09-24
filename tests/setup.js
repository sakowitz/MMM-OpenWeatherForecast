"use strict";

const Module = require("node:module");
const path = require("node:path");

const stubRoot = path.join(__dirname, "_stubs");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "logger") return path.join(stubRoot, "logger.js");
  if (request === "node_helper") return path.join(stubRoot, "node_helper.js");
  return originalResolveFilename.call(this, request, parent, ...rest);
};
