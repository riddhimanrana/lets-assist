# DVHS CSF browser console and network summary

Run: `20260715-214118`

## Automated coverage

- The core CSF Playwright run passed 12/12 tests on an isolated local app port.
- The focused role-boundary run passed 3/3 tests, including restricted-officer
  denial and member legacy-route privacy behavior.
- Responsive public-page tests registered listeners for uncaught page errors,
  `console.error`, and failed requests, excluding only webpack HMR and favicon
  requests. Those assertions passed at phone, tablet, and desktop widths in
  light and dark mode.
- The dedicated sanitized screenshot run passed 3/3 tests and produced the
  officer, member, public, and responsive images in `screenshots/`.
- The screenshot-only tests do not register the console/network failure watcher;
  therefore their green result is visual-route evidence, not a blanket assertion
  of zero console output.

No raw browser logs, request bodies, authentication tokens, passwords, Drive row
values, or private file URLs are stored in this artifact directory.

## Confirmed runtime findings

| Finding                                                                                                                                                                                                  | Evidence                                                                                    | Correction/status                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The plugin-install confirmation dialog exceeded the 720px viewport and trapped the consent control outside the reachable scroll area.                                                                    | Manual browser measurement before and after the correction.                                 | Dialog is now capped at `calc(100dvh - 2rem)` with vertical scrolling; regression wiring test passed.                         |
| Loading the login form on the loopback IP was blocked by the Next.js development-origin boundary; before hydration, the native form fallback used GET and could place submitted fields in the local URL. | Agent-browser local loopback run.                                                           | `127.0.0.1` is narrowly allowed for development and the form fallback uses POST. The synthetic password was rotated.          |
| A verification URL opened in a different browser context showed `Verification Link Expired`.                                                                                                             | `screenshots/31-email-confirmation-expired-bug.png`.                                        | Recovery state is visible; the cross-browser confirmation lifecycle remains open for a product fix/retest.                    |
| A restricted officer requesting the legacy private applications URL now stays on that URL and sees a concise role-denial alert.                                                                          | Role-navigation browser test and `screenshots/57-restricted-officer-permission-denied.png`. | Fixed; private markers remain absent and the Applications navigation item remains hidden.                                     |
| A member requesting the legacy private applications URL receives a compact, marker-free 404.                                                                                                             | Role-navigation browser test.                                                               | Presentation fixed; a development-only React warning remains when late `notFound()` replays the executable root theme Script. |
| A date-derived “Active” term hid **Set as current** even though the stored `is_current` flag was false.                                                                                                    | Focused component/security regression and visible synthetic term setup.                      | Fixed; action availability now follows explicit `is_current`, and Fall 2026 was selected as current.                          |
| Shared `YYYY-MM-DD` formatting could shift the date back one day in Pacific time.                                                                                                                          | Shared formatter regression and visible Fall 2026 term dates.                                | Fixed; date-only values preserve their source calendar day, displaying 8/13/2026–12/18/2026.                                  |
| Local Postgres was killed with exit 137 during concurrent browser and service pressure.                                                                                                                  | Local container status and non-destructive recovery check.                                  | Database restarted healthy and synthetic records remained present; local resource-pressure risk remains.                      |
| The disposable replay applied all migrations and passed all 799 assertions, then its isolated Postgres stopped accepting connections during the Supabase CLI's pgTAP teardown.                            | `csf:test:db:isolated` output: `Result: PASS`, followed by teardown exit 2.                   | Product schema/tests passed; a clean harness process exit remains pending under a less-constrained Docker allocation.          |

Atomic import reconciliation does not produce a browser-console claim. Migration `20260716053000_dvhs_csf_atomic_import_reconciliation.sql` and its 47 focused database assertions verify server-only execution, tenant isolation, idempotency, correlated audit writes, and transaction rollback independently of the browser.

## Google execution boundary

Google consent, account chooser, Picker, token refresh, revoked consent, and
inaccessible-file states were not completed in this run. No Google-specific
console or network result is claimed. Drive and Gmail evidence used elsewhere in
the audit is read-only metadata/operational context only. Real Drive imports and
the complete every-role browser mutation lifecycle were not executed. No remote
system was mutated.
