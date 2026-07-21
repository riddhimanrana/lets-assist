# DVHS CSF verification summary

Run: `20260715-214118`  
Environment: local Let’s Assist and local Supabase only

## Passed gates

| Gate                                     |                                                                                 Result |
| ---------------------------------------- | -------------------------------------------------------------------------------------: |
| Disposable local Supabase replay         |                                                                170 migrations replayed |
| CSF schema inventory after replay        |                                                          50 `plugin_data.csf_*` tables |
| Database assertions                      |                                                                             799 passed |
| Atomic import-reconciliation assertions  |                                                                              47 passed |
| Focused CSF unit tests                   |                                                                             144 passed |
| Plugin unit tests                        |                                                                             160 passed |
| Core CSF Playwright suite                |                                                                           12/12 passed |
| Focused role-boundary Playwright suite   |                                                                             3/3 passed |
| Sanitized screenshot Playwright suite    |                                                                             3/3 passed |
| TypeScript typecheck                     |                                                                                 Passed |
| Focused ESLint on CSF/root touched files |                                                                                 Passed |
| `csf:test:workflows`                     |                                                                                 Passed |
| Plugin registry and contract tests       |                                                                                 Passed |
| Plugin install idempotency               | 1 install row, 11 role templates, 308 role-permission grants after uninstall/reinstall |
| Public structural privacy boundary       |                                                                                 Passed |
| Production build                         |                                                                                 Passed |
| 600-application / 1,000-member scale run |               474 ms fixture load; 31.8 ms directory; 10.1 ms queue; 37.1 ms relation batches |

Migration `20260716053000_dvhs_csf_atomic_import_reconciliation.sql` is included in the clean replay. Its database coverage proves server-only grants, cross-tenant denial, explicit actor/reason/correlation provenance, same-snapshot idempotency, and rollback when a final audit write is forced to fail.

The final disposable run applied all migrations and reported `Files=25, Tests=799, Result: PASS`. After those assertions completed, the Supabase CLI could not disable pgTAP because the isolated Postgres process stopped accepting connections, so the harness exited 2 during post-test teardown. Schema replay and test results are valid; a clean process exit remains a local resource-pressure follow-up.

The screenshot suite result is recorded in
`../20260715-214118-gallery/playwright/test-results/.last-run.json`; the core
Playwright result is recorded in `playwright/test-results/.last-run.json`.

## Partial or blocked gates

| Gate                                                                             | Current status                                                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Every documented officer template through a separate visible browser session     | Not completed; admin, Activity Coordinator, and member navigation boundaries are automated.                                 |
| Full synthetic lifecycle from application mutation through semester close/reopen | Not completed; route/UI evidence and database workflow coverage are broader than browser mutation coverage.                 |
| Google consent, Picker, reconnect, revoked-consent, and inaccessible-file tests  | Not run; no Google screen is captured.                                                                                      |
| All 15 staff seats assigned through invitations                                  | Not completed; templates render, but the synthetic organization did not have enough activated members for every assignment. |
| Fall 2026 policy completion                                                       | Current term, dates, policy v1, and one fictional deadline are visible; outside-volunteering and draft/publish are not explicit controls. |
| Cross-plugin browser isolation                                                   | Blocked by a pre-existing DV Speech & Debate route 404 outside this CSF scope.                                              |
| Disposable replay process exit                                                   | Migrations and 799 assertions passed; isolated Postgres became unavailable during the CLI's post-test pgTAP teardown.       |
| Zero P0/P1 acceptance                                                            | Not yet met because the complete every-role browser mutation lifecycle and Google failure-state execution remain open.       |

## Visible synthetic semester setup

- Classes of 2026, 2027, 2028, 2029, and 2030 exist in the namespaced local organization.
- Fall 2026 is the explicit current term and displays August 13 through December 18, 2026 without a Pacific-time date shift.
- Policy version 1 stores $5 dues, 7 required points, maximum 3 points per activity, maximum 2 drive points, one allowed absence, and point carryover disabled.
- A fictional application deadline is planned for September 4, 2026 at 11:59 PM PDT.
- Outside-volunteering and policy draft/publish state are not represented as explicit controls. These synthetic records are local-only and no remote system was changed.

## Artifact privacy

- Gallery-linked screenshots contain only fictional students, synthetic
  organizations, or public organization information.
- Identity-bearing admin and chapter-inbox captures are intentionally omitted
  from `gallery/index.html`.
- No real Drive row, transcript, receipt, proof, Google chooser, or consent screen
  is linked from the curated gallery.
- `aggregate-source-audit.json` contains workbook shape metadata only; it has no
  row values or student identifiers.

## Handoff entry points

- `gallery/index.html` — curated visual gallery
- `route-action-matrix.md` — exact route/action coverage and pending lifecycle work
- `console-summary.md` — browser/runtime findings and scope limits
- `../../../DVHS_CSF_E2E_AUDIT.md` — product-level issue register and lifecycle status
