// The host, its sitemap generator, and Vercel's microfrontend config loader
// use fast-glob's callable async and globSync surfaces. Keep those surfaces
// while using tinyglobby, whose dependency tree has no vulnerable braces parser.
const { glob, globSync } = require("tinyglobby");

function optionsForTinyglobby(options = {}) {
  // tinyglobby otherwise expands bare directory patterns like globby. The
  // existing fast-glob callers expect only files matched by their patterns.
  return { expandDirectories: false, ...options };
}

function fastGlob(patterns, options) {
  return glob(patterns, optionsForTinyglobby(options));
}

fastGlob.glob = fastGlob;
fastGlob.globSync = (patterns, options) =>
  globSync(patterns, optionsForTinyglobby(options));
fastGlob.sync = fastGlob.globSync;

module.exports = fastGlob;
