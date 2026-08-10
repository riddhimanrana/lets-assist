# DVHS CSF browser acceptance suite

This suite is intentionally read-only against the deterministic local DVHS CSF fixture. It never resets Supabase, opens real Drive files, or writes officer-maintained Sheets.

Run the local fixture seed before the suite, then provide the local fixture password:

```bash
CSF_LOCAL_TEST_PASSWORD=... bun run csf:test:e2e
```

The Playwright config starts and owns its own isolated stack. It refuses an ambient one: it resolves the Supabase environment and work directory at config load, reads the profile-claim secret from that work directory, and fails if an ambient `CSF_PROFILE_CLAIM_SECRET` disagrees. The base URL is `http://127.0.0.1:${CSF_ISOLATED_APP_PORT}`; there is no port or base-URL override. Let the config bring the stack up rather than pointing it at a running one.

Coverage:

- 14/14 role-navigation scenarios across organization admin, adviser, every distinct officer template, applicant, member, direct-URL denial, and 390 px phone navigation;
- compact application list, filters, addressable detail, and Back-state restoration;
- structural public-response privacy assertions;
- responsive product-company footer branding and synthetic fixture-contact privacy;
- visible navigation/action targets;
- light/dark responsive smoke checks at 390px, 768px, and 1440px.

Current ordinary result: 40 scenarios, 3 capture-only tests skipped, 0 failed. The
footer-branding and fixture-contact privacy regressions each pass 1/1. After
fixture re-upsert, the sanitized gallery is opt-in and passed 3/3 capture tests under
`20260716-final-gallery`:

```bash
CSF_CAPTURE_GALLERY=1 CSF_E2E_RUN_ID=20260716-final-gallery bun run test:e2e:csf -- tests/e2e/csf/screenshot-gallery.spec.ts
```

Complementary local gates:

- CSF-specific plugin suite: 187 tests and 1,250 expectations;
- full plugin unit gate: 253 passed, 0 failed, 1,614 expectations;
- `bun run csf:test:workflows`: passed, including the explicit V83 proof-lifecycle probe. Its public-route subcheck skipped because no app server was running; the ordinary browser suite covers structural public privacy separately.

This read-only suite does not execute real Google consent, account chooser,
Picker, Drive imports, a complete visible mutation lifecycle, remote-system
changes, or the Google Slides process suite.
