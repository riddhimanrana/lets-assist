# DVHS CSF Officer Operations Runbook

**Audience:** organization administrators, adviser, chapter officers, and Data Management
**Current status:** this repository carries 322 ordered migrations through `20260818115000_align_super_admin_metadata_shapes`; Production was last verified read-only at 236 through `20260811001500`, leaving an exact repository-pinned 86-migration cutover. Hosted Development serves root merge SHA `4e33dd6d938688261a2a0bda060304522d7611da` with the verified 321-migration ledger, and Google authentication redirects successfully there. The fresh full 322-migration local replay passes; final hosted browser/provider acceptance and Production email-webhook proof remain release gates. Google OAuth and Picker were previously connected for a bounded Spring 2026 application preview that committed zero applications. Production remains untouched, and schema deployment or real-data mutation requires explicit action-time approval.
**Authoritative record after review:** Let's Assist

This runbook describes the v1.3 officer workflow. Do not use it for a production cutover until the remaining Google, full browser-mutation, accessibility, hosted scheduled-post, Production email/webhook, advisor, and database cutover gates in [testing and release](testing-and-release.md) pass.

## 1. Start of each work session

1. Open the DVHS CSF organization and use **Home → Your tasks**.
2. Confirm the selected semester is the semester you intend to operate.
3. Check deadlines, recent imports, and recent decisions before changing records.
4. Open the task row itself; counts must lead to the corresponding filtered list.
5. If a task is outside your role, ask an admin or adviser to reassign it. Do not use an admin account to bypass ordinary officer-role testing.

Organization admins can operate every CSF area. Adviser-only responsibilities include academic overrides and reopen. Position-specific access remains narrow: Treasurer handles dues, VP Membership handles applications and members, Secretary handles meetings and attendance, VP Clubs handles partner clubs, VP Publicity and Web Master handle public activity content, Activity Coordinators manage activities and participation, and Data Management handles imports and reconciliation.

## 2. Semester setup

Create graduating classes on **Classes** (Add a class), then manage semesters
on **More → Terms** in this order:

1. Select the term, such as **Fall 2026**, in the term selector. **Start next
   term** advances the chapter when the current semester ends.
2. Enter application, meeting, point, and closeout dates.
3. Under **Chapter rules**, prepare the policy draft: academic thresholds, disqualifying grades, the six List I/II/III × A/B grade-point values, dues, total service points, per-activity cap, drive cap, required meetings, allowed absences, and outside-volunteering rule. The baseline is List I A=3/B=1, List II A=2/B=1, and List III A=1/B=0; A+/A− use A and B+/B− use B.
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

Application decision, membership creation, decision event, and audit/request receipt are one transaction. If the response is lost or the action fails, reload the application before retrying; an exact stable-request replay succeeds only while the same decision and evidence remain current. Do not create a membership manually to compensate.

## 4. Student joining and account connection

### Permanent class join code

1. Open **Classes**, choose the graduating class, then open **Settings**. Use the class join code already assigned to that class; rotate it only when the old code must stop working.
2. Share only that class code or its join URL. Do not distribute a roster export. The public organization and class pages expose no Stream, Activities, membership, or student-derived counts.
3. After the student signs in with a confirmed email, the system may show **We found your CSF record — is this you?**
4. The candidate contains only name, graduating class, term, and limited membership context.
5. If the student confirms, the server atomically connects the account and records history.
6. If the student selects **Not me**, or the email is missing, ambiguous, or conflicts with another link, the request moves to officer review.

Viewing, copying, or rotating a class code does not send an email. The product must not display a sent time or resend count unless an explicit recipient email has entered the durable delivery ledger.

Only a class-code profile-connect flow or combined student-specific invitation may start this workflow. An application-only link is never a profile-claim link. The claimed profile must belong to the code or invitation's cohort. A name-only match never connects an account.

### Student-specific secure link

1. Open the unconnected-student list in **Members** and choose the active student record first.
2. Choose one of the school/personal emails the product lists for that record. The product excludes missing or shared addresses; officers cannot type an arbitrary recipient. If the intended address is absent or belongs to more than one active record, close the dialog and make an audited member correction first.
3. Choose the semester and expiry, then create the link once. The result is a secure link ready to copy; no email is sent.
4. Copy the existing link when the student needs it again. Use **Renew link** only when the old token must stop working, and then share the replacement manually.
5. If a response is lost, reload Members before retrying. The stable request receipt returns the original result only if the selected profile, recorded email, and link remain current; it refuses a changed or stale request.

### Officer review

1. Open **Members → Needs account link** and work the **Matches to review** list. Open the request with **Resolve**, or a ranked candidate with **Review in Resolve**; both open the **Review account connection** dialog.
2. Compare the request with the student's submitted evidence; never match on name alone. Everything under **Suggestions · advisory only** is a discovery aid, including a candidate badged **Canonical evidence ready**. A conflicting cohort, verified email, or existing account is a hard stop.
3. Choose **Connect account** or **Reject request** and enter a **Decision reason** of at least four characters. **Connect account** is rendered only when the account's current confirmed email still matches the request snapshot, appears on exactly one active student record, and that record also has the exact requested name and one matching active class; otherwise the dialog states **Connection unavailable** with the specific blockers and offers only **Reject request**. A unique name is still name-only and never authorizes a connection. If those checks fail, correct the student record through the audited member-correction workflow first, or reject the request and issue a student-specific link to the address you can verify.
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
6. Resolve duplicates, missing targets, malformed dates, `#REF!`, ambiguous identities, and inaccessible evidence. **Use match** requires the member plus a 4–500 character explanation of the evidence. **Skip row** requires a 4–500 character explanation of why the row must not be imported. A failed decision keeps the selection/reason; only success clears it.
7. Commit valid rows explicitly.
8. Review accepted, skipped, failed, and unresolved counts. Expand run details for the recorded operator, abbreviated digest, reconciliation decisions/reasons, and preview/retry ancestry. **Not recorded** is an honest historical value, not zero. Retry corrected rows from the recorded lineage.

Operational rules:

- The encrypted Google connection is scoped to the exact organization, CSF plugin, import purpose, and officer capability approved during OAuth. Google user-info must also verify the exact account `dvhighcsf@gmail.com`; a calendar-email label or officer assertion is not identity evidence. Every token use and refresh rechecks the binding.
- Picker deployment configuration uses a Google OAuth web client and Browser API key from the same Cloud project. The server derives the required numeric Picker app ID from `GOOGLE_CLIENT_ID`; there is no separate public app-ID setting, and file authorization remains limited to `drive.file`.
- A wrong, missing, or legacy-unverified account shows **Switch or reconnect**. Officers must not work around it with another organization's token.
- **Import changes** creates a new immutable snapshot; there is no background sync.
- Application decisions write back to the source sheet: the imported row turns green (approved) or red (rejected) and any officer comment lands as a note on the row's first cell. This is ledger-recorded, retried via **Sync sheet**, and only active where `CSF_SHEET_WRITEBACK_ENABLED` is set; everywhere else the decisions stay queued.
- Beyond that decision write-back, Google Sheets are input-only. Reports download locally as a formula-safe ZIP; there is no timestamped compatibility-tab or report-write destination.
- A second import of the same snapshot must be idempotent.
- Reviewed Let’s Assist fields are never silently overwritten.
- A missing, blank, malformed, non-positive, or implausibly large historical point value blocks that activity; it never becomes one point.
- An invalid meeting timestamp blocks commit until corrected with a recorded reason.
- Partner-club form-response imports are local export uploads, not Drive reads; each previewed row stays immutable until an officer explicitly applies it as a draft club record or skips it.
- If Drive access is lost, reconnect the source. Do not delete the reviewed platform record.
- **Disconnect from CSF** removes the local purpose binding and retains reviewed records/source history. **Disconnect and revoke at Google** is stronger: the product may say revoked only after Google confirms it and must preserve a shared grant still used by another active binding. Treat remote-success/local-cleanup-failure as a recovery state, not complete success.

## 6. Members

Use **Members** to locate the permanent student identity and current-semester record.

1. Search by student or confirmed account; filter by class, connection, application, eligibility, dues, or membership result.
2. Open the member detail before correcting identity, class, account connection, attendance, or points.
3. Record corrections with the source, reason, and current officer identity.
4. Merge duplicate profiles only after confirming both records describe the same person with stable corroborating evidence. The preview must enumerate every moved record and block hard identity conflicts.
5. If merge preview reports an outstanding import target, finish, retry, skip, or reconcile that import first. Settled successful and explicitly terminally skipped rows remain attached to the source tombstone as recovery evidence.
6. Keep completed historical semesters visible; hide empty future terms.

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

Every submit/proof-finalize/withdraw/review/appeal action rechecks current account ownership or reviewer permission, open semester, active membership, published policy, source relationship, cap, class, and finalized proof as applicable. If any of those changed, reload and resolve the current blocker instead of retrying from an older page.

### Meetings

1. Create the required meeting for the semester/class.
2. Import attendance from the exact file, tab, and range.
3. Resolve duplicate submissions, unmatched names, missing email, and invalid timestamps before commit.
4. Add or remove manual attendance only with a reason.
5. Confirm the member sees the exact attended dates and the policy's allowed-absence calculation.

### Partner clubs

1. Use **Add club** to create the canonical club record, or apply a previewed form-response row (step 4) as a draft record.
2. Filter the directory by term — the dropdown is chronological with the current term selected by default — and open a club's row to reach its detail dialog for edits.
3. Approve, suspend, or expire the term standing explicitly, and archive or restore the club from the same dialog; never overwrite a prior semester's standing.
4. Clubs apply and renew through the existing Google Form. Upload the response export with **Import form responses**; rows preview immutably, and each row is either applied as a draft — creating a not-reviewed club record for the term — or skipped.
5. Record the club's spreadsheet link for reference only. The club owns that spreadsheet; the product never reads it.
6. Accept member point claims against a club only while its standing is active for the current term. Vet point types, caps, and proof manually during point approval against the published semester policy; there is no per-club point policy or member-Sheet reconciliation.

## 8. Semester close and reopen

1. Open the close preflight in **Classes → Semester setup**.
2. Resolve every linked blocker: applications, point submissions, appeals, attendance, dues, and import reconciliation.
3. Review the published policy version and the current summary.
4. Submit close only from that preflight. The browser sends the reviewed evidence hash; the server derives each completed or not-completed outcome.
5. If the product reports that records changed after preflight, refresh, review all counts again, and retry. Never bypass the stale-evidence check.
6. After close, verify the revision, completed/not-completed counts, explicit reasons, reports, and each member's frozen My CSF result.

Only the adviser with the explicit permission, or an organization admin exercising admin authority, may reopen. Reopen requires a reason. Make the correction, rerun preflight, and close again; the new revision must preserve the earlier result in history.

## 9. Report downloads and audit history

1. Open **More → Settings** and use the **Download reports** card; the retired Reports tab aliases here.
2. In the modal, select the semester, the report sections to include, and whether to bundle uploaded proof pictures.
3. Download the permission-checked local ZIP. It contains formula-safe CSV files and a manifest; included proof files sit in a proof folder with its own manifest that records anything skipped for size.
4. Reconcile report totals with the underlying filtered list.
5. Use **Change history** to trace consequential actions by actor, reason, source, correlation identifier, and revision.
6. Never copy real student rows, tokens, proof, transcripts, or receipts into tickets, screenshots, fixtures, docs, or Slides.

Reports do not write to Google Sheets and do not expose a Google destination picker.

## 10. Fall 2026 rollout: cohort links, legacy seed, and posts

This section is the one-time cutover procedure from Google Classroom + spreadsheets to Let's Assist, plus the recurring posts/email workflow it enables. Real source files live git-ignored in `docs/csf/source-data/` — see [source data](source-data.md) for every file's layout. Never copy real values out of them.

### 10.1 One-time semester and cohort setup

1. Create cohorts Class of 2027 through Class of 2030 and terms Spring 2025, Fall 2025, Spring 2026 (closed) and Fall 2026 (current) through **Classes** (Add a class) and the **Terms** page (§2). Class of 2026 is out of scope. The Class of 2030 setup creates its cohort and terms only; never import its template workbook. Create each 2030 profile from reviewed current application evidence, then resolve the separate application row to that existing profile as described in §10.3.
2. In **More → Communications → Settings**, use **Check communications setup** and confirm the **Term members** audience reports **Ready**. Officers see only the friendly readiness state; provider topic identifiers remain in platform-admin diagnostics. **Needs provider setup** keeps broadcast queueing disabled rather than guessing a scope. Do not use the generic organization-plugin JSON editor; class posts use the same chapter-announcement unsubscribe boundary.

### 10.2 Legacy data seed (rehearse locally first: `bun run dev`)

Import in this order through the existing Sheets workspace preview → commit fence; every commit is staff-approved and reversible only forward:

1. **Club registry** — `rosters/Spring 2025 CSF Returning Clubs Responses.xlsx` and `rosters/CSF Club Audit Spring 2026 Responses.xlsx` as partner form-response imports; apply each previewed row as a draft club record (or skip it), then review standing per term. There is no per-club point policy to import; use `rosters/Clubs Points.xlsx` only as manual reference evidence when vetting points at approval time.
2. **Historical class records** — import only Class of 2027 `S26` `A1:O168` (167 rows after the header), Class of 2028 `S26` `A1:O168` (167 rows), and Class of 2029 `S26` `A1:N89` (88 rows) as **Historical records**. Class of 2026 is out of scope: do not select, preview, or import it. Skip the template-only Class of 2030 workbook and create 2030 student records through the new application cycle. These sheets are historical evidence, not account-connection evidence; current canonical email, exact-name, and active-class checks still govern every connection.
3. **March 2025 chapter attendance** — `rosters/CSF March Meeting Attendance 2025.xlsx` as `meeting_attendance` for Spring 2025. Name-only rows will land ambiguous/unmatched — resolve what you can; `skipped` is an honest terminal state for departed students.
4. **Per-club Fall 2025 points** — the immutable partner-audit member-Sheet import was removed by the 2026-08-17 partner-clubs simplification, so per-club point workbooks are no longer imported as a `partner_club_audit` batch. Keep the club workbooks as reference evidence and record any historical awards that are still needed through the reviewed point workflows.

Acceptance: the three historical previews use the exact bounded ranges and show 167, 167, and 88 rows respectively; the Class of 2030 template has no import job; every partner form-response row is applied as a draft or skipped and each retained club's term standing is reviewed; ambiguous-row queues are triaged to zero or documented.

### 10.3 Student rollout (replaces the four Classroom codes)

1. For Class of 2030, attach the reviewed new application form to the combined link and keep the template workbook unimported. After a current response arrives, preview it as **Applications**. A targetless response is held for reconciliation and cannot commit.
2. From that reviewed response, use **Members → Add member → Add a student record** to create the permanent Class of 2030 profile with its current unique email. This replay-safe staff action records `profile.create` audit history but creates no imported application, term membership, or account connection.
3. Return to the application preview, select the profile under **Match to member**, enter the required 4–500 character **Match reason**, and select **Use match**. This separate audited reconciliation records the target and source-row reason. Only after every row is resolved or skipped may the officer commit; commit attaches the application to the existing profile but does not decide it.
4. Review the committed application through **Applications → Review queue**. Approval creates or updates term membership atomically with the decision and history; neither the import nor the decision creates the profile. Account connection remains a separate exact-email or reasoned-review action.
5. Before publishing links for Classes of 2027–2029, establish a current, unique school or personal email on each imported historical profile that is expected to support automatic discovery or a student-specific link. Use the current approved application cycle or another reviewed current source, then record the change through the audited member-correction workflow. Never copy an address from the historical comparison workbook merely to make a match.
6. Create four cohort onboarding links (§4) — one per graduating class, Fall 2026 term, combined link type. These replace the Freshman/Sophomore/Junior/Senior Google Classroom codes everywhere the chapter publishes them.
7. A student whose confirmed sign-in email uniquely matches the current email on one same-class profile may see **We found your CSF record — is this you?**, confirm it, pick a username in place, and get the CSF member tour on their **Feed**. The historical class sheet alone can never produce that result.
8. A student whose current unique email has not been established submits a link request instead. Resolve it in **Members → Needs account link → Matches to review**, but understand that **Connect account** remains unavailable until an officer first records current corroborating email evidence through the audited correction workflow. Ranked suggestions only help locate evidence. Never expose roster names to students.

### 10.4 Posts and announcement email

1. Open **Classes**, choose the class, then use **Stream**. Audience `class` targets that one cohort; `members` targets the whole chapter. Members read the result in **Feed**. Pin sparingly.
2. The **Also send this as an email** toggle requests exactly one campaign per post through the durable ledger — retries are safe. A class campaign freezes the current term, exact class cohort, consent topic, content, and recipient snapshot; later member/class changes or post edits do not rewrite it. The result must separately say **Post published** and either **Email queued** or **Email not queued**. A queue failure never means that a persisted post was not saved. The auth-first, bounded, input-free, exact-opt-in `csf-communications-dispatch` route is invoked by a checked-in GitHub Actions schedule. Repeated hosted runs return aggregate truth, but GitHub starts have been irregular despite the ten-minute cron expression. **Email queued** is not **Email delivered**; never promise a fixed delivery time.
3. Recipients can opt out via the link in every announcement email (verify-the-address confirmation). Opt-outs exclude the address from future snapshots automatically; do not hand-manage them.
4. Grant posting rights via the `manage_posts` capability (Publicity VP and Web Master templates carry it; org admins and the owner always can).
5. Review quarantined or unknown provider outcomes in **More → Communications → Delivery issues**. Reconcile only from exact provider evidence; an unknown attempt is never blindly resent. Closing a quarantine item acknowledges human triage and records a reason, but does not apply/rewrite the provider event or change delivery/address safety.
6. **Schedule post** is offered only when the target environment has the publisher explicitly enabled. The transition, fail-closed hold states, authenticated route, pgTAP suite, central replay, and GitHub scheduler are implemented, but a stored due time is still not proof that a particular hosted post entered Feed. Use manual publication until the target environment has a successful enabled worker run and visible schedule → Feed acceptance. Scheduled posts never queue email; publish now first if email is required.

## 11. Troubleshooting and stop rules

| Condition                                                | Officer action                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong connected Google identity                          | Stop before file selection; reconnect the approved chapter account.                                                                                                            |
| Google source says **Reconnect**                         | Reauthorize; keep existing reviewed records.                                                                                                                                   |
| Google Picker says it is not configured                  | Stop and ask an administrator to verify `GOOGLE_CLIENT_ID`, the Picker API key, and their shared Google Cloud project; do not request a broader Drive scope.                   |
| Intended secure-link email is absent/shared              | Close link creation and make an audited member correction first; never type a substitute.                                                                                      |
| Missing or malformed imported point value                | Leave the row unresolved and correct the source mapping/value; never guess.                                                                                                    |
| Invalid meeting timestamp                                | Correct with a reason before commit.                                                                                                                                           |
| Import match/skip action fails                           | Keep the visible member/reason, read the inline error, and retry only after correction.                                                                                        |
| Duplicate or ambiguous profile                           | Send to account-connection review; never search or expose the roster to the student.                                                                                           |
| Application approval is blocked                          | Complete the mandatory check or have the adviser record a reasoned override.                                                                                                   |
| Semester evidence changed                                | Refresh preflight and review again.                                                                                                                                            |
| A mutation partially appears to succeed                  | Stop and inspect Change history before retrying; do not add a compensating manual record.                                                                                      |
| Post says scheduled                                      | Treat it as unpublished until Feed evidence exists. If the target environment lacks an accepted enabled worker run, use manual publication. Scheduled posts never queue email. |
| Post saved but email did not queue                       | Keep the post; correct the named email blocker and use the post's email retry action.                                                                                          |
| Email is queued but dispatch timing is unclear           | Treat it as queued, not delivered. Confirm the hosted worker configuration and invocation evidence; do not promise a fixed delivery time.                                      |
| Email outcome is unknown or webhook is quarantined       | Use Communications recovery with exact provider evidence; never blindly resend or guess.                                                                                       |
| Private data appears on a public route or in an artifact | Treat as P0, stop testing, remove the artifact, and notify the platform owner.                                                                                                 |

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
- [ ] Deploy the super-admin metadata alignment, then prove branch-scoped non-production Supabase parity against the 322-row ordered ledger through `20260818115000`
- [x] Authorize local and hosted Development Google origins/callbacks, including `http://localhost:3001` and `https://dev.lets-assist.com`
- [ ] Complete Google reconnect, revocation, and failure-state verification; the exact chapter identity, Picker selection, and one bounded failed-preview attempt are current Development evidence, not full import acceptance
- [ ] Complete synthetic visible mutation lifecycle for every actor
- [ ] Keyboard, focus, and screen-reader acceptance
- [ ] Three native Google Slides decks created and visually accepted
- [ ] Re-run merge/connection hard-conflict, application-preflight, invitation-telemetry, post partial-success, and import-readiness acceptance added after the August 9 lifecycle audit
- [ ] Verify CSF-owned communications configuration and unknown-outcome reconciliation with `manage_settings`, plus reachable post composition for every `manage_posts` template
- [x] Fresh combined replay/build/static/DV-browser/CSF-browser gates for the exact August 11 root + private-submodule tree
- [ ] Visible exact-recorded-email student-specific link and response-loss replay journeys; no fabricated send telemetry
- [ ] Visible six-value grade-policy edit → publish → recalculation journey with stale-draft refusal
- [ ] Visible import match/skip failure-preservation and truthful history/lineage journey
- [x] Accept the authorized, retry-safe scheduled-post publisher through migration, route, pgTAP, central replay, and repository-owned scheduler
- [x] Prove the visible Development composer schedule/readback/archive lifecycle with synthetic data and no email option
- [ ] Prove an enabled hosted scheduled-post worker invocation and visible synthetic schedule → Feed transition before relying on it in that environment
- [x] Configure and repeatedly verify hosted `csf-communications-dispatch`; document that GitHub scheduling is irregular and does not promise fixed-time delivery

Live chapter Google OAuth, Picker selection, and one bounded Development preview have been performed; the preview stopped at its failed seal after storing 85 rows and committed zero applications. No chapter import commit or Google write has been performed. Development uses a separate hosted Supabase project and exact 321-row parity plus exact served SHA are established for root merge `4e33dd6d938688261a2a0bda060304522d7611da`; the super-admin metadata alignment bringing the candidate to 322 is not yet deployed there. Production has been inspected read-only but not mutated. Vela was not accessed or mutated. The remaining items are action-time release gates, not completed runbook steps.

See [testing and release](testing-and-release.md) for current evidence and residual risk. See the [product contract](product-contract.md) for the full product, permission, data, and acceptance contracts.
