# DVHS CSF Officer Operations Runbook

**Audience:** organization administrators, adviser, chapter officers, and Data Management
**Current status:** the August 6 isolated database replay, production build, root/private suites, plugin-isolation checks, 40-scenario CSF browser gate, 3-scenario DV gate, and sanitized gallery passed; live Google, hosted Development, complete visible mutation, accessibility, and Slides acceptance remain pending
**Authoritative record after review:** Let's Assist

This runbook describes the intended officer workflow using the verified August 6 local contracts. Do not use it for a production cutover until the remaining Google, remote-development, full browser-mutation, accessibility, and Slides gates in [testing and release](testing-and-release.md) pass.

## 1. Start of each work session

1. Open the DVHS CSF organization and use **Home → Your tasks**.
2. Confirm the selected semester is the semester you intend to operate.
3. Check deadlines, recent imports, and recent decisions before changing records.
4. Open the task row itself; counts must lead to the corresponding filtered list.
5. If a task is outside your role, ask an admin or adviser to reassign it. Do not use an admin account to bypass ordinary officer-role testing.

Organization admins can operate every CSF area. Adviser-only responsibilities include academic overrides and reopen. Position-specific access remains narrow: Treasurer handles dues, VP Membership handles applications and members, Secretary handles meetings and attendance, VP Clubs handles partner clubs, VP Publicity and Web Master handle public activity content, Activity Coordinators manage activities and participation, and Data Management handles imports and reconciliation.

## 2. Semester setup

Use **Semester** in this order:

1. Create or select the full term, such as **Fall 2026**.
2. Enter application, meeting, point, and closeout dates.
3. Prepare the policy draft: dues, total service points, per-activity cap, drive cap, required meetings, allowed absences, and outside-volunteering rule.
4. Have the adviser review and publish the policy. Draft values do not govern applications, points, reports, or closeout.
5. Create the required cohorts and connect only the source tabs that belong to the term. Codes such as `F26` identify Sheet tabs, not the product's semester name.

Never close a semester whose policy is still a draft.

## 3. Applications

Use **Applications → Review queue** for daily work and **All applications** for search or history.

1. Filter by term, class, submission state, eligibility, dues, assignee, or blocking issue.
2. Assign the application when ownership is needed.
3. Open the full-page review and inspect identity, source row, course calculations, transcript/receipt access, typed checks, dues, private notes, and status history.
4. Request information when required evidence or course data is missing.
5. Verify dues independently from academic eligibility.
6. Approve only after mandatory checks pass. An adviser override requires a specific reason and preserves the deterministic eligibility result.
7. Reject or withdraw with the correct explicit reason.

Application decision, membership creation, and audit history are one transaction. If the action fails, refresh the application before retrying; do not create a membership manually to compensate.

## 4. Student joining and account connection

### Reusable class link

1. Create the cohort/term link from the member connection area.
2. Share only the generated public link. Do not distribute a roster export.
3. After the student signs in with a confirmed email, the system may show **We found your CSF record — is this you?**
4. The candidate contains only name, graduating class, term, and limited membership context.
5. If the student confirms, the server atomically connects the account and records history.
6. If the student selects **Not me**, or the email is missing, ambiguous, or conflicts with another link, the request moves to officer review.

Only a profile-connect or combined invitation may start this workflow. An application-only link is never a profile-claim link. The claimed profile must belong to the invitation's cohort.

### Officer review

1. Open **Members → account connections**.
2. Compare the request with the student's submitted evidence; never match on name alone.
3. Choose **Connect** or **Reject** and enter a clear reason of at least four characters.
4. If the student already has an accepted application for the same cohort and term, the atomic connection may activate that term membership.
5. Use unlink/relink only to correct a documented error and always include a reason.

An existing verified account cannot assign itself to a class through this request; it must already have the matching active cohort and no conflicting active cohort. The server locks and revalidates any accepted application before activation. An idempotent retry also rechecks the current profile, organization membership, cohort, and audit evidence; a revoked or conflicting stale result returns to officer review.

An existing organization admin or staff role is never downgraded when a profile is connected.

## 5. Google Drive and Sheets imports

Live Google acceptance is not complete. Until it is, use only synthetic/local sources. When the gate opens, every real import must follow this sequence:

1. Confirm the connected Drive identity shown by the product is exactly `dvhighcsf@gmail.com`. Stop if it is not.
2. Select the native Sheet with Google Picker or upload a local `.xlsx` through the separate upload path.
3. Choose the exact tab and a bounded range.
4. Map stable source columns by index/key, not only by display header.
5. Preview normalized rows and their resolved cohort/term.
6. Resolve duplicates, missing targets, malformed dates, `#REF!`, ambiguous identities, and inaccessible evidence.
7. Commit valid rows explicitly.
8. Review accepted, skipped, failed, and unresolved counts. Retry corrected rows from the recorded lineage.

Operational rules:

- The encrypted Google connection is scoped to the exact organization, CSF plugin, import purpose, and officer capability approved during OAuth. Every token use and refresh rechecks that binding.
- A legacy connection without a defensible binding shows **Reconnect**. Officers must not work around it with another organization's token.
- **Import changes** creates a new immutable snapshot; there is no background sync or Sheet writeback.
- A second import of the same snapshot must be idempotent.
- Reviewed Let’s Assist fields are never silently overwritten.
- A missing, blank, malformed, non-positive, or implausibly large historical point value blocks that activity; it never becomes one point.
- An invalid meeting timestamp blocks commit until corrected with a recorded reason.
- A partner-club Form import remains preview-only until an officer explicitly commits it.
- If Drive access is lost, reconnect the source. Do not delete the reviewed platform record.

## 6. Members

Use **Members** to locate the permanent student identity and current-semester record.

1. Search by student or confirmed account; filter by class, connection, application, eligibility, dues, or membership result.
2. Open the member detail before correcting identity, class, account connection, attendance, or points.
3. Record corrections with the source, reason, and current officer identity.
4. Merge duplicate profiles only after confirming both records describe the same person.
5. Keep completed historical semesters visible; hide empty future terms.

The member's **My CSF** view should agree with the officer record for application, eligibility, dues, attendance dates, points, decision, and deadlines.

## 7. Activities, points, meetings, and partner clubs

### Activities

1. Create the activity as a draft with term, audience, date, location, signup method, point type/value/cap, and evidence rule.
2. Preview it as a member before publishing.
3. Publish only complete activities. Close, cancel, or archive with the matching operational state instead of deleting history.

### Point submissions

1. Open the submission and inspect the selected activity/club, claimed numeric points, and proof access.
2. Request correction, reject, adjust, or approve with the required reason.
3. An Activity Coordinator may verify participation but cannot perform final point processing unless separately granted.
4. Verify the awarded quantity in the member's My CSF view. Multiple points are one numeric award, not repeated one-point rows.
5. Process an appeal as a separate reasoned decision; do not edit the original decision out of history.

### Meetings

1. Create the required meeting for the semester/class.
2. Import attendance from the exact file, tab, and range.
3. Resolve duplicate submissions, unmatched names, missing email, and invalid timestamps before commit.
4. Add or remove manual attendance only with a reason.
5. Confirm the member sees the exact attended dates and the policy's allowed-absence calculation.

### Partner clubs

1. Import or create the club record, then review it for a specific semester.
2. Set standing, point type, cap, proof rule, and reviewer notes.
3. Approve, renew, suspend, or expire explicitly; never overwrite a prior semester's standing.
4. Reconcile any member-point source before accepting claims against the club.

## 8. Semester close and reopen

1. Open the close preflight in **Semester**.
2. Resolve every linked blocker: applications, point submissions, appeals, attendance, dues, and import reconciliation.
3. Review the published policy version and the current summary.
4. Submit close only from that preflight. The browser sends the reviewed evidence hash; the server derives each completed or not-completed outcome.
5. If the product reports that records changed after preflight, refresh, review all counts again, and retry. Never bypass the stale-evidence check.
6. After close, verify the revision, completed/not-completed counts, explicit reasons, reports, and each member's frozen My CSF result.

Only the adviser with the explicit permission, or an organization admin exercising admin authority, may reopen. Reopen requires a reason. Make the correction, rerun preflight, and close again; the new revision must preserve the earlier result in history.

## 9. Reports and audit history

1. Select the semester before generating a report.
2. Download the permission-checked local ZIP. It contains formula-safe CSV files and a manifest.
3. Reconcile report totals with the underlying filtered list.
4. Use **Change history** to trace consequential actions by actor, reason, source, correlation identifier, and revision.
5. Never copy real student rows, tokens, proof, transcripts, or receipts into tickets, screenshots, fixtures, docs, or Slides.

Reports do not write to Google Sheets and do not expose a Google destination picker.

## 10. Fall 2026 rollout: cohort links, legacy seed, and posts

This section is the one-time cutover procedure from Google Classroom + spreadsheets to Let's Assist, plus the recurring posts/email workflow it enables. Real source files live git-ignored in `docs/csf/source-data/` — see [source data](source-data.md) for every file's layout. Never copy real values out of them.

### 10.1 One-time semester and cohort setup

1. Create cohorts Class of 2027 through Class of 2030 (2026 exists only if seeding history for graduated seniors) and terms Spring 2025, Fall 2025, Spring 2026 (closed) and Fall 2026 (current) through Semester setup (§2).
2. Confirm the communications broadcast topic and Resend topic id are saved in organization plugin settings for the `term_members` audience — cohort posts email through the same announcements consent topic.

### 10.2 Legacy data seed (rehearse locally first: `bun run dev`)

Import in this order through the existing Sheets workspace preview → commit fence; every commit is staff-approved and reversible only forward:

1. **Club registry and policies** — `rosters/Clubs Points.xlsx`, `rosters/Spring 2025 CSF Returning Clubs Responses.xlsx`, `rosters/CSF Club Audit Spring 2026 Responses.xlsx` as partner-form imports → partner clubs with per-club point policy.
2. **Member roster** — `rosters/CSF Application Spring 2026 Responses.xlsx` as `application_responses` for Spring 2026. Expect ~517 rows / ~516 unique profiles; grade maps 9→2029, 10→2028, 11→2027, 12→2026.
3. **March 2025 chapter attendance** — `rosters/CSF March Meeting Attendance 2025.xlsx` as `meeting_attendance` for Spring 2025. Name-only rows will land ambiguous/unmatched — resolve what you can; `skipped` is an honest terminal state for departed students.
4. **Per-club Fall 2025 points** — normalize first: `bun run csf:normalize:legacy` (drafts editable mappings under `.artifacts/legacy-csf/mappings/`), review each mapping (sheet selection, club name, excluded rows, points-per-mark), then `bun run csf:normalize:legacy --apply` and upload each normalized workbook from `.artifacts/legacy-csf/normalized/` as a `partner_club_audit` import for Fall 2025.

Acceptance: per-cohort roster counts match the application grade distribution; spot-check at least three clubs' point totals against their source workbooks; ambiguous-row queues triaged to zero or documented.

### 10.3 Student rollout (replaces the four Classroom codes)

1. Create four cohort onboarding links (§4) — one per graduating class, Fall 2026 term, combined link type. These replace the Freshman/Sophomore/Junior/Senior Google Classroom codes everywhere the chapter publishes them.
2. Students who sign up through a cohort link skip the generic platform tour, confirm the exact-email claim ("is this you?"), pick a username in place, and get the CSF member tour on their class Home.
3. Students whose sign-up email is not on the roster submit a link request; resolve them in the Members queue, where ranked name-similarity suggestions offer one-click connects. Never expose roster names to students.

### 10.4 Posts and announcement email

1. Post from the class Stream (or member Home compose): audience `class` targets one cohort; `members` targets the whole chapter. Pin sparingly.
2. The "also send as email" toggle queues exactly one campaign per post through the durable ledger — retries are safe; edits after queueing never change the email. Delivery drains via the `csf-communications-dispatch` workflow every 10 minutes.
3. Recipients can opt out via the link in every announcement email (verify-the-address confirmation). Opt-outs exclude the address from future snapshots automatically; do not hand-manage them.
4. Grant posting rights via the `manage_posts` capability (Publicity VP and Web Master templates carry it; org admins and the owner always can).

## 11. Troubleshooting and stop rules

| Condition                                                | Officer action                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Wrong connected Google identity                          | Stop before file selection; reconnect the approved chapter account.                       |
| Google source says **Reconnect**                         | Reauthorize; keep existing reviewed records.                                              |
| Missing or malformed imported point value                | Leave the row unresolved and correct the source mapping/value; never guess.               |
| Invalid meeting timestamp                                | Correct with a reason before commit.                                                      |
| Duplicate or ambiguous profile                           | Send to account-connection review; never search or expose the roster to the student.      |
| Application approval is blocked                          | Complete the mandatory check or have the adviser record a reasoned override.              |
| Semester evidence changed                                | Refresh preflight and review again.                                                       |
| A mutation partially appears to succeed                  | Stop and inspect Change history before retrying; do not add a compensating manual record. |
| Private data appears on a public route or in an artifact | Treat as P0, stop testing, remove the artifact, and notify the platform owner.            |

## 12. Current release checklist

Before this runbook is used for the real chapter cutover, all boxes must be checked:

- [x] Atomic exact-email profile claim and reasoned officer resolution
- [x] Signed purpose/capability-bound Google OAuth state and callback reauthorization
- [x] Strict historical point import; no one-point fallback
- [x] Transactional semester close with stale-evidence rejection
- [x] Fictional-only tracked seed enforcement
- [x] Clean isolated replay through 214 migrations, 82 CSF tables, 63 pgTAP files, and 3,165/3,165 assertions
- [x] Profile claim concurrency/idempotent retry, validated tenant foreign keys, legacy close revocation, nine evidence-write guards, and real `dblink` two-session close-vs-insert race
- [x] Final post-hardening production build and root typecheck
- [x] Lint completed with 0 errors and 0 warnings
- [x] Private-plugin CSF unit/security suite: 2,337 passed
- [x] Latest focused hardening gate: 73/73 Bun tests with 761 expectations, clean root typecheck, clean focused ESLint
- [x] Exact Google organization/plugin/purpose/capability binding with legacy reconnect
- [x] Signed/manual profile-link link-type, cohort, application-lock, and stale-retry hardening
- [x] Local ZIP reports with formula-safe CSV and no Google write destination
- [x] Dedicated CSF stack validation and label-scoped cleanup; no Vela infrastructure access
- [x] Compiled-runtime CSF Playwright: 40 behavioral scenarios passed, 3 opt-in screenshot captures intentionally skipped, 0 failed
- [x] Post-hardening private-plugin isolation browser/API smoke using the seeded DV admin and a 30-second cold-compile deadline
- [x] Targeted role-navigation matrix: 14/14
- [x] DV Playwright: 3 passed after explicit fictional DV fixture seeding
- [x] Repeatable fixture reset preserves audit-linked profiles; obsolete project-feed fetches cancel cleanly; denial assertion targets the sole alert
- [x] Composite-FK PostgREST onboarding/cohort ambiguity fixed in private-plugin commit `7f12388` with explicit constraint embeds and regression coverage
- [x] Exact profile claim and decline plus navigation/direct-route boundaries for every officer role
- [x] Login hydration-ready marker and arbitrary-port isolated Supabase environment resolution
- [x] Final sanitized 22-image curated gallery at [`evidence/20260806-post-cleanup/index.html`](evidence/20260806-post-cleanup/index.html), separate from generated Playwright output
- [ ] Complete green PR checks; least-privilege `PRIVATE_SUBMODULE_TOKEN`, GitGuardian disposition for the removed local-only fixture password, and authenticated Vercel Preview diagnosis remain open
- [x] Post-hardening production build and full private-plugin unit-suite rerun
- [ ] Persistent isolated Supabase development branch after explicit `$0.01344/hour` cost confirmation
- [ ] Stable development Vercel preview with non-production Supabase invariant
- [ ] Authorize local Google origin `http://localhost:3001` and callback `http://localhost:3001/api/calendar/google/callback`
- [ ] Confirm `dvhighcsf@gmail.com` in-product, then complete Picker, import, reconnect, revocation, and failure-state verification
- [ ] Complete synthetic visible mutation lifecycle for every actor
- [ ] Keyboard, focus, and screen-reader acceptance
- [ ] Three native Google Slides decks created and visually accepted

No live Google OAuth/Picker/Drive import or Google write has been performed. No paid Supabase development branch has been created. Production and Vela were not accessed or mutated. These are action-time release gates, not completed runbook steps.

See [testing and release](testing-and-release.md) for current evidence and residual risk. See the [product contract](product-contract.md) for the full product, permission, data, and acceptance contracts.
