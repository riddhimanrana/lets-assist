# DVHS CSF synthetic gallery verification

## Scope

- Run: `20260722-gallery-final`
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

## Companion verification completed July 22

- The latest clean, namespaced local replay applied 190 migrations, discovered 57 CSF tables, ran 43 pgTAP files, and passed all 1,279 assertions in a dedicated Let’s Assist stack.
- Database coverage passes signed and manual profile-link idempotency, stale-retry revalidation, cohort and link-type restrictions, accepted-application locking, validated tenant foreign keys, legacy-close revocation, immutable closure evidence, nine evidence-write guards, and a real `dblink` two-session close-vs-insert race.
- The latest focused Bun gate passes 73/73 tests with 761 expectations. Root typecheck is clean, and focused ESLint is clean.
- Google credentials are bound to the exact organization, plugin, purpose, and capability. Every token use/refresh reauthorizes that binding, and an unbound legacy connection requires reconnect.
- Report generation produces a permission-checked local ZIP containing formula-safe CSV files and a manifest. There is no Google report-write destination.
- CSF replay startup and cleanup require exact project identity/ports/keys and label-scoped containers, volumes, and networks.
- The final post-hardening production build passes with Next.js 16.2.10, clean TypeScript, 79 generated pages, and sitemap generation.
- The private-plugin unit suite passes 272 tests.
- The final production-mode isolated Playwright run `release-green-20260722` passes 26 scenarios with 0 failures in 52.8 seconds. Its 3 opt-in screenshot-capture tests are intentionally skipped because screenshot capture is a separate workflow and this sanitized 22-image curated gallery is complete.
- The post-hardening private-plugin isolation browser/API smoke passes. It loads the required private registry through a static import, signs in as the seeded DV admin, and permits a 30-second cold compile.
- Targeted role navigation passes 14/14. The historical full post-hardening CSF Playwright run passed 26, explicitly skipped 3 Google-dependent scenarios, and had 0 failures in 2.3 minutes; its generated report is intentionally not retained.
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
- The 3 post-hardening Playwright skips are intentional live Google consent/configuration gates, not screenshot-capture skips or product failures.
- The gallery does not claim a complete visible mutation lifecycle, accessibility acceptance, cloud deployment acceptance, or completed Slides.

## File integrity

- All 22 images are under `screenshots/` and referenced by relative path from `index.html`.
- The gallery uses no remote scripts, fonts, analytics, or image URLs.
- Companion files contain aggregate or synthetic evidence only.
