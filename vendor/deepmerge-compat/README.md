# @lets-assist/deepmerge-compat

A local copy of [deepmerge](https://github.com/TehShrike/deepmerge) 4.3.1
with one repair for
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). It is
not an upstream release and is not published. The root `overrides` entry
`"deepmerge": "file:./vendor/deepmerge-compat"` installs it for every consumer
(shadcn, `@shadcn/registry` and html-to-text).

## Provenance

- `index.cjs` is the registry tarball's `dist/cjs.js` (SHA-256
  `2e5160f8…de7d`; tarball integrity in `package.json` `upstream`) with
  `ghsa-gcqx-w48m-w2h4.patch` applied.
- `license.txt` is the byte-identical upstream file. deepmerge is MIT
  licensed; the original copyright notice is kept there.
- `index.d.ts` is the upstream declaration file with one added first line, an
  ESLint directive for its upstream `any` types. The rest is byte-identical.
- The version is `0.0.0` under a local name so it is never mistaken for a
  registry release. `bun audit` does not query `file:` packages, so the
  dependency audit's local-package check in
  `scripts/security/audit-package-graphs.mjs` binds this manifest, the
  override and the root lock instead.

## Change

In 4.3.1, `mergeObject` writes `destination[key]` on a fresh `{}`. When the key
is `__proto__`, that assignment replaces the returned object's prototype. The
existing guard only stops it when the target is an ordinary object. A
null-prototype target, a `null` or primitive placeholder, or a target that has
its own `__proto__` key (from `JSON.parse`) bypasses it. `Object.prototype` is
never changed.

The patch refuses the `__proto__` key by name in the target-copy loop and the
source loop, as proposed upstream in TehShrike/deepmerge#274 (closed
unmerged). Every other key, option and return shape is unchanged.
`constructor` and `prototype` are not refused: on the `{}` destination they are
ordinary data properties, and plain targets already skip them.

Remove this package and the override when upstream publishes a fixed release
that the consumers accept.
