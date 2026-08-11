# DVHS CSF synthetic gallery verification

## Scope

- Run: `20260806-post-cleanup`
- Evidence: 22 PNG screenshots plus this curated manifest
- Data: fictional local CSF fixtures only
- Surfaces: officer Home, Applications, Members, Service, Semester, Imports, Reports, Staff access, Change history, Settings, member My CSF, public page, and responsive Home variants
- Viewports: 1440 px desktop, 768 px tablet, and 390 px phone in light and dark mode

## Verified in the captured UI

- The organization retains the normal Let's Assist shell and a single compact CSF navigation layer.
- Home prioritizes role-aware tasks, deadlines, quick links, and recent imports rather than marketing copy or redundant metric cards.
- Applications render as a compact shadcn-style list and open a full-page review.
- Member, activity, point, meeting, partner-club, semester, import, report, staff, history, and settings routes render against the same fictional tenant.
- Import commit is blocked when the exact source file, tab, or range is missing.
- My CSF shows one current-semester operational status and hides unrelated officer controls.
- The public surface shows organization links and public activities without application, dues, attendance, point, proof, or audit fields.
- Desktop, tablet, and phone layouts render in both light and dark mode without horizontal page overflow in the captured viewport.

## Companion verification completed August 6

- A fresh namespaced local replay applied 214 migrations, discovered 82 CSF tables, ran 63 pgTAP files, and passed all 3,165 assertions in a dedicated Let’s Assist stack.
- Database coverage passes signed and manual profile-link idempotency, stale-retry revalidation, cohort and link-type restrictions, accepted-application locking, validated tenant foreign keys, legacy-close revocation, immutable closure evidence, nine evidence-write guards, and a real `dblink` two-session close-vs-insert race.
- Root formatting, source organization, zero-warning ESLint, typecheck, production dependency audit, process-isolated tests, and production build pass. The private CSF suite passes 2,337 tests.
- Google credentials are bound to the exact organization, plugin, purpose, and capability. Every token use/refresh reauthorizes that binding, and an unbound legacy connection requires reconnect.
- Report generation produces a permission-checked local ZIP containing formula-safe CSV files and a manifest. There is no Google report-write destination.
- CSF replay startup and cleanup require exact project identity/ports/keys and label-scoped containers, volumes, and networks.
- Final teardown passed the dry-run ownership check, removed only the exact isolated project, proved zero residual labeled containers/volumes/networks, and deleted its work directory and generated secrets.
- The production build passes with Next.js 16.3.0, clean TypeScript, and 80 generated static pages.
- The compiled-runtime CSF Playwright run passes 40 behavioral scenarios with 0 failures; its 3 opt-in capture scenarios are skipped during the behavioral run. The separate gallery run passes all 3 captures.
- The post-hardening private-plugin isolation browser/API smoke passes. It loads the required private registry through a static import, signs in as the seeded DV admin, and permits a 30-second cold compile.
- Every seeded officer permission template, member, applicant, public boundary, and direct-route denial scenario passes. The DV vertical browser workflow passes 3/3 after explicit fictional DV seeding.
- Fixture reset is repeatable and preserves profiles referenced by immutable audit history. Project-feed navigation cancels obsolete requests without hiding real failures, and the denial-copy check targets the single alert.
- The browser run first caught PostgREST ambiguity introduced by new composite foreign keys on onboarding/cohort relations. Private-plugin commit `7f12388` fixes those queries with explicit constraint embeds and adds a regression guard; the final rerun is green.
- Exact profile claim and decline, plus navigation and direct-route boundaries for every officer permission template, pass in the browser suite.
- Login automation now waits for an explicit hydrated-ready marker, and local environment resolution accepts isolated loopback Supabase stacks on arbitrary ports.

## Evidence boundaries

- The screenshots are visual evidence, not a substitute for database, permission, concurrency, or server-action tests.
- No Google chooser, OAuth consent screen, live Drive row, transcript, receipt, proof upload, token, or real officer/student identity is included.
- Raw Playwright traces, videos, network payloads, and HTML reports are intentionally excluded from this curated folder.
- This curated gallery is not the output of the 3 opt-in screenshot-capture tests skipped by the behavioral suite; it is the separately completed, sanitized visual handoff.
- The Google Picker is not represented as a successful live import. No live OAuth consent, Picker selection, Drive read/import, token refresh, reconnect/revocation, or Google write was performed.
- No paid Supabase development branch was created. Production Supabase/Vercel, `main`, the existing DVHS CSF tenant, and all Google properties remain unchanged. No Vela service or local Vela infrastructure was accessed or reused.
- The footer's transient `Checking` label in some screenshots reflects capture timing and is not treated as availability proof; availability is verified separately by the health endpoint and browser suite.
- The 3 behavioral-run skips are the opt-in gallery capture tests, not product failures. Live Google acceptance remains a separate external gate and was not attempted.
- The gallery does not claim a complete visible mutation lifecycle, accessibility acceptance, cloud deployment acceptance, or completed Slides.

## File integrity

- All 22 images are under `screenshots/` and referenced by relative path from `index.html`.
- The gallery uses no remote scripts, fonts, analytics, or image URLs.
- Companion files contain aggregate or synthetic evidence only.
