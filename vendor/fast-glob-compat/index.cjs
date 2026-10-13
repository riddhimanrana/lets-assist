// The host, its sitemap generator, and Vercel's microfrontend config loader
// use fast-glob's callable async and globSync surfaces. Keep those surfaces
// while using tinyglobby, whose dependency tree has no vulnerable braces parser.
const { glob, globSync, isDynamicPattern } = require("tinyglobby");
const { isAbsolute, resolve } = require("node:path");

function staticDirectoryDepth(pattern) {
  const segments = pattern.replace(/^\.\//u, "").split("/").slice(0, -1);
  let depth = 0;
  for (const segment of segments) {
    if (isDynamicPattern(segment)) break;
    if (segment && segment !== ".") depth += 1;
  }
  return depth;
}

function optionsForTinyglobby(patterns, options = {}) {
  // tinyglobby otherwise expands bare directory patterns like globby. The
  // existing fast-glob callers expect only files matched by their patterns.
  const adapted = { expandDirectories: false, ...options };
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  // fast-glob keeps an absolute pattern's absolute result even when callers
  // omit `absolute` (or pass false). next-sitemap relies on that contract for
  // static-export HTML files before removing the absolute export root.
  if (
    patternList.length > 0 &&
    patternList.every((pattern) => isAbsolute(pattern))
  ) {
    adapted.absolute = true;
  }
  // fast-glob's depth is relative to each pattern's fixed directory prefix;
  // tinyglobby's is relative to cwd. The extra level in fast-glob's depth 1
  // also makes a root-level pattern need tinyglobby depth 0.
  if (typeof options.deep === "number" && Number.isFinite(options.deep)) {
    const prefixDepth = Math.max(0, ...patternList.map(staticDirectoryDepth));
    adapted.deep = prefixDepth + Math.max(0, options.deep - 1);
  }
  return adapted;
}

function normalizeDirectoryResults(matches, patterns, options = {}) {
  if (options.onlyFiles !== false && options.onlyDirectories !== true) {
    return matches;
  }

  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  const excludedRoots = new Set(
    patternList.flatMap((pattern) => {
      const match = /^(.*)\/\*\*\/?$/u.exec(pattern);
      if (!match || !match[1] || /[?*{}()[\]!]/u.test(match[1])) return [];
      return [
        options.absolute
          ? resolve(options.cwd ?? process.cwd(), match[1])
          : match[1],
      ];
    }),
  );

  return matches
    .map((match) =>
      options.markDirectories || !match.endsWith("/")
        ? match
        : match.slice(0, -1),
    )
    .filter((match) => !excludedRoots.has(match.replace(/\/$/u, "")));
}

function fastGlob(patterns, options) {
  return glob(patterns, optionsForTinyglobby(patterns, options)).then(
    (matches) => normalizeDirectoryResults(matches, patterns, options),
  );
}

fastGlob.glob = fastGlob;
fastGlob.globSync = (patterns, options) =>
  normalizeDirectoryResults(
    globSync(patterns, optionsForTinyglobby(patterns, options)),
    patterns,
    options,
  );
fastGlob.sync = fastGlob.globSync;

module.exports = fastGlob;
