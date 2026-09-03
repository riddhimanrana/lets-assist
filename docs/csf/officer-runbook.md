# DVHS CSF Officer Operations Runbook

**Audience:** organization administrators, adviser, chapter officers, and Data Management
**Current status:** the release candidate includes the repaired member directory search, signed passive account-name review request, typed-name officer review, mixed-grade application import, Drive file identity checks, workbook generation recovery, and the closed source-registration receipt. The complete local root and private-plugin gates pass. Hosted Development has four current workbook registries with eight discovered tabs each and count-only prepared previews. The candidate still needs exact-commit CI, one marked Development deployment, exact-tree hosted browser and load acceptance, and synthetic email settlement. Production remains unchanged until those gates pass.
**Release ledger:** the current repository candidate carries 442 ordered migrations through `20260903033000_csf_class_workbook_source_receipt_contract`; the private Development gitlink is `982cf8f`.
**Authoritative record after review:** Let's Assist

This runbook describes the v1.6 officer workflow. Do not use it for a Production cutover until the current gates in section 12 and [testing and release](testing-and-release.md) pass for the exact integrated tree.

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

Application imports are chapter-wide. In **Applications**, choose the response spreadsheet once. Do not assign a graduating class to the source. The preview derives the class and semester for each row from retained source fields, splits multiline course entries into separate course records, and blocks any unconfigured or changed target. Reusing a source follows its immutable Drive file id even if its title changes.

## 4. Student joining and account connection

### Permanent class join code

The class join code is the only student connection path. Each graduating class holds one permanent 6-character code. The alphabet omits O, I, 0, and 1. Connecting through it joins the lasting graduating class only. Semester membership still comes from an accepted application or an approved roster import.

1. Open **Classes**, choose the graduating class, and select **Invite students**. **Copy** shares the active code; **Regenerate code** replaces it only when the old code must stop working; **Disable code** withdraws it without a replacement. A class without a code offers **Create code**.
2. Share only that class code or its `/connect/<code>` URL. Do not distribute a roster export. The public organization and class pages expose no Stream, Activities, membership, or student-derived counts.
3. The student enters the code at the public `/connect/<code>` route, or types it into **Join code** on **Join a class**, then creates or signs in to a verified Let's Assist account.
4. One active same-class record carrying the verified account email connects atomically with recorded history.
5. If email does not match, the server may show **Is this you?** with one exact account-name candidate. The card contains the record name and class only. **Yes, this is me** creates or reuses one officer request. **No, search again** opens the manual search. Name evidence never connects the account.
6. A locked recheck rejects a changed, duplicated, claimed, cross-class, or stale candidate and preserves one review request when the evidence remains valid. The durable state says **Your record is awaiting review** and offers **Go to class feed** while an officer checks the match.
7. If the student enters a name manually, the name never creates or links a profile. One exact verified-email record may still connect. Every other typed-name result creates or reuses one request under **Record connections** in that class.

Viewing, copying, regenerating, or disabling a class code does not send an email. The product must not display a sent time or resend count unless an explicit recipient email has entered the durable delivery ledger.

Only the class join code starts this workflow, and the connected profile must belong to the code's graduating class. Officers never connect from a name alone. The passive account-name card supplies signed, short-lived review context and does not bypass the officer queue.

### Officer review

1. Open the class's **Members** tab and work **Record connections**, where the panel says **Review accounts waiting to connect to a student record in this class.** The queue is paged with **First page** and **Next**. **Home** shows a **Connection requests** chip with the total pending count, linking to the classes hub. Open the request with **Review**, or a ranked candidate with **Review in Resolve**; both open the **Review account connection** dialog.
2. Compare the request with the student's submitted evidence; never match on a typed name alone. Everything under **Suggestions · advisory only** is a discovery aid, including a candidate badged **Canonical evidence ready**. A conflicting cohort, verified email, or existing account is a hard stop.
3. Choose **Connect account** or **Reject request** and enter a **Decision reason** of at least four characters. **Connect account** is rendered only when the account's current confirmed email still matches the request snapshot, appears on exactly one active student record, and that record also has the exact requested name and one matching active class; otherwise the dialog states **Connection unavailable** with the specific blockers and offers only **Reject request**. A unique name is still name-only and never authorizes a connection. If those checks fail, correct the student record through the audited member-correction workflow first, then have the student join with the class code again.
4. If the student already has an accepted application for the same cohort and term, the atomic connection may activate that term membership.
5. Use unlink/relink only to correct a documented error and always include a reason.

An existing verified account cannot assign itself to a class through this request; it must already have the matching active cohort and no conflicting active cohort. The server locks and revalidates any accepted application before activation. An idempotent retry also rechecks the current profile, organization membership, cohort, and audit evidence; a revoked or conflicting stale result returns to officer review.

An existing organization admin or staff role is never downgraded when a profile is connected.

## 5. Google Drive and Sheets imports

Hosted Development Google acceptance is not complete for this exact candidate.
Until it passes, use synthetic local sources for implementation checks.

### Development preview

After the Development gate opens, a real chapter workbook may be inspected only
through a bounded, protected preview:

1. Confirm the connected Drive identity shown by the product is exactly `dvhighcsf@gmail.com`. Stop if it is not.
2. Select the native Sheet with Google Picker or upload a local `.xlsx` through the separate upload path. Treat the Drive file id and provider version as source identity. The title is display text only.
3. Choose the exact tab and a bounded range.
4. Map stable source columns by index/key, not only by display header.
5. Preview normalized rows and their resolved cohort/term.
6. Resolve duplicates, missing targets, malformed dates, `#REF!`, ambiguous identities, and inaccessible evidence. **Use match** requires the member plus a 4–500 character explanation of the evidence. **Skip row** requires a 4–500 character explanation of why the row must not be imported. A failed decision keeps the selection/reason; only success clears it.

Stop before committing real chapter rows. Record count-only reconciliation with
no names, email addresses, comments, join codes, source values, or evidence.
Sanitized synthetic clones may exercise the commit and review steps in hosted
Development.

### Production commit

Only after exact-tree Development acceptance and separate Production
authorization:

1. Re-select the exact Drive file, tab, and bounded range. Recheck its provider version, mappings, authorization, reconciliation decisions, and commit blockers.
2. Freeze and approve the ready previews, then commit valid rows explicitly.
3. Review accepted, skipped, failed, and unresolved counts. Expand run details for the recorded operator, abbreviated digest, reconciliation decisions/reasons, and preview/retry ancestry. **Not recorded** is an honest historical value, not zero. Retry corrected rows from the recorded lineage.

Operational rules:

- The encrypted Google connection is scoped to the exact organization, CSF plugin, import purpose, and officer capability approved during OAuth. Google user-info must also verify the exact account `dvhighcsf@gmail.com`; a calendar-email label or officer assertion is not identity evidence. Every token use and refresh rechecks the binding.
- Picker deployment configuration uses a Google OAuth web client and Browser API key from the same Cloud project. The server derives the required numeric Picker app ID from `GOOGLE_CLIENT_ID`; there is no separate public app-ID setting, and file authorization remains limited to `drive.file`.
- A wrong, missing, or legacy-unverified account shows **Switch or reconnect**. Officers must not work around it with another organization's token.
- An application import starts only from an explicit officer action. A linked class workbook uses a leased metadata check. An unchanged provider version reads no tabs. A changed version queues preparation for new or changed canonical tabs, but an officer still approves the frozen previews before commit.
- Application decisions write back to the source sheet: the imported row turns green (approved) or red (rejected) and any officer comment lands as a note on the row's first cell. This is ledger-recorded, retried via **Sync sheet**, and only active where `CSF_SHEET_WRITEBACK_ENABLED` is set; everywhere else the decisions stay queued.
- Beyond that decision write-back, Google Sheets are input-only. Reports download locally as a formula-safe ZIP; there is no timestamped compatibility-tab or report-write destination.
- A second import of the same snapshot must be idempotent.
- Reviewed Let’s Assist fields are never silently overwritten.
- A repeated activity slot becomes one point only when the saved source mode is `one_per_populated_slot`. A missing, blank, malformed, non-positive, or implausibly large explicit point value blocks that activity.
- An invalid meeting timestamp blocks commit until corrected with a recorded reason.
- Partner-club form-response imports are local export uploads, not Drive reads; each previewed row stays immutable until an officer explicitly applies it as a draft club record or skips it.
- If Drive access is lost, reconnect the source. Do not delete the reviewed platform record.
- **Disconnect from CSF** removes the local purpose binding and retains reviewed records/source history. **Disconnect and revoke at Google** is stronger: the product may say revoked only after Google confirms it and must preserve a shared grant still used by another active binding. Treat remote-success/local-cleanup-failure as a recovery state, not complete success.

## 6. Members

Use **Members** to locate the permanent student identity and current-semester record.

1. Search by student or confirmed account; filter by class, connection, application, eligibility, dues, or membership result. Search starts after two characters with a 300 ms debounce. Officers may press **Search** to submit immediately. Clearing the field reloads the directory. Search resets paging and preserves the selected class, semester, filters, sort, and view.
2. Use **Edit** on the member row for identity, contact, class, or an explicit
   semester application status change. The row uses the semester selected in
   the class header. Leave **Application status** unchanged for detail-only
   edits.
3. Open the member detail for account connection, attendance, points, notes,
   and duplicate-record corrections. Record the source, reason, and current
   officer identity where the correction flow requests them.
4. Merge duplicate profiles only after confirming both records describe the same person with stable corroborating evidence. The preview must enumerate every moved record and block hard identity conflicts.
5. If merge preview reports an outstanding import target, finish, retry, skip, or reconcile that import first. Settled successful and explicitly terminally skipped rows remain attached to the source tombstone as recovery evidence.
6. Keep completed historical semesters visible; hide empty future terms.

The member's **My CSF** view should agree with the officer record for application, eligibility, dues, attendance dates, points, decision, and deadlines.

### Appeals

Appeals arrive outside the app (the semester appeal form). Resolve each one directly on the member's profile:

1. Open the member detail and select the disputed semester.
2. Fix the record in place: correct a meeting's attendance with a reason, review or re-review a point submission, add missing points, or fix identity through edit or merge.
3. Add an officer note tagged **Appealed** stating what was claimed, what evidence was checked, and what changed. The note is the durable appeal record; denials get a note with no record change.

Notes are officer-only and redactable, never deletable. Every correction writes the same audit trail as any other officer change.

## 7. Activities, points, meetings, and partner clubs

### Activities

1. Create the activity as a draft with term, audience, date, location, signup method, point type/value/cap, and evidence rule.
2. Preview it as a member before publishing.
3. Publish only complete activities. Close, cancel, or archive with the matching operational state instead of deleting history.

### Point submissions

1. Open the submission and inspect the selected activity or club, member description, claimed points, configured point rule, proof, and any existing appeal. A partner-club claim also shows the club's review state and saved spreadsheet reference.
2. Request correction, reject, adjust, or approve with the required reason.
3. An Activity Coordinator may verify participation but cannot perform final point processing unless separately granted.
4. Verify the awarded quantity in the member's My CSF view. Multiple points are one numeric award, not repeated one-point rows.
5. Process an open appeal from the same evidence panel as a separate reasoned decision; do not edit the original decision out of history.

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

## 10. Fall 2026 rollout: class join codes, legacy seed, and posts

This section is the one-time cutover procedure from Google Classroom + spreadsheets to Let's Assist, plus the recurring posts/email workflow it enables. Real source files live git-ignored in `docs/csf/source-data/` — see [source data](source-data.md) for every file's layout. Never copy real values out of them.

### 10.1 One-time semester and cohort setup

1. Create cohorts Class of 2027 through Class of 2030 and terms Spring 2025, Fall 2025, Spring 2026 (closed) and Fall 2026 (current) through **Classes** (Add a class) and the **Terms** page (§2). Class of 2026 is out of scope. Link the Class of 2030 workbook so its canonical semester templates are tracked, but do not commit an empty tab. Create each 2030 profile from reviewed current application evidence, then resolve the separate application row to that existing profile as described in §10.3.
2. In **More → Communications → Settings**, use **Check communications setup** and confirm the **Term members** audience reports **Ready**. Officers see only the friendly readiness state; provider topic identifiers remain in platform-admin diagnostics. **Needs provider setup** keeps broadcast queueing disabled rather than guessing a scope. Do not use the generic organization-plugin JSON editor; class posts use the same chapter-announcement unsubscribe boundary.

### 10.2 Legacy data seed (rehearse locally first: `bun run dev`)

Import in this order through the existing Sheets workspace preview → commit fence; every commit is staff-approved and reversible only forward:

1. **Club registry** — `rosters/Spring 2025 CSF Returning Clubs Responses.xlsx` and `rosters/CSF Club Audit Spring 2026 Responses.xlsx` as partner form-response imports; apply each previewed row as a draft club record (or skip it), then review standing per term. There is no per-club point policy to import; use `rosters/Clubs Points.xlsx` only as manual reference evidence when vetting points at approval time.
2. **Historical class records.** Link each approved Class of 2027 through Class of 2030 workbook once by its verified Drive file id. The title is not source identity. The importer discovers every canonical semester tab and records whether it is populated or an empty template. It preserves each bounded range and refuses a populated tab whose class semester has not been configured. Review each populated tab before commit. Numbered activity slots use the source's recorded `one_per_populated_slot` mode. Each occupied plain-label slot is one point for that student, while one explicit numeric quantity for the same activity is authoritative. Conflicting, non-positive, malformed, or over-100 quantities block the row. Class of 2026 is out of scope. Do not select, preview, or import it. Empty Class of 2030 tabs remain linked but create no profiles, applications, points, meetings, or attendance. These sheets are historical evidence. The signed account-name confirmation and officer-review rules still govern every connection.
3. **March 2025 chapter attendance** — `rosters/CSF March Meeting Attendance 2025.xlsx` as `meeting_attendance` for Spring 2025. Name-only rows will land ambiguous/unmatched — resolve what you can; `skipped` is an honest terminal state for departed students.
4. **Per-club Fall 2025 points** — the immutable partner-audit member-Sheet import was removed by the 2026-08-17 partner-clubs simplification, so per-club point workbooks are no longer imported as a `partner_club_audit` batch. Keep the club workbooks as reference evidence and record any historical awards that are still needed through the reviewed point workflows.

Acceptance: every populated canonical tab discovered in the approved Class of 2027–2030 workbooks has one immutable preview and a configured class semester; header-only future tabs remain linked as empty templates and create no student records; preview provenance records the point mode, exact activity and meeting cells, coordinates, and a server-derived evidence digest; every partner form-response row is applied as a draft or skipped and each retained club's term standing is reviewed; ambiguous-row queues are triaged to zero or documented.

### 10.3 Student rollout (replaces the four Classroom codes)

1. Record the reviewed new application form URL in Fall 2026's **Application form link** (**Term actions → Edit term**) and keep the linked Class of 2030 template tabs uncommitted while they are empty. The public class page offers the form only while the term is current and inside the application window. After responses arrive, select the chapter application spreadsheet in **Applications**. The source has no fixed class. Each preview row derives its configured class and semester. A targetless response is held for reconciliation and cannot commit.
2. From that reviewed response, use **Members → Add member → Add a student record** to create the permanent Class of 2030 profile with its current unique email. This replay-safe staff action records `profile.create` audit history but creates no imported application, term membership, or account connection.
3. Return to the application preview, select the profile under **Match to member**, enter the required 4–500 character **Match reason**, and select **Use match**. This separate audited reconciliation records the target and source-row reason. Only after every row is resolved or skipped may the officer commit; commit attaches the application to the existing profile but does not decide it.
4. Review the committed application through **Applications → Review queue**. Approval creates or updates term membership atomically with the decision and history; neither the import nor the decision creates the profile. Account connection remains a separate exact-email or reasoned-review action.
5. Before sharing class join codes, establish a current, unique school or personal email on imported historical profiles when reviewed evidence is available. This remains the strongest automatic match. Never copy an address from a historical comparison workbook merely to make a match.
6. Confirm each class's permanent join code from **Invite students** (§4) — one per graduating class. These codes replace the Freshman/Sophomore/Junior/Senior Google Classroom codes everywhere the chapter publishes them.
7. A student whose verified sign-in email uniquely matches one same-class profile connects automatically. If email does not match, the product may show one exact passive account-name candidate with name and class only. **Yes, this is me** creates or reuses one officer request; name evidence never links the account.
8. A manually entered name never creates or links a profile. Ambiguous, stale, claimed, conflicting, or unmatched typed-name results create or reuse one request in **Members → Record connections**. Officers use the reasoned review flow. Never expose a searchable roster to students.
9. An unmatched verified email never creates a profile or class membership. Create a missing permanent student record only through the audited **Add a student record** workflow and reviewed evidence.

### 10.4 Posts and announcement email

1. Open **Classes**, choose the class, then use **Stream**. Audience `class` targets that one cohort; `members` targets the whole chapter. Members read the result in **Feed**. Pin sparingly.
2. The **Also send this as an email** toggle requests exactly one campaign per post through the durable ledger. Retries are safe. A class campaign freezes the current term, exact class cohort, consent topic, content, and recipient snapshot; later member/class changes or post edits do not rewrite it. The result must separately say **Post published** and either **Email queued** or **Email not queued**. A queue failure never means that a persisted post was not saved. The auth-first, bounded, input-free, exact-opt-in `csf-communications-dispatch` route is invoked by a checked-in Vercel schedule that requests a run every minute. Hosted starts can vary. **Email queued** is not **Email delivered**; never promise a fixed delivery time. The GitHub workflow remains a manual Production-approval fallback.
3. Recipients can opt out via the link in every announcement email (verify-the-address confirmation). Opt-outs exclude the address from future snapshots automatically; do not hand-manage them.
4. Grant posting rights via the `manage_posts` capability (Publicity VP and Web Master templates carry it; org admins and the owner always can).
5. Review quarantined or unknown provider outcomes in **More → Communications → Delivery issues**. Reconcile only from exact provider evidence; an unknown attempt is never blindly resent. Closing a quarantine item acknowledges human triage and records a reason, but does not apply/rewrite the provider event or change delivery/address safety.
6. **Schedule post** is offered only when the target environment has the publisher explicitly enabled. The transition, fail-closed hold states, authenticated route, pgTAP suite, central replay, and GitHub scheduler are implemented, but a stored due time is still not proof that a particular hosted post entered Feed. Use manual publication until the target environment has a successful enabled worker run and visible schedule → Feed acceptance. Scheduled posts never queue email; publish now first if email is required.

## 11. Troubleshooting and stop rules

| Condition                                                        | Officer action                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong connected Google identity                                  | Stop before file selection; reconnect the approved chapter account.                                                                                                                                     |
| Google source says **Reconnect**                                 | Reauthorize; keep existing reviewed records.                                                                                                                                                            |
| Google Picker says it is not configured                          | Stop and ask an administrator to verify `GOOGLE_CLIENT_ID`, the Picker API key, and their shared Google Cloud project; do not request a broader Drive scope.                                            |
| Roster email for an officer-reviewed connection is absent/shared | Record the current unique address through an audited member correction first. Do not type a substitute or connect from the submitted name. The member-confirmed passive path has its own signed checks. |
| Missing or malformed imported point value                        | Leave the row unresolved and correct the source mapping/value; never guess.                                                                                                                             |
| Invalid meeting timestamp                                        | Correct with a reason before commit.                                                                                                                                                                    |
| Import match/skip action fails                                   | Keep the visible member/reason, read the inline error, and retry only after correction.                                                                                                                 |
| Duplicate or ambiguous profile                                   | Send to account-connection review; never search or expose the roster to the student.                                                                                                                    |
| Application approval is blocked                                  | Complete the mandatory check or have the adviser record a reasoned override.                                                                                                                            |
| Semester evidence changed                                        | Refresh preflight and review again.                                                                                                                                                                     |
| A mutation partially appears to succeed                          | Stop and inspect Change history before retrying; do not add a compensating manual record.                                                                                                               |
| Post says scheduled                                              | Treat it as unpublished until Feed evidence exists. If the target environment lacks an accepted enabled worker run, use manual publication. Scheduled posts never queue email.                          |
| Post saved but email did not queue                               | Keep the post; correct the named email blocker and use the post's email retry action.                                                                                                                   |
| Email is queued but dispatch timing is unclear                   | Treat it as queued, not delivered. Confirm the hosted worker configuration and invocation evidence; do not promise a fixed delivery time.                                                               |
| Email outcome is unknown or webhook is quarantined               | Use Communications recovery with exact provider evidence; never blindly resend or guess.                                                                                                                |
| Private data appears on a public route or in an artifact         | Treat as P0, stop testing, remove the artifact, and notify the platform owner.                                                                                                                          |

## 12. Current release checklist

Before this runbook is used for the chapter cutover, complete these gates in order:

- [x] Candidate includes server-backed member search with filter preservation and bounded results.
- [x] Candidate routes passive and typed name-only confirmation through one officer-review boundary.
- [x] Candidate treats the application response workbook as one chapter source and derives class and semester per row.
- [x] Candidate stores Drive file identity and provider version instead of trusting titles.
- [x] Ordinary feature branches are disabled. Unmarked Development commits may create an ignored deployment record but do not run dependency installation or the application build.
- [x] Merge and publish the private plugin first, then advance the root gitlink to private `development` `982cf8f`.
- [x] Pass the complete private-plugin tests, root TypeScript, zero-warning lint, database validation and replay, CSF workflows, browser journeys, strict submodule check, scale tests, and Production build on the exact integrated tree.
- [ ] Create one marked Development deployment after local gates. Record its exact root and private SHAs.
- [ ] Apply and verify the candidate migrations in hosted Development before browser mutation tests.
- [ ] Verify exact-email connection, passive account-name confirmation, typed-name pending review, officer resolution, member search, and pending-state recovery with fictional Development records.
- [ ] Import a sanitized synthetic clone of the chapter application source in Development. Confirm row-specific class and semester mapping, multiline course parsing, reconciliation, commit, and application review.
- [ ] Inspect the approved real application and class workbooks in Development only through bounded, protected previews. Verify Drive file identity, discovered canonical tabs, empty future templates, and count-only reconciliation without committing chapter rows.
- [ ] Have one officer approve frozen previews from sanitized synthetic clones in Development. Conflicted, stale, and unresolved previews remain blocked.
- [ ] Run the 90-member and 10-officer hosted load, route latency, browser memory, and Web Vitals gates against that exact Development tree.
- [ ] Prove synthetic Development post email queueing, provider acceptance, signed webhook settlement, and recovery without contacting students.
- [ ] Promote only the exact accepted tree through one Production pull request merged with a merge commit. Do not squash or rebase. Keep `main` Git deployment disabled. The confirmed Production workflow prebuilds the accepted tree, applies and verifies migrations, then explicitly deploys those prebuilt application bytes. Keep workers disabled during smoke checks, then enable workbook, import, and email workers in that order.
- [ ] Require one final officer batch confirmation in Production before any real application or class workbook changes commit.

Do not record names, email addresses, comments, join codes, source rows, or proof in release logs, reports, screenshots, or recordings. Production stays unchanged until every Development gate above has exact-tree evidence.

See [testing and release](testing-and-release.md) for current evidence and residual risk. See the [product contract](product-contract.md) for the full product, permission, data, and acceptance contracts.
