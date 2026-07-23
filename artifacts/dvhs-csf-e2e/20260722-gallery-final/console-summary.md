# Sanitized console and runtime summary

## Curated result

- No browser console text, network payload, trace, video, or storage state is bundled in this gallery.
- No uncaught application exception is visible in the 22 final synthetic captures.
- The captured routes rendered their expected CSF content rather than a Next.js error overlay or generic 500 page.
- The public page contains no visible private application, dues, meeting, point, proof, or audit data.
- The production-mode isolated Playwright run `release-green-20260722` completed in 52.8 seconds with 26 passed, 3 intentionally skipped opt-in screenshot-capture tests, and 0 failed. The skipped capture tests are distinct from the completed sanitized 22-image curated gallery; no raw test report is bundled.
- The post-hardening private-plugin isolation browser/API smoke passes, targeted role navigation passes 14/14, and the full CSF Playwright run in `20260722-final-pass` completes in 2.3 minutes with 26 passed, 3 intentional Google consent/configuration skips, and 0 failed.
- The earlier July 22 production build and 268-test private-plugin baseline passed. The latest hardening delta has clean root typecheck, focused ESLint, 73/73 focused Bun tests, and green browser/isolation gates; a post-hardening production build and complete private-plugin unit rerun remain open.
- The latest isolated database replay passes 190 migrations, 57 CSF tables, 43 pgTAP files, and all 1,279 assertions. It covers atomic signed/manual profile links, stale-retry and cohort/link-type enforcement, accepted-application locking, validated tenant foreign keys, legacy-close revocation, immutable closure evidence, nine evidence-write guards, and a real `dblink` two-session close-vs-insert race.
- The latest focused Bun gate passes 73/73 tests with 761 expectations; root typecheck and focused ESLint are clean.
- Purpose-bound Google authorization is locally verified at the state, storage, token-use, refresh, and disconnect boundaries. This is code/test evidence only; no live Google flow ran.
- Permission-checked report archives are local ZIP downloads with formula-safe CSV and no Google write destination.
- The isolated replay used only the dedicated Let’s Assist project identity and label-scoped resources. Vela was not accessed or reused.
- The browser run exposed a PostgREST ambiguity caused by new composite foreign keys on onboarding/cohort relations. Private-plugin commit `7f12388` adds explicit constraint embeds and a regression guard; the final rerun passes.
- The private registry statically imports its required submodule rather than silently returning an empty registry after a failed dynamic load. Isolation smoke uses the seeded DV admin with a 30-second cold-compile deadline.
- Fixture reset preserves audit-linked profiles and reruns cleanly. Project-feed requests are aborted and ignored only when navigation makes them obsolete; genuine failures remain visible. Permission-denial assertions are scoped to the sole alert.
- The only server output in the green run was the Next.js diagnostic `Unexpected root span type AppRender.fetch`. No application exception was emitted.

## Known development observations

- The Next.js development server may perform a memory-threshold restart during the large screenshot sweep. The gallery harness retries the route once. The final production build and sequential production Playwright run pass, so this remains a development-runner observation rather than evidence of a production crash.
- Some captures show the footer service badge as `Checking` because the image was taken before the asynchronous health request settled. This label is excluded from availability acceptance.
- A successful page render does not prove server authorization. Role denial and private-response boundaries are verified by the role-based browser and server suites.
- The earlier login automation race was corrected by waiting for the form's explicit hydrated-ready marker. The isolated-stack environment resolver now accepts local Supabase loopback URLs on arbitrary ports.

## Excluded evidence

- Raw Playwright HTML output
- Browser traces and videos
- Request and response bodies
- Supabase tokens or cookies
- Google chooser, consent, and Cloud Console screens
- Live Drive filenames, row values, transcripts, receipts, or proofs
- Any live Google write, paid Supabase development branch, production mutation, or Vela resource
- A raw Playwright HTML report; the curated entry point is `index.html` in this folder
