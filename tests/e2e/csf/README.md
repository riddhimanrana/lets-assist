# DVHS CSF browser acceptance suite

This is a synthetic-only acceptance harness. It includes both read-only journeys
and bounded mutation journeys. Mutating specs create disposable fictional rows
and clean up the records they own; they must never run against shared local,
Development, Preview, Production, real student data, or officer-maintained
Sheets.

The harness requires a running, marker-validated isolated CSF Supabase stack and
its exact `CSF_ISOLATED_WORK_DIR`. Follow
[`scripts/local-dev/README.md`](../../../scripts/local-dev/README.md) to start
that stack and load its validated app environment, then run:

```bash
export CSF_LOCAL_TEST_PASSWORD="<the run-scoped synthetic fixture password>"
export CSF_ISOLATED_WORK_DIR="<the exact work directory printed by the isolated launcher>"
bun run csf:test:e2e
```

Playwright validates the selected isolated stack and profile-claim secret before
any test runs. It then starts and owns one compiled Next.js server through
`bootstrap-dvhs-csf-dev.mjs`, at `CSF_ISOLATED_APP_PORT` (default `3000`), with
`reuseExistingServer: false`. The base URL is
`http://127.0.0.1:${CSF_ISOLATED_APP_PORT}`. There is no `CSF_E2E_PORT`,
`CSF_E2E_BASE_URL`, ambient-server adoption, or development-mode fallback.
The config reads the profile-claim secret from the validated work directory and
fails if an ambient `CSF_PROFILE_CLAIM_SECRET` disagrees.

The bootstrap seeds the deterministic fictional fixture once when needed and
preserves an already-seeded isolated dataset unless the separately documented
reseed switch is used. Playwright runs with `fullyParallel: false` and
`workers: 1`, so stateful journeys share one ordered worker. The suite still
owns only its explicitly prefixed disposable records; fixture baselines are not
cleanup targets.

Coverage:

- organization admin, adviser, distinct officer templates, applicant, member,
  direct-route denial, and phone navigation;
- class Stream, applications, onboarding/profile claim, points, semester,
  communications, account connection, responsive, privacy, and accessibility
  journeys represented by the current `*.spec.ts` files;
- positive and negative visible outcomes, with mutation cleanup where a spec
  creates state.

Do not copy old pass totals into this file; the executable suite is the source of
truth. Normal evidence is written under
`.artifacts/dvhs-csf-e2e/<CSF_E2E_RUN_ID>/playwright/` (HTML report, failure
screenshots, retained-on-failure trace, and retained-on-failure video). Generated
browser output stays ignored. Sanitized gallery capture remains opt-in:

```bash
CSF_CAPTURE_GALLERY=1 CSF_E2E_RUN_ID=<run-id> bun run test:e2e:csf -- tests/e2e/csf/screenshot-gallery.spec.ts
```

Safety boundary:

- no real Google consent, Picker, Drive import, officer Sheet write, provider
  delivery, or Production state is part of this harness;
- outbound workers are disabled by the isolated runner, and local mail is
  loopback-only;
- screenshots are evidence, not a substitute for DOM assertions, durable-state
  checks, cleanup, or browser-error checks.

Run `bun run test:plugins`, `bun run csf:test:workflows`, and the isolated
database gates separately. A green browser run proves only this isolated local
compiled harness; it does not prove hosted Development, Preview, or Production.
