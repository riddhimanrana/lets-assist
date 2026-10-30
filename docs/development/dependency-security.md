# Dependency security

`bun run security:audit` reads each independently owned lockfile: the platform,
the SDK, and every package in the exact private checkout. It audits runtime and
development dependencies. It does not install packages, run lifecycle scripts,
or pass ambient provider credentials to Bun. A missing lockfile, missing private
checkout, unaccepted advisory, or registry failure is an error. The daily dependency
workflow scans both protected branches without running database or browser gates.

## October 2026 patches

These are source changes. A lockfile update does not change an existing
Production deployment or a published SDK tarball. The private application patch
must merge before the host gitlink advances. Runtime configuration must be
checked again in the signed prebuilt artifact and hosted deployment.

The root pins Next.js and its companion packages to 16.4.1 for
[GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) and
[GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r).
A vulnerable package version alone does not prove an exploitable application:
the locked `sharp` is already 0.35.5 and the app has no `use cache` functions,
but the Server Actions denial of service applies to the App Router.
Nodemailer 10.1.4 includes the address parser fixes through
[GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w).
The stream-transport regression generates a message in memory and verifies the
envelope without sending mail. Nodemailer serves the local Mailpit transport;
Production uses the separate Resend transport.

The following compatible pins repair advisories found by the fresh full audit.
Existing overrides outside this table were not re-justified by this change.
Remove a pin only after its parent dependency resolves a fixed version naturally,
the frozen lockfile passes the full audit, and affected package checks pass.

| Package                   | Pinned version | Advisory addressed                                                                 |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| sharp                     | 0.35.5         | GHSA-wq5f-xc86-pv6w, upstream librsvg memory safety                                |
| brace-expansion           | 5.0.12         | GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr                      |
| @grpc/grpc-js             | 1.14.5         | GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4                                           |
| dompurify                 | 3.4.17         | GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f                      |
| source-map-js             | 1.2.2          | GHSA-68fv-2mgg-jv7q                                                                |
| fast-uri                  | 3.1.9          | GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, also pinned in the standalone SDK        |
| engine.io                 | 6.6.11         | GHSA-2gc4-cqfq-p2gv                                                                |
| js-yaml                   | 4.3.2          | GHSA-2883-xcg3-v3hh                                                                |
| qs                        | 6.16.1         | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw                      |
| @hono/node-server         | 2.1.3          | GHSA-rmxm-3fg6-px4f                                                                |
| systeminformation         | 5.33.16        | GHSA-3f7j-7jwc-fxfj, GHSA-4vjg-vx72-qq4g, GHSA-7648-jmwf-vw7j                      |
| ip-address                | 10.7.4         | GHSA-rxp7-6hxx-x8q5 and the earlier ip-address advisories                          |
| proxy-addr                | 2.0.8          | GHSA-jqcg-44mw-7w3h                                                                |
| @modelcontextprotocol/sdk | 1.32.1         | GHSA-6qxp-vccf-f47h                                                                |
| @babel/core               | 7.29.7         | GHSA-4x5r-pxfx-6jf8                                                                |
| @humanfs/node             | 0.16.8         | GHSA-p498-v437-472g                                                                |
| postcss-selector-parser   | 7.1.6          | GHSA-rj75-hqrm-r3gf                                                                |
| hono                      | 4.13.13        | GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx, GHSA-hxh3-vqpv-xpqv |
| browserslist              | 4.28.9         | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g                                           |
| undici                    | 7.30.1         | GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472                      |
| body-parser               | 2.4.0          | GHSA-27r3-jxmh-p828                                                                |
| zod                       | 4.6.6          | GHSA-mrhx-c7xc-m3w5, also forced for the unused shadcn CLI                         |

### October 29 root overrides

Three root overrides were added or raised, each the smallest version that the
registry audit reports as fixed and that satisfies the parent's declared range:
`systeminformation` 5.33.16 (through `@dotenvx/dotenvx` `^5.22.11`, used by the
shadcn CLI), `@hono/node-server` 2.1.3 (through `@modelcontextprotocol/sdk`
`^1.19.9 || ^2.0.5`) and `qs` 6.16.1 (raised from 6.16.0; `body-parser` 2.4.0
already declares `^6.16.1`). The root `bun.lock` diff changes only those three
entries. shadcn stays 4.21.4 and every other version is unchanged.

A root-only `bun audit --json`, run on a copy of `package.json` and `bun.lock`
with an empty environment and no env file, reported six advisories before the
change and one after:
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
low, `deepmerge` 4.3.1, which lists no patched version. That advisory is an
open gate: it is not waived, removed or vendored. The root-only scan did not
cover the SDK or private application graphs.

After private PR 669 merged as `b3369ad` and the root index gitlink moved to
it, `bun run security:audit` audited all three graphs. The root graph reported
only GHSA-gcqx-w48m-w2h4 (low, `deepmerge`); the SDK and private CSF
application graphs reported no findings. The audit exits 1 on that one root
advisory, with no suppression. The expired `braces` acceptance below was not
used to pass this scan, which reported no `braces` finding.

### October 29 deepmerge repair

GHSA-gcqx-w48m-w2h4 still lists no patched `deepmerge`, and shadcn, its
registry and html-to-text all require `^4.3.1`. With owner approval, the root
now installs `vendor/deepmerge-compat` (`@lets-assist/deepmerge-compat`
0.0.0) for every consumer. It is the registry 4.3.1 `dist/cjs.js` plus a
two-line guard that refuses the `__proto__` key in both merge loops, as in
upstream PR #274. The vendor README records provenance, the MIT license and the
exact patch. The root also declares `deepmerge` `^4.3.1`, because Bun 1.4.2
installs a `file:` override only for a direct dependency; without it the
consumers fail to resolve deepmerge. The lock change replaces the one registry
entry and adds only deepmerge `file:` resolutions.

`bun audit` does not query `file:` packages, so passing it proves only that
no registry deepmerge remains. `audit-package-graphs.mjs` binds the rest: the
exact override and root dependency, the vendor manifest, `index.cjs` and
`index.d.ts` by SHA-256, the tracked file list, and every root lock deepmerge
resolution. A registry deepmerge, an untracked or edited vendor file, a vendor
lockfile or another override target fails the audit. Advisory handling is
unchanged.

`scripts/plugins/deepmerge-compat.test.ts` loads deepmerge through each
installed consumer. On the unpatched 4.3.1 it fails 23 tests: null-prototype
targets, `null` or primitive placeholders, a target with its own `__proto__`,
nested, `all`, `clone: false`, `customMerge` and custom `arrayMerge`, plus a
real html-to-text conversion that hides text through an inherited `format`.
On the repair all 36 pass, including controls for cloning, arrays, symbols,
Date, RegExp, React elements, `customMerge`, `isMergeableObject`, `all` and
the upstream `constructor` handling. The shadcn registry module cannot load
under the root zod 4 override, so shadcn coverage is resolution and module
identity, not a CLI run. Remove the package, override and root dependency when
upstream publishes a fixed release that the consumers accept.

## Open upstream blocker

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects `braces` through 3.0.3. The advisory lists no fixed version. It concerns
untrusted deeply nested glob patterns reaching recursive compile/expand walkers,
not arbitrary contents of a file matched by an ordinary glob. The
[upstream report](https://github.com/micromatch/braces/issues/70) recommends a
small nesting bound or a smaller maximum pattern length until a fix exists.

The platform now preserves the Production dependency hotfix: its reviewed
`fast-glob` compatibility package uses `tinyglobby` and removes `braces` and
`micromatch` from the root graph. Compatibility tests cover microfrontends config
discovery, sitemap paths, directory results and depth limits. The private
application still retains `braces` through microfrontends and Next ESLint; the
existing exception is narrowed to that unchanged graph. The SDK graph does not
contain `braces`.

Repository-owned patterns are constants in `scripts/run-tests.mjs`,
`scripts/generate-audit-surface-inventory.mjs`, and `next-sitemap.config.js`.
Microfrontends constructs its search glob from default configuration filenames
or `VC_MICROFRONTENDS_CONFIG_FILE_NAME`, an operator-controlled environment
setting. ESLint accepts a root-directory pattern from repository configuration.
No direct application request-to-pattern import was found in platform or private
application source. This is a source reachability assessment, not proof that
all future inputs or transitive paths are safe.

The repository owner accepted this specific build-tool denial-of-service risk
until **2026-10-21 00:00 UTC**. The gate still prints the high-severity advisory
and an accepted-risk result. It does not describe this package as patched or the
scan as clean. `scripts/security/braces-exception.mjs` limits acceptance to this
advisory, `braces@3.0.3`, the exact reviewed package-graph lockfiles,
and the unchanged inventory including the clean SDK graph. New advisories,
versions, graph changes, expired acceptance, malformed JSON, and registry errors
fail the gate. There is no severity-wide or package-wide ignore.

The policy pins the reviewed glob input scripts, Next/sitemap/ESLint
configuration, and microfrontends entrypoints by SHA-256. Its source check refuses
new literal imports of the affected glob packages or their reviewed importers.
This check supplements the reviewed dependency paths; it is not a general proof
that arbitrary computed imports or future transitive inputs are safe.

The logging privacy rule changed the root ESLint fingerprint. The reviewed
change adds only repository-owned literal file patterns for runtime modules and
test exclusions, plus rules that reject direct console access. It does not add a
request, environment variable, or user-controlled pattern. The updated
fingerprint keeps the same dependency versions, graph inventory, expiry, and
operator-input restriction.

The private candidate at `085755f2` changes the application configuration only
to install response headers. Its helper returns one literal `/:path*` route
and constant headers. A boolean derived from `VERCEL_ENV` controls whether HSTS
is included; no environment or request value becomes a glob pattern. Review of
the candidate's tracked imports found no new affected glob importer. The three
lockfile hashes and all other pinned input files are unchanged. The application
configuration fingerprint now names that reviewed candidate. This prepares the
paired release; the strict audit still requires the checkout to match the root
gitlink. The advisory still lists no patched version as of October 7, 2026.

On October 7, 2026, provider metadata readback covered all 119 root Vercel
environment records and all 6 private application records. Neither project had
`VC_MICROFRONTENDS_CONFIG_FILE_NAME`. No values were printed or saved. The gate
also requires that variable to be absent from its own environment before
accepting the exception. Adding it to a hosted environment requires another
reachability review; local CI cannot attest to future provider changes.

On October 9, 2026, signed waiver PDFs gained Unicode font rendering. The root
lockfile adds `@pdf-lib/fontkit`, `regenerator-runtime` and six
`@expo-google-fonts/noto-sans*` packages; none of them depends on `braces`,
`micromatch`, `fast-glob` or `globby`, and the resolved `braces` version is
unchanged at 3.0.3. `next.config.ts` adds `outputFileTracingIncludes` for the
two waiver routes, with file patterns that are constants in
`lib/waiver/fonts/font-files.ts`. No request, environment or stored value
becomes a glob pattern. Review of the candidate's tracked imports found no new
affected glob importer. The root lockfile hash and the application
configuration fingerprint now name that reviewed candidate; the other two
lockfile hashes and every other pinned input are unchanged. The expiry date is
unchanged. Deployment metadata was not read back again for this update. The
advisory still lists no patched version as of October 9, 2026.

Also on October 9, 2026, `scripts/run-tests.mjs` gained a `--shard` option so
CI can split the unit tests across runners. The change filters the list of test
files the script has already discovered; it adds no glob pattern, changes no
pattern's inputs, and imports no affected glob package. The fingerprint for
that file now names the reviewed version. The lockfile hashes are unchanged by
this update.

Remove the exception when upstream publishes a verified fix. Any extension or
fingerprint update requires a new review of the advisory, source import paths,
operator inputs, and deployment metadata. Acceptance expires without renewal.

The October 7 integration updates Next.js to 16.4.0, React to 19.3.0,
Supabase clients to 2.117.3 and 0.12.7, and shadcn to 4.21.4. The root and
CSF lockfile fingerprints now cover those graphs. `bun pm why braces` still
resolves only 3.0.3 through micromatch 4.0.8 and fast-glob. The shadcn registry
update adds code-block-writer and removes its direct ts-morph dependency;
shadcn itself retains ts-morph. Next ESLint retains fast-glob 3.3.1. Runtime
microfrontends and next-sitemap versions are unchanged. Every pinned source
input is unchanged from the reviewed audit candidate. The same-day provider
metadata readback above remains the last hosted evidence; no provider setting
was changed during this integration. The advisory still has no patched release.
The acceptance scope, operator-input restriction and expiry are unchanged.

### Archived plugin input review, October 8

The Speech and Debate archival adds one literal path exclusion to unit discovery and ESLint. Next removes the unused DV transpilation entry and disables upgrade reminders only for the existing isolated test output directories. None of these changes accepts a request, file body, or environment value as a glob pattern. The reviewed source fingerprints now cover those edits. The dependency versions, accepted advisory and October 21 expiry are unchanged.

### Test-inventory output review, October 11

The `scripts/run-tests.mjs` repair waits for piped stdout to drain before
`--list` exits. Review of the diff confirms that all discovery patterns,
operator inputs, affected imports and dependency graphs are unchanged; no
request, environment value or user data becomes a pattern. The source
fingerprint now covers that reviewed output-only change. All lockfile hashes,
package versions, advisory scope and October21 expiry remain unchanged.
The upstream advisory still lists no patched version on October11.
Read-only Vercel metadata checks covered100 exposed root environment records
and all six child-app records; none named `VC_MICROFRONTENDS_CONFIG_FILE_NAME`.
Nineteen Production root records were hidden by the connector and were not
read. The newly READY Development Preview is bound to SHA`1aedb7e7`;
Production provider-input verification remains a separate prerequisite after
later owner approval. No provider values were decrypted, printed or saved, and
no environment or spending setting was changed.
