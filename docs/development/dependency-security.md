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

The root pins Next.js and its companion packages to 16.3.8 for
[GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j).
The advisory concerns Node ImageResponse processing of attacker-controlled SVG;
a vulnerable package version alone does not prove an exploitable application.
Nodemailer 10.0.15 includes the parser fixes through
[GHSA-g57g-f23g-4646](https://github.com/advisories/GHSA-g57g-f23g-4646).
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
| dompurify                 | 3.4.16         | GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2                                           |
| source-map-js             | 1.2.2          | GHSA-68fv-2mgg-jv7q                                                                |
| fast-uri                  | 3.1.8          | GHSA-hrr3-gc8f-f4qj, also pinned in the standalone SDK                             |
| engine.io                 | 6.6.11         | GHSA-2gc4-cqfq-p2gv                                                                |
| js-yaml                   | 4.3.2          | GHSA-2883-xcg3-v3hh                                                                |
| qs                        | 6.16.0         | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g                                           |
| ip-address                | 10.7.3         | GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw |
| proxy-addr                | 2.0.8          | GHSA-jqcg-44mw-7w3h                                                                |
| @modelcontextprotocol/sdk | 1.32.1         | GHSA-6qxp-vccf-f47h                                                                |
| @babel/core               | 7.29.7         | GHSA-4x5r-pxfx-6jf8                                                                |
| @humanfs/node             | 0.16.8         | GHSA-p498-v437-472g                                                                |
| postcss-selector-parser   | 7.1.6          | GHSA-rj75-hqrm-r3gf                                                                |
| hono                      | 4.13.13        | GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx, GHSA-hxh3-vqpv-xpqv |
| browserslist              | 4.28.9         | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g                                           |

## Open upstream blocker

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects `braces` through 3.0.3. The advisory lists no fixed version. It concerns
untrusted deeply nested glob patterns reaching recursive compile/expand walkers,
not arbitrary contents of a file matched by an ordinary glob. The
[upstream report](https://github.com/micromatch/braces/issues/70) recommends a
small nesting bound or a smaller maximum pattern length until a fix exists.

Both the platform and private application retain the vulnerable package through
`fast-glob` and `micromatch`. Root importers include microfrontends configuration
discovery, Next ESLint, next-sitemap, the shadcn development CLI, and repository
inventory/test scripts. The private app includes microfrontends and Next ESLint.
The SDK graph does not contain `braces`.

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
advisory, `braces@3.0.3`, the exact reviewed root and private application lockfiles,
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
