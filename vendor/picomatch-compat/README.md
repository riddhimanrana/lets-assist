# picomatch compatibility repair

A local copy of [picomatch](https://github.com/micromatch/picomatch) 4.0.7 with
repairs for
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), a
regular expression denial of service through single-branch repeated extglobs
such as `+(*)`, `+(*a)` and `+(!(b))`. Upstream lists no patched release. It is
not an upstream release and is not published. The owning application's
`overrides` entry `"picomatch": "file:./vendor/picomatch-compat"` installs it
for every consumer.

## Provenance

- `index.js`, `posix.js`, `lib/constants.js`, `lib/picomatch.js`,
  `lib/scan.js` are byte-identical to the 4.0.7 registry
  tarball (integrity in `package.json` `upstream`).
- `lib/parse.js` is the tarball file (SHA-256 in `package.json` `upstream`)
  with `ghsa-fc5q-39xc-vjpf.patch` applied.
- `lib/utils.js` starts from upstream SHA-256
  `f04604f70cd1a3f6ace80b84766468674ff38b4bb83818d2ef1d81fc6355f935`
  with `linear-unescape.patch` applied for CodeQL alert 68.
- `license.txt` is the byte-identical upstream MIT license.
- `bun audit` does not query `file:` packages, so the dependency audit in
  `scripts/security/audit-package-graphs.mjs` (in the platform repository)
  binds this manifest, the override, the lock resolution and the patched
  parser's hash instead.

## Change

In 4.0.7, `analyzeRepeatedExtglob` only treats multi-branch bodies and nested
star sequences as risky. A single branch that contains a wildcard, such as
`+(*a)`, compiles to `(?:[^/]*?a)+`: the branch's own unbounded quantifier
nested in the outer repeat. A non-matching input then backtracks
exponentially (about 9 seconds for 29 characters).

The repair handles a single-branch `+(...)` or `*(...)` whose branch contains
an unescaped `*` or `!(`, and is not already a star-extglob sequence:

- When the branch is only text, `?` and single `*` within one path segment,
  every repetition matches exactly what one occurrence matches, because the
  `*` absorbs any slash-free string. The outer repeat becomes `{1}` for `+`
  and `{0,1}` for `*`. Matching is unchanged. Bounded quantifiers keep a
  following `?` from turning the group optional.
- Any other such branch (slashes, globstars, brackets, braces, escapes or a
  nested negation) is marked risky, so it takes the library's existing
  risky-extglob path and matches the pattern literally.

A local comparison of about 48,000 generated patterns against unpatched 4.0.7
found identical regular expressions for every pattern outside this class and
identical match results for every collapsed pattern.

Remove this package and the override when upstream publishes a fixed release
that the consumers accept.

## Backslash removal

The upstream backslash-removal regex repeatedly scans an unmatched bracket
suffix. The repair indexes the nearest valid bracket close in one reverse pass,
then removes only backslashes outside those ranges in one forward pass. Both
passes are linear; the suffix index uses linear space. It preserves the regex's
non-dotAll behavior, including a line terminator directly before a closing
bracket. No pattern is rejected, truncated or reinterpreted.

`picomatch-unescape-behavior.test.mjs` compares 299,593 short synthetic strings
against the original regex and exercises the public scan entrypoint in a child
with a hard timeout. The scan entrypoint does not use the parser's length cap.
This repairs the helper; it does not assert that an application request supplied
the affected patterns or that a production deployment has changed.
