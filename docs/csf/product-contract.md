# DVHS CSF Product and Operational Specification

**Status:** Approved implementation source of truth<br>
**Version:** 1.4<br>
**Last updated:** August 17, 2026<br>
**Product surface:** DVHS CSF private organization plugin inside Let’s Assist

This document defines the product, operating model, information architecture, terminology, data boundaries, workflows, page behavior, and acceptance criteria for the DVHS CSF rebuild. If current code, old mockups, seed data, or earlier labels conflict with this document, this document wins unless it is amended explicitly.

## Amendment record

### Amendment 1 — Member posts and chapter email delivery (v1.1, August 6, 2026)

Version 1.0 removed the Communications/Updates surface and treated Google Classroom as the chapter’s announcement channel. The chapter has since decided to retire Google Classroom for CSF and make Let’s Assist the member home. This amendment reinstates a deliberately narrow communications surface:

- **Cohort posts.** Officers publish posts to a member feed scoped to `members`, a single graduating-class cohort (`class`), `officers`, or `public`. Posts support pinning. Scheduling is offered only when the target environment explicitly enables the accepted due-post publisher; a stored due time is not publication evidence, and scheduled posts never queue email. Posts have **no comments** (see Amendment 2: member comments stay excluded; officers may append follow-up replies) and no read-tracking.
- **Per-post email delivery.** Publishing a post may optionally queue exactly one email campaign through the existing durable communications ledger (audience snapshot, content digest, leased dispatch, provider-event reconciliation). Delivery status is reported from ledger state; there are no simulated delivery claims.
- **Recipient control.** Broadcast email honors the opt-out ledger and Resend topic one-click unsubscribe, plus a recipient-facing verify-your-address unsubscribe flow. Transactional mail is unaffected.
- **What stays prohibited:** internal direct messaging, comments, any Google Classroom API or posting simulator, and delivery claims not backed by ledger/provider events.

Clauses amended by this record are annotated “(amended v1.1)” in place. Where v1.0 text conflicts with this record, this record wins.

### Amendment 2 — Officer follow-up replies and the unified member stream (v1.2, August 7, 2026)

- **Member comments remain excluded.** Nothing in this amendment gives members a composer; the Amendment 1 prohibition on member comments stands.
- **Officer follow-up replies.** Officers holding `manage_posts` may append follow-up replies to their chapter’s published posts. A reply inherits the parent post’s audience, is **never emailed**, and carries no pin and no audience of its own. Anyone who can see the parent post can read its replies. Deleting a reply is limited to the reply’s author or an organization admin. Add and delete are tenant-bound, permission-rechecked under the staff-access lock, atomic with their immutable audit receipt, and replay-safe through one stable request identifier.
- **Unified member stream.** The member feed carries announcements and published activities as one reverse-chronological stream ordered by publication time. Deadlines and meetings do not enter the feed; they remain date-anchored agenda items in the rail.

Clauses amended by this record are annotated “(see Amendment 2)” in place. Where earlier text conflicts with this record, this record wins.

### Amendment 3 — Lifecycle truth and operator safety (v1.3, August 9, 2026)

The complete synthetic officer/member walkthrough found several surfaces where the UI could describe a state the server had not proved. This amendment makes operator truth a release boundary:

- **Identity and application decisions.** A merge, connection, or approval uses one server-derived preflight. Similar names are never sufficient; hard identity conflicts and failed, missing, or stale academic evidence block the ordinary decision path everywhere, including confirmation dialogs.
- **Links are not email.** Creating, copying, or renewing an onboarding link changes link state only. A student-specific link may use only a current, unique school or personal email recorded on the selected active profile; officers correct the record before link creation rather than type an arbitrary recipient. Sent timestamps, resend counts, and delivery language require a durable recipient delivery receipt.
- **Policy values are operative data.** The semester draft exposes the six List I/II/III × A/B grade-point values that drive application calculation. Plus/minus variants inherit the base letter, drafts do not govern until publication, and saved advanced grade keys are not silently discarded.
- **Posts and announcement email.** `manage_posts` grants a reachable composer and post-linked email request. Post persistence and email queueing have separate, truthful outcomes; a queue failure may never claim that a persisted post was not saved. A post-linked campaign freezes its term, audience, exact class coordinate, recipient snapshot, and content before dispatch.
- **Queue is not delivery.** The durable announcement ledger and `csf-communications-dispatch` route are implemented. The route authenticates before any work, accepts no organization/message input, runs only when `CSF_COMMUNICATIONS_WORKER_ENABLED` is exactly `true`, bounds each invocation, and participates in the isolated cron no-egress probe. Production Vercel Pro now invokes the route every ten minutes through `vercel.json`. Repeated runtime starts and an authenticated response showing `enabled: true`, zero campaigns, zero faults, and no delivery outcomes establish hosted invocation without contacting recipients. **Email queued** still means only that durable queueing succeeded; delivery remains a separate provider outcome, and operator copy must not promise a fixed delivery time.
- **Scheduling is environment-gated publication.** The permission-rechecked, serialized, retry-safe, atomic/audited due-post publisher and its bounded auth-first route pass migration, pgTAP, central replay, and repository cadence acceptance. The checked-in GitHub schedule runs only from the default branch and makes no fixed-time promise. A target environment must still prove exact opt-in, a successful aggregate-only invocation, and visible schedule → Feed behavior before operators rely on it there. Scheduled posts never queue email.
- **Imports.** One server-derived blocker list controls job status, summary copy, and commit availability. A failed, stale, inaccessible, unresolved, or incomplete job cannot look ready. Match/skip decisions require a visible officer reason, and history displays only facts actually recorded for that run.
- **Google and email recovery.** A CSF import connection is valid only after Google verifies the exact approved chapter account. Disconnect preserves reviewed records and provenance. Unknown delivery outcomes and quarantined webhook events may be reconciled only from provider evidence; triage never silently sends, retries, suppresses, or rewrites an event.
- **Google Sheets are input-only in this release.** Reports are local formula-safe ZIP archives. There is no Google report destination, compatibility-tab writer, or Sheet writeback.
- **Action and recovery states.** Mutating controls show pending, named success, and named failure states, prevent duplicate activation, and close only after confirmed success. Authorized CSF settings operators can configure communications and reconcile durable unknown outcomes from a CSF-owned surface.

This amendment also resolves older navigation and Classroom wording: the member order is **Feed, Activities, Point submissions, My CSF**, and Google Classroom is retired rather than an active manual broadcast step.

### Amendment 4 — The Terms page (v1.4, August 17, 2026)

Semester management moves out of the Classes tab into a dedicated **Terms**
page under **More**. The Classes tab keeps only the class picker and **Add a
class**. This amendment supersedes the Classes-embedded semester views in
§6.1, §6.3, §6.4, and §8.14–8.16 as follows:

- **One page, one term.** Terms shows a term selector (the chapter's history is
  the selector — closed terms are ordinary entries marked archived), the
  selected term's dates and application window, its deadlines, and its meeting
  schedule. There is no Schedule/Policy/Previous-semesters sub-navigation.
- **Lifecycle actions.** **Start next term** derives the next operating period
  from the current term (Fall 2026 → Spring 2027): if the next term record
  exists it is made current, otherwise it is created prefilled and made current
  in one step. **Archive term** keeps its blocking server preflight, rendered
  inside the archive dialog; the submit stays locked while blockers remain.
  Reopening a closed term is an affordance shown only when a closed term is
  selected, with the same reasoned, audited flow.
- **Chapter rules.** The versioned policy record is presented as a collapsed,
  adviser-gated **Chapter rules** section: a compact statement of the published
  values with the draft editor and publication controls behind an explicit Edit
  disclosure. Draft/publish semantics, policy versioning, and immutability are
  unchanged; only the presentation shrinks. Policy values remain operative data
  and are never hard-coded.
- **Class administration.** Per-class semester records, archived classes, and
  the exceptional **Add one semester** repair live behind a collapsed **Class
  administration** disclosure on the Terms page.
- **The chapter cutover guide is removed.** Concrete missing setup is stated
  where it blocks the action that needs it (for example, inside the archive
  preflight), not as a standing checklist.
- **Canonical URLs.** Terms is `/organization/:slug?tab=csf-terms` with
  `csf_term=:id` selecting a term and `csf_rules=open` expanding Chapter rules.
  Legacy `tab=csf-cohorts` links carrying `csf_semester_view` (any value) alias
  onto the Terms tab; `csf_semester_view=policy|advanced` opens Chapter rules.
  Class-workspace URLs (`csf_cohort` present) never redirect.

Where earlier text conflicts with this record, this record wins.

### Amendment 5 — Class join codes replace onboarding links (v1.5, August 23, 2026)

The onboarding-link system is retired (`20260823210000`–`20260823212000`):
reusable class links, student-specific direct invitations, the profile-claim
confirm/decline flow, the organization-level account-connections view, and
officer student-record search no longer exist. One student connection path
remains:

- **Permanent class join code.** Each graduating class holds one permanent
  6-character code drawn from a 32-letter alphabet that omits 0/O/1/I. The
  class page's **Invite students** dialog shows it with **Copy**, and offers
  **Create code**, **Regenerate code** (the replaced code stops working
  immediately), and **Disable code**. Code state carries no send telemetry,
  and no code action emails anyone.
- **Student journey.** A student opens the public `/connect/<code>` route or
  enters the code in the **Class join code** form, signs in with a verified
  account, and submits the **Find my record** details.
  `csf_join_class_by_code` uses the verified account email as the only
  automatic signal: one active same-class email match connects atomically with
  recorded history; zero matches create a new stable profile from the account
  identity; a conflicting account or class assignment, or an email shared by
  several records, creates a review request instead. Joining connects the
  lasting graduating class only and never activates semester membership.
- **Per-class review.** Unresolved joins wait in that class's Members tab
  under **Needs attention**, paged by `csf_connect_cursor`. The **Resolve**
  dialog renders **Connect account** only when the database confirms canonical
  evidence — the confirmed account email matching the roster email, the exact
  name, and exactly one matching active class membership; **Reject request**
  is always available, with a required decision reason. Officer Home shows a
  **Connection requests** chip with the total pending count.
- **Application form link.** The public apply call to action comes from the
  per-term `application_form_url`, edited in the term dialog's **Application
  form link** field and rendered only while that term is current and inside
  its application window.

Clauses about onboarding links, invitations, profile claims, or the account
connections view in earlier sections (§8.5, §9.5, §19.22–23, §22.1) are
superseded and annotated in place. Where earlier text conflicts with this
record, this record wins.

---

## 1. Executive decision record

The DVHS CSF product is a private academic-membership operations workspace for Dougherty Valley High School’s California Scholarship Federation chapter. Its primary job is to help officers and the faculty adviser turn semester application data into accurate, reviewable membership records.

The product is not a general club-management dashboard, a spreadsheet replica, a school payment processor, or a replacement for Google Classroom.

The rebuild is governed by these decisions:

1. **The permanent student record is separate from every semester application and membership.** A student may apply in many semesters; each application and completed membership outcome remains historically accurate.
2. **Academic eligibility, dues, the application decision, and end-of-semester participation are separate state dimensions.** “Approved” never implies that all service or meeting requirements have already been completed.
3. **Google Forms and Sheets remain controlled intake and import channels.** Google Drive remains the location of source documents. Once an officer commits and reconciles an import, Let’s Assist is the operational source of truth for the normalized record. This release performs no Google Sheet writeback or report export to Google; reports download as a local ZIP.
4. **Google Classroom is retired for CSF; announcements live in the product (amended v1.1).** There is still no Classroom API or posting simulator. Chapter announcements are cohort-scoped member posts with optional ledger-backed email delivery, per Amendment 1.
5. **Cutover is staged and officer-approved.** There is no permanent dual-write model and no silent synchronization over reviewed platform data.
6. **The officer experience lives inside the familiar Let’s Assist organization shell.** DVHS CSF contributes purpose-built routes and workflows without replacing the host header, type system, theme, or organization identity.
7. **Every displayed status names a real condition and a next action.** Generic “risk,” “readiness,” “health,” or “review inbox” abstractions are prohibited.
8. **Private student data is server-only.** No roster, application, transcript, receipt, attendance, point proof, notes, or membership history is public or directly queryable by a browser client.

---

## 2. Evidence and current operating model

### 2.1 Evidence reviewed

This specification is based on the existing plugin implementation and schema, local fixtures and tests, the current DVHS CSF website, and read-only review of the chapter’s connected Google Drive structure. Private source material is summarized only at the workflow level; no real student record belongs in this specification, seeds, screenshots, or tests.

Observed operating evidence includes:

- A semester application response sheet with identity, verified-contact, grade level, returning/new status, course-list entries, academic point totals, transcript evidence, dues receipt evidence, and other application confirmations.
- Per-graduating-class workbooks with one tab per semester and repeated activity columns, meeting-attendance columns, and a final requirement result.
- Returning-club and club-audit forms that collect point-allocation rules, recordkeeping method, activities, drives, membership, communications, spreadsheet proof, and verification consent.
- A yearly timeline with separate fall and spring application windows, monthly full-chapter meetings, officer meetings, point deadlines, and merchandise/regalia operations.
- Officer responsibility documents covering application review, appeals, point processing, attendance, club audits, large events, email and Classroom reminders, dues/fundraising, merchandise/regalia, public information, and activity discovery.
- Current chapter guidance published at [dvhighcsf.org/membership](https://www.dvhighcsf.org/membership) and [dvhighcsf.org/seniors](https://www.dvhighcsf.org/seniors).

### 2.2 What CSF membership means in this product

CSF membership is earned one semester at a time. A student first demonstrates academic eligibility using qualifying courses and grades, provides required evidence, satisfies chapter application requirements such as dues, and receives a chapter decision. After approval, the student completes any term-specific participation requirements, such as meetings and approved service points. At term close, the platform records whether that semester membership was completed.

The platform therefore treats these as different questions:

- Did the student submit enough information to review the application?
- Does the student meet the academic rules for this semester?
- Has the required dues evidence been verified or waived?
- Did an authorized reviewer approve or reject the application?
- After approval, did the student complete the semester’s meeting and service requirements?
- How many completed membership semesters count toward senior recognition?

### 2.3 Initial policy baseline

Current published and source-form rules provide initial values only. They must be stored in a versioned semester policy and never hard-coded into reusable UI.

- Academic eligibility starts with a configurable threshold equivalent to 10 academic points total, at least 4 from List I, at least 7 from Lists I and II combined, no more than five counted courses, configured honors/AP bonuses, and disqualifying-grade rules. The initial six grade-point values are List I A=3/B=1, List II A=2/B=1, and List III A=1/B=0. A+/A− evaluate as A and B+/B− as B unless a future published policy explicitly introduces a different normalized grade model.
- The current chapter baseline includes $5 dues, a seven-point participation requirement, a two-point drive cap, a three-point cap per activity, and up to one missed required meeting.
- Senior recognition is calculated from completed semester memberships using the policy effective for the applicable graduating class and year.

An adviser may change future-semester policy. Historical evaluations always retain the exact policy version used at decision and close.

### 2.4 What the platform owns—and what it does not

| System                         | Operational responsibility                                                                                                                               | Authority after import                                                                     | Write behavior                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Google Forms                   | Original application, attendance, and club-audit submissions                                                                                             | Immutable source evidence only                                                             | Let’s Assist does not edit responses                                                                    |
| Google Sheets                  | Raw response grids and historical class tabs                                                                                                             | Raw source before reconciliation; not authoritative for reviewed platform fields afterward | Read for explicit preview/import only; no writeback, compatibility-tab writer, or report destination    |
| Google Drive                   | Transcripts, receipts, proofs, spreadsheets, and chapter source files                                                                                    | Authoritative file bytes and access controls                                               | Store provider IDs and links; do not duplicate public copies                                            |
| Let’s Assist                   | Normalized students, reviews, eligibility, dues verification, decisions, term membership, attendance, point awards, club approvals, reports, and history | Operational source of truth after officer commit                                           | Consequential changes are permission-checked/audited; report output is a local formula-safe ZIP archive |
| Google Classroom               | Retired CSF channel; retained only as historical operating context                                                                                       | No platform state                                                                          | No active posting workflow, OAuth scope, API, simulator, or delivery tracker                            |
| DVHS CSF website and Instagram | Public chapter information and outreach                                                                                                                  | Public-information source                                                                  | The plugin does not attempt to become a competing CMS                                                   |

---

## 3. Product scope

### 3.1 In scope

- Semester setup and versioned rules
- Google Drive file selection and Google Sheets import
- Application intake normalization and reconciliation
- Course-by-course eligibility evaluation
- Transcript and dues-receipt evidence links
- Missing-information and review workflows
- Application approval, rejection, withdrawal, reassignment, and adviser override
- Permanent student records and verified Let’s Assist account connection
- Current and historical term memberships
- Activities, point submissions, awarded credit, appeals, meetings, attendance, and partner clubs
- Deadline ownership and term-close preflight
- Term-scoped, locally downloaded report exports
- Capability-based officer access and immutable change history
- Applicant/member self-service status and next steps
- Cohort-scoped member posts with optional ledger-backed email delivery (Amendment 1, amended v1.1)
- A minimal public activity page with no student records

### 3.2 Explicit non-goals

- Google Classroom integration or simulated posting state
- Internal direct messaging, post comments, or ad-hoc email outside the durable ledger (cohort posts with per-post email delivery are in scope per Amendment 1, amended v1.1)
- Native payment processing or financial account storage
- Automated transcript OCR or AI eligibility decisions
- Public member directories, public membership badges, or public student progress
- A generic school club-management product
- Any Google Sheets writeback, report destination, compatibility-tab writer, or permanent bidirectional synchronization
- Decorative analytics, prediction, risk scoring, or artificial urgency
- Replacing the official DVHS CSF website or Instagram

---

## 4. Users, roles, and permissions

### 4.1 User definitions

**Applicant**<br>
A signed-in student with an imported application or a pending student-record connection. Applicants need a plain-language status, missing-item instructions, deadlines, and access only to their own information.

**Member**<br>
A student whose application has been approved for a semester. Members retain applicant access and can view approved activities, submit point evidence, track attendance and awards, and file an appeal when enabled.

**Officer**<br>
A student leader with one or more explicit capabilities. Officers should see only the operational areas relevant to their assigned position. The product never relies on hiding a button as authorization.

**Adviser/administrator**<br>
The adult chapter authority or explicitly delegated administrator. This role can resolve sensitive exceptions, override eligibility with a reason, manage policy and access, close or reopen a term, and export sensitive records.

### 4.2 Permission matrix

| Capability                              |                            Applicant                            |                   Member                    |                Officer with capability                 |   Adviser/admin    |
| --------------------------------------- | :-------------------------------------------------------------: | :-----------------------------------------: | :----------------------------------------------------: | :----------------: |
| View own student record and application |                               Yes                               |                     Yes                     |               When assigned or permitted               |        Yes         |
| Supply permitted missing information    |                               Yes                               |                     Yes                     |                          Yes                           |        Yes         |
| View published activities               | No until authenticated application/member access is established |                     Yes                     |                          Yes                           |        Yes         |
| Submit own point evidence and appeal    |                               No                                |                     Yes                     |                   Yes for own record                   | Yes for own record |
| View other students                     |                               No                                |                     No                      |   `manage_profiles` or workflow-specific permission    |        Yes         |
| Review applications                     |                               No                                |                     No                      |                 `review_applications`                  |        Yes         |
| Verify dues                             |                               No                                |                     No                      |                `manage_payment_review`                 |        Yes         |
| Apply academic override                 |                               No                                |                     No                      |             No unless explicitly delegated             |        Yes         |
| Manage activities                       |                               No                                |                     No                      |                 `manage_opportunities`                 |        Yes         |
| Publish posts and post-linked email     |                               No                                |                     No                      |                     `manage_posts`                     |        Yes         |
| Review point submissions                |                               No                                |                     No                      |                  `verify_submissions`                  |        Yes         |
| Process final point records             |                               No                                |                     No                      |                    `process_points`                    |        Yes         |
| Manage meetings and attendance          |                               No                                |                     No                      | `manage_cohorts_terms` or delegated meeting permission |        Yes         |
| Manage partner clubs                    |                               No                                |                     No                      |                 `manage_partner_clubs`                 |        Yes         |
| Run imports                             |                               No                                |                     No                      |                  `manage_sheet_sync`                   |        Yes         |
| Export ordinary reports                 |                               No                                | Own downloadable status only if added later |                    `export_reports`                    |        Yes         |
| Export sensitive reports                |                               No                                |                     No                      |        Explicit `export_sensitive_reports` only        |        Yes         |
| Manage staff access and policy          |                               No                                |                     No                      |           Explicit administrative capability           |        Yes         |
| Close/reopen a semester                 |                               No                                |                     No                      |     Close only if explicitly delegated; no reopen      |        Yes         |
| View change history                     |                     Own status history only                     |           Own status history only           |                  `view_audit_history`                  |        Yes         |

### 4.3 Default officer templates

Templates provide sensible starting capabilities and remain editable by the adviser.

- **Co-presidents:** all chapter operations except ownership transfer and adviser-only academic override.
- **Vice presidents:** applications, appeals, member records, point processing, partner clubs, imports, and reports according to assignment.
- **Treasurer:** dues evidence, waivers delegated by the adviser, and dues reports.
- **Secretary:** semester schedule, meetings, attendance, imports, deadlines, and routine reports.
- **Publicity vice president/webmaster:** cohort posts, post-linked announcement email, and activity/public-page content inside this product; the external website and social accounts remain separate.
- **Activity coordinators:** activity creation, signup verification, point-submission review, and partner-club support.
- **Adviser:** all sensitive review, policy, override, access, closure, and export capabilities.

No template bypasses server-side capability checks. Every assignment has an effective date range and history.

---

## 5. Current product and UX audit

### 5.1 Useful foundations to preserve

The current implementation contains important work that should be retained and reshaped rather than discarded:

- Server-only `plugin_data.csf_*` tables with browser grants revoked and RLS as defense in depth
- Permanent profiles separated from applications, cohorts, terms, and term memberships
- Application course-entry, file, and status-event tables
- Private file lifecycle handling
- Versioned term policy and shared requirement evaluation
- Atomic application decision, point-review, policy-update, and term-close RPC boundaries
- Normalized activities, submissions, credit records, meetings, attendance, appeals, and partner clubs
- Raw import rows, row hashes, source coordinates, preview/commit separation, and local report-export history
- Capability-based staff positions and change events
- Route-scoped data loading
- Plugin-controlled public privacy boundary
- Google Sheets OAuth and Drive Picker support

### 5.2 Problems that require rebuilding

| Current surface or concept                  | Finding                                                                                                                                         | Required disposition                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Officer home hero                           | Large, generic framing consumes space before the actual work                                                                                    | Replace with compact term context and explicit queues/deadlines                                            |
| “Review inbox”                              | Combines unrelated decisions into an abstract number                                                                                            | Remove; show named queues such as “Applications awaiting decision” and “Point submissions awaiting review” |
| “Semester readiness”                        | Invented scorecard language; setup is not a health metric                                                                                       | Remove; put concrete missing setup on Semester pages                                                       |
| “At risk”                                   | Conflates points, meetings, and review state before the term is complete                                                                        | Remove globally; display the exact unmet requirement only where useful                                     |
| “Prepare Spring 2026”                       | Vague and promotional                                                                                                                           | Replace with “Spring 2026” plus explicit setup actions                                                     |
| “F25 focus”                                 | Internal shorthand presented as product language                                                                                                | Replace with a full semester selector, such as “Fall 2025”                                                 |
| “CSF member ledger”                         | Finance-like and unfamiliar                                                                                                                     | Replace with “Members” or “Member directory”                                                               |
| Generic “Onboarding”                        | Mixes invitations, account matching, and student creation                                                                                       | Remove as navigation; place “Connect student record” in Members                                            |
| Communications/Updates                      | Duplicates the external Classroom/website workflow and implies platform delivery                                                                | Reinstated as cohort posts per Amendment 1 (amended v1.1); legacy announcement rows stay migration history |
| Applications dialog                         | Shows aggregate point totals but not the course lines, document checks, dues state, provenance, or decision history needed to review accurately | Rebuild as an addressable review workspace                                                                 |
| Member table                                | Shows many empty future-term chips and generic “needs attention” state                                                                          | Show current application/membership columns and historical data on detail only                             |
| Classes & Terms                             | Exposes implementation structure instead of semester operations                                                                                 | Rebuild as Semester with Schedule, Policy, and Previous semesters                                          |
| Activities                                  | Useful domain, but current posts mix member content and officer settings inconsistently                                                         | Retain and rebuild with explicit lifecycle and member preview                                              |
| Points workbook                             | Useful for officers familiar with Sheets, but encourages free-form slot semantics                                                               | Retain density while using normalized submissions and awarded quantities                                   |
| Meetings                                    | Useful, but needs clear logical meeting/session distinction and reconciliation                                                                  | Retain and rebuild around sessions, attendance imports, and unmatched rows                                 |
| Partner Clubs                               | Legitimate DVHS workflow, but current metrics and term state are inconsistent                                                                   | Retain under Service with per-term standing review                                                         |
| Data & imports                              | Existing one-range workflow is too technical and incomplete                                                                                     | Rebuild as a guided source/map/preview/reconcile/commit/history wizard                                     |
| Reports                                     | Generic totals and “at risk” counts do not correspond to chapter decisions                                                                      | Rebuild as term-scoped operational exports                                                                 |
| Audit History                               | Technically correct but sounds punitive                                                                                                         | Rename visible UI to “Change history”; retain immutable audit model                                        |
| Restrictions                                | Separate route exposes a low-frequency implementation concept                                                                                   | Move to student detail or Settings according to target                                                     |
| Staff/Roles                                 | Duplicate routes and technical role language                                                                                                    | Merge into “Staff access” with position assignments and capabilities                                       |
| Settings                                    | Mixes policy and product settings                                                                                                               | Keep product settings only; move semester rules to Classes → Policy                                        |
| Public page                                 | Must not compete with the official chapter site                                                                                                 | Keep minimal: identity, safe activities, sign-in, official links                                           |
| Direct plugin and embedded routes           | Duplicate navigation and aliases create inconsistent wayfinding                                                                                 | Make the organization tab surface canonical and redirect legacy aliases                                    |
| Hidden accessibility tabs/duplicate aliases | Invisible or repeated navigation creates confusing focus and route state                                                                        | Remove from DOM or convert to one labeled, keyboard-operable navigation model                              |

### 5.3 Component-level rules

- A metric is allowed only if selecting it opens the exact underlying records.
- A badge is allowed only for a defined state dimension; ordinary metadata uses text.
- A dialog is for a short, reversible action. Full application review, member history, imports, and term closure use full pages or wide sheets.
- A destructive action names the affected record, explains consequences, requires a reason where records change, and reports success or failure in context.
- Filters live with the table they affect and remain encoded in the URL when officers may share or revisit the view.
- Empty states distinguish **not configured**, **no records exist**, and **no records match filters**.
- Buttons may not exist as visual placeholders. Disabled buttons explain the unmet prerequisite.

### 5.4 Current interaction and state audit

| Current interaction                | Finding                                                                                                        | Required change                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Application review dialog          | A modal is too small for course rows, documents, provenance, checks, notes, and decision history               | Replace with the addressable split/full-page review workspace in Section 8                                                   |
| Member row action menu             | Large icons and loosely grouped actions make routine tasks feel visually heavy                                 | Use 16 px icons, concise labels, separators only between meaningful groups, and move multi-step work to its destination page |
| Add/edit member dialogs            | Permanent identity and semester membership are edited together, risking accidental historical changes          | Keep identity editing short; create or correct term membership through the selected semester workflow with reason/history    |
| Class/term action dialogs          | Delete and status actions expose implementation objects without enough dependency context                      | Move to Semester, show affected applications/members/meetings/imports, and prefer archive over destructive deletion          |
| Close-term dialog                  | A short selector cannot communicate unresolved records or final outcomes                                       | Replace with full term-close preflight and explicit exception resolution                                                     |
| Create activity dialog             | Useful starting form, but publication prerequisites and member preview are not central                         | Use a draft editor with validation, member preview, publish confirmation, and post-publication change rules                  |
| Point submission dialog            | Allows free selection without consistently grounding the claim in an approved activity/club and current policy | Require a valid source, show point/evidence rules, and separate claimed from awarded quantity                                |
| Submission review dialog           | Decision is isolated from member history, caps, prior awards, and appeal state                                 | Add contextual policy/member totals and atomic approve-adjust-request-reject actions                                         |
| Drive Picker controls              | Useful integration, but spread across Meetings, Clubs, and Sheets without one import language                  | Reuse one source-selection pattern and route each source into the same preview/reconciliation semantics                      |
| Partner club add/edit/link dialogs | Separate dialogs obscure canonical club identity versus term approval and evidence                             | Use one club record with a term-review workflow and aliases                                                                  |
| Staff/position dialogs             | Position, platform account, display title, and permissions are difficult to reason about separately            | Consolidate into Staff access with effective dates and a capability preview                                                  |
| Confirmation dialogs               | Some current actions confirm deletion but do not consistently require an operational reason                    | Apply the sensitive-action rules in Section 14.3 and show the exact consequence                                              |
| Generic toast success/error        | A toast alone does not tell an officer which record changed or whether related records committed               | Keep a concise toast, plus inline result state, record link, and correlation ID on failure                                   |
| Empty states                       | Some states use large cards or generic “nothing here” text without distinguishing setup from no matches        | Apply the three empty-state categories in Section 7.4                                                                        |
| Loading states                     | Route-level loading can leave the product shape unclear                                                        | Preserve headers, filters, and realistic table/detail skeletons                                                              |
| Responsive navigation              | Wide tab rows wrap or compress, and administration becomes a second visual navigation layer                    | Use the single canonical navigation plus a mobile sheet/menu                                                                 |
| Public activity layout             | Marketing-style cards and repeated explanatory privacy copy compete with the official site                     | Keep a concise identity header, safe activity list, sign-in, and official links                                              |

---

## 6. Canonical information architecture and routing

### 6.1 Officer navigation

The organization plugin shows one primary row:

1. **Home**
2. **Applications**
3. **Members**
4. **Service**
5. **Classes**
6. **More** — Terms, Imports, Staff access, Change history, Settings (amended v1.5: the Reports page is retired; the term report download lives on Settings)

The primary row must fit at ordinary desktop widths without a second “More tools” row. On smaller screens it becomes a labeled menu/sheet, not a clipped horizontal list.

Page-local navigation:

- Applications: **Review queue**, **All applications**
- Members: **Directory**, **Current semester**, **Seniors**
- Service: **Activities**, **Point submissions**, **Verification**, **Meetings**, **Partner clubs**
- Classes: class picker plus semester **Schedule & deadlines**, **Policy**, and **Previous semesters**; one selected class opens **Stream**, **Members**, **Points**, and **Meetings** according to the officer's capabilities

**Classes → Stream** is the officer post composer and class announcement history. **Feed** is the member-facing unified stream. Neither surface is called Classroom, and neither sends email merely because a post or link was created.

### 6.2 Applicant/member navigation

1. **Feed**
2. **Activities**
3. **Point submissions**
4. **My CSF**

Applicants who are not yet approved can see My CSF. The Feed, Activities, and Point submissions appear only when the current state and audience permit those workflows. Feed is the default member destination after a successful cohort/profile connection.

### 6.3 Canonical URLs

The host organization route is canonical. Visible state must be addressable and recoverable after refresh.

| Surface                  | Canonical pattern                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                     | `/organization/:slug?tab=csf-overview`                                                                                                          |
| Applications             | `/organization/:slug?tab=csf-applications` plus stable application/view parameters                                                              |
| Members                  | `/organization/:slug?tab=csf-members` plus stable member/view parameters                                                                        |
| Service                  | `/organization/:slug?tab=csf-activities&csf_service=:section`, where section is opportunities, points, verification, meetings, or partner-clubs |
| Selected service record  | Same route with the relevant stable record identifier                                                                                           |
| Classes                  | `/organization/:slug?tab=csf-cohorts` (class picker only; see Amendment 4)                                                                      |
| Terms                    | `/organization/:slug?tab=csf-terms` plus `csf_term=:id` and optional `csf_rules=open` (Amendment 4)                                             |
| Selected class workspace | Same route with `csf_cohort=:id` and optional `csf_cohort_tab=stream`, `members`, `points`, or `meetings`                                       |
| Imports                  | `/organization/:slug?tab=csf-imports` with optional stable job/source parameters                                                                |
| Report download          | `/organization/:slug?tab=csf-settings` (the retired `?tab=csf-reports` aliases here)                                                            |
| Staff access             | `/organization/:slug?tab=csf-staff`                                                                                                             |
| Change history           | `/organization/:slug?tab=csf-audit`                                                                                                             |
| Communications           | `/organization/:slug?tab=csf-communications`                                                                                                    |
| Settings                 | `/organization/:slug?tab=csf-settings`                                                                                                          |

Existing direct plugin routes remain temporary compatibility aliases. They redirect inward to the equivalent host route. They must never redirect in both directions.

### 6.4 Legacy route mapping

| Existing route                     | Destination                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `overview`                         | Home                                                                                                                       |
| `profiles`                         | Members → Directory                                                                                                        |
| `applications`                     | Applications → Review queue                                                                                                |
| `onboarding`, `connect`            | Members → Connect student record, preserving invitation code when present                                                  |
| `cohorts`, `terms`                 | Classes → class hub, Schedule & deadlines, Policy, or Previous semesters                                                   |
| `opportunities`                    | Service → Activities                                                                                                       |
| `submissions`, member `points`     | Point submissions                                                                                                          |
| staff `points`                     | Service → Point submissions/processing                                                                                     |
| `meetings`                         | Service → Meetings                                                                                                         |
| `partner-clubs`                    | Service → Partner clubs                                                                                                    |
| `sheets`                           | Imports                                                                                                                    |
| `staff`, `roles`                   | Staff access                                                                                                               |
| `audit`                            | Change history                                                                                                             |
| `restrictions`                     | Member detail or Settings                                                                                                  |
| `calendar`                         | Removed; legacy announcement rows are read-only migration data. New cohort posts are active per Amendment 1 (amended v1.1) |
| `reports`                          | Settings → Download reports                                                                                                |
| `settings`                         | Settings or Classes → Policy, depending on field                                                                           |
| `my-profile`, `application-status` | My CSF                                                                                                                     |

---

## 7. Global interaction and visual system

### 7.1 Visual direction

The workspace is calm, academic, trustworthy, and dense enough for real administration.

- Retain Let’s Assist navigation, Geist typography, neutral surfaces, green action color, dark mode, and organization identity.
- Use the DVHS CSF seal as a restrained identity mark in the compact plugin header and public page; do not use it as a giant hero illustration or background texture.
- Use shadcn/Base UI primitives already present in the repository.
- Use Lucide icons consistently: 14–16 px in rows and controls, 18 px in section headers, and no oversized menu illustrations.
- Prefer one bordered surface around a data workspace over nested card walls.
- Use whitespace to separate tasks, not to simulate a marketing landing page.
- Reserve green for primary actions and positive states; status meaning is always written in text.
- Avoid gradients, arbitrary colored metric strips, excessive pills, hover-only controls, and unnecessary animation.

### 7.2 Shared shell

- Compact identity header: seal, “DVHS CSF,” current semester selector, and one context action area.
- No blank hero band above plugin navigation.
- One primary plugin navigation layer.
- Page header contains title, one-sentence purpose where necessary, and the primary action.
- Breadcrumbs appear only on detail workflows where they clarify return context.
- Staff identity/role and account controls remain in the host shell.
- Desktop and mobile footers use the same Let’s Assist product-company identity. Developer, operator, or fixture-person names never replace product copyright.

### 7.3 Shared data-workspace behavior

- Tables have a sticky header on long pages, visible column names, optional column chooser, and deterministic sorting.
- Search waits briefly before updating and appears in the URL as `q`.
- Status and assignee filters also persist in the URL.
- Pagination uses stable server-side cursors or deterministic page/size parameters; default 50 rows and maximum 100.
- Row selection never conflicts with an actions menu.
- Row actions use a 16 px icon and a 36–40 px target, with text labels inside the menu.
- Bulk actions are shown only when selected rows support the same operation.
- Date-only values preserve the source calendar date. Meeting timestamps use the chapter’s Pacific timezone. Exports retain ISO values.

### 7.4 Shared states

Every page defines:

- **Loading:** title and layout remain stable; skeletons reflect the final row/card shape.
- **Setup empty:** explains what must be configured and links to the permitted setup action.
- **True empty:** confirms there are no records and offers the appropriate creation/import action.
- **Filtered empty:** says no records match and offers “Clear filters.”
- **Partial error:** retains successfully loaded regions and shows a scoped retry.
- **Page error:** gives a human explanation, a retry, and a correlation ID for support.
- **Success:** confirms the record and resulting state, with a direct next action.
- **Validation:** appears next to the field/row and in a concise summary for long forms.
- **Pending mutation:** the activating control names the work in progress, remains disabled against duplicate submission, and preserves the dialog/page context.
- **Partial success:** names each independently durable result and the exact recovery action; it never collapses “record saved, delivery not queued” into a generic failure.

### 7.5 Responsive and accessible behavior

- Desktop tables remain tables; do not turn ordinary 1440 px views into card grids.
- At tablet width, nonessential columns may be hidden through an explicit priority order.
- At phone width, queues become compact lists and detail panes become full-screen pages/sheets.
- At phone width, Home and Applications remain visible and every other primary destination is discoverable in the mobile-only More menu. Desktop keeps one primary navigation layer.
- Dialogs must not exceed the viewport; long processes use pages.
- All controls are keyboard reachable with a visible focus ring.
- Icons with no visible text have accessible names.
- Status is never communicated by color alone.
- Confirmation and error announcements use appropriate live regions without repeating whole pages.

---

## 8. Page-by-page product specification

The shared state and accessibility rules above apply to every page below.

### 8.1 Officer Home

**Purpose:** Show the signed-in officer the concrete work and deadlines relevant now.<br>
**Primary users:** Officers and adviser.<br>
**Shows:** Current semester; applications awaiting a decision; missing transcript/course/dues items; eligibility exceptions; imports with unresolved or failed rows; point submissions awaiting review; upcoming deadlines and meetings; recent imports; recently approved members; assigned work.<br>
**Primary actions:** Open the exact filtered queue; continue an assigned review; create an activity when permitted.<br>
**Secondary actions:** Change semester; view all deadlines; open recent import summary.<br>
**Filters/search:** Semester selector only; each linked count owns its downstream filters.<br>
**Empty states:** “No officer decisions are waiting” and “No upcoming deadlines are configured” are separate states.<br>
**Permissions:** Cards are capability-filtered; no unauthorized aggregate count is fetched.<br>
**Mobile:** Single prioritized list—assigned work, decisions, deadlines, recent changes.<br>
**Links:** Applications, Imports, Service, Semester.

Prohibited home content: “At risk,” “Review inbox,” “Semester readiness,” decorative charts, engagement percentages, invented risk scores, and records outside the user’s capabilities.

### 8.2 Applications — Review queue

**Purpose:** Move reviewable semester applications to a defensible decision.<br>
**Primary users:** Application reviewers and adviser.<br>
**Shows:** Student, graduating class, submission state, academic eligibility, transcript, dues, assignee, source, submitted/imported date, and last activity.<br>
**Primary actions:** Select/continue a review; assign to self; assign to a permitted reviewer.<br>
**Secondary actions:** Request missing information in context; export the filtered queue.<br>
**Filters/search:** Semester, submission state, eligibility, transcript, dues, assignee, class, source, and search by name/email/fictional test ID. Filters persist in the URL.<br>
**Empty states:** No imported applications; no applications awaiting review; no filter matches.<br>
**Permissions:** Reviewers see only allowed fields; sensitive exports require separate capability.<br>
**Desktop:** One compact list; selecting a row opens a URL-addressable full-page review. Browser Back restores filters, sort, page, and scroll position.<br>
**Mobile:** Queue and review are separate full-screen routes preserving filters and scroll position.<br>
**Links:** All applications, selected member, source import, source file.

### 8.3 Application review detail

**Purpose:** Provide all evidence, calculations, notes, and controls needed for one decision.<br>
**Primary users:** Assigned reviewer and adviser.<br>
**Shows:**

- Student identity, class, verified contact candidates, and account-connection state
- Source provider, file, sheet tab/range, source row, import time, and import job
- Course lines with course name/code, List I/II/III classification, grade, base points, allowed bonus, counted points, and row validation
- Aggregate academic calculation and the exact policy version
- Transcript and receipt links with provider metadata, not public file URLs
- Required-information, identity, academic, transcript, and dues checks
- Private chronological notes and immutable status/decision history
- Current assignee and previous assignments

**Primary actions:** Approve, reject, request information, or save a permitted correction. Assignment, request-information, and decision controls live in exactly one compact sticky action bar on long records; they are not duplicated in the header.<br>
**Secondary actions:** Reassign; verify/waive dues; open Drive evidence; run eligibility again after a correction; adviser override.<br>
**Validation:** Approval is disabled until mandatory checks pass. An adviser override requires a reason code and free-text explanation; the UI previews which failed check is being overridden. Rejection requires a defined reason and optional student-facing explanation.<br>
**Success:** Shows decision, membership created/updated, actor, time, and next application in the current queue.<br>
**Error:** An atomic failure leaves application, membership, and history unchanged and displays a correlation ID.<br>
**Permissions:** Ordinary reviewers cannot apply adviser overrides or view fields outside their capability.<br>
**Mobile:** Stacked sections with a sticky decision footer; source and history open in sheets.<br>
**Links:** Member detail, source import, term policy.

### 8.4 Applications — All applications

**Purpose:** Search every application in the selected term, including decided and withdrawn records.<br>
**Primary users:** Officers with application access and adviser.<br>
**Shows:** Same core columns as the queue plus decision and decision date.<br>
**Actions:** Open record; export filtered set; reopen only through an adviser-controlled correction flow.<br>
**Filters/search:** All queue filters plus decision and date range.<br>
**Empty states:** No applications in term; no filter matches.<br>
**Permissions/mobile/links:** Same principles as the queue.

### 8.5 Members — Directory

**Purpose:** Find a durable student record and understand its current-semester state quickly.<br>
**Primary users:** Profile managers and adviser.<br>
**Shows:** Student, graduating class, account connection, current application decision, eligibility, dues, membership outcome/progress, counted points, meetings, and last update. Empty future semesters are never rendered as chips.<br>
**Primary actions:** Open member; add a missing student; share the class's permanent join code from **Invite students** (see Amendment 5).<br>
**Secondary actions:** Merge duplicate candidates; export filtered directory. Code actions do not send email or change email-delivery telemetry.<br>
**Filters/search:** Class, account connection, application decision, eligibility, dues, membership outcome, and search.<br>
**Empty states:** No students imported; no filter matches.<br>
**Permissions:** Application/dues fields are column-filtered by capability; profile managers without payment access see a neutral “Complete/Needs verification” summary only if permitted.<br>
**Mobile:** Student, class, account, and current status in the list; progress details on record page.<br>
**Links:** Member detail, current-semester view, source import.

### 8.6 Member detail

**Purpose:** Maintain one permanent student identity and its semester history.<br>
**Primary users:** Profile managers and adviser; students see a separate self view.<br>
**Shows:** Identity and aliases, verified emails, Let’s Assist account connection, graduating class, current application and membership, academic/dues summary, normalized points, attendance dates, completed historical terms, senior-recognition progress, provenance, restrictions, and audited corrections.<br>
**Primary actions:** Correct identity/class; connect or unlink account; open current application; add an audited manual correction.<br>
**Secondary actions:** Request merge; expire invitation; view source evidence; view change history filtered to this student.<br>
**Validation:** An unlink, merge, class change, or historical correction requires a reason. Merge previews every related record moving to the target and never chooses a target automatically.<br>
**Permissions:** Dues, documents, private notes, and account operations are separately capability-gated.<br>
**Mobile:** Summary first; current term, history, service, sources, and changes in accessible disclosure sections.<br>
**Links:** Application, term membership, point submission, meeting, import.

### 8.7 Members — Current semester

**Purpose:** Give officers an operational roster for the selected term.<br>
**Primary users:** Officers responsible for the roster, requirements, or term close.<br>
**Shows:** Approved/in-progress memberships and explicit unmet requirements.<br>
**Actions:** Open member; export roster; open term-close preflight.<br>
**Filters:** Class, membership progress/outcome, points met, meeting requirement met, dues verified.<br>
**Empty state:** No approved memberships yet; link to applications.<br>
**Mobile:** Compact list with the one most important incomplete requirement and a detail link.

### 8.8 Members — Seniors

**Purpose:** Verify recognition eligibility from completed semester outcomes.<br>
**Primary users:** Adviser, presidents, and delegated secretary.<br>
**Shows:** Senior, completed membership semesters, senior-year term participation, recognition level, exceptions, and policy version.<br>
**Actions:** Export recognition list; open supporting term history; enter adviser-reviewed correction with reason.<br>
**Filters:** Recognition result, completion count, exception state.<br>
**Empty state:** No seniors or no completed historical records; link to imports.<br>
**Permissions:** Sensitive export and corrections require explicit capability.<br>
**Mobile:** Readable record list; history opens as full page.

### 8.9 Service — Activities

**Purpose:** Create and maintain the authoritative structured activity that appears in the unified member stream when published.<br>
**Primary users:** Activity coordinators/officers; members receive a filtered view.<br>
**Shows:** Title, term, optional class audience, date/time, location, point type/value/cap, signup method, evidence rule, lifecycle, and member preview.<br>
**Primary actions:** Create; publish; edit; close.<br>
**Secondary actions:** Duplicate for another term; cancel; archive; copy a plain-text summary for an external use. Copying text creates no communications record.<br>
**Filters/search:** Term, status, point type, audience, date, search.<br>
**Empty states:** No activities exist; no published activities; no filter matches.<br>
**Validation:** A published activity requires term, date, title, member-facing details, point rule, signup behavior, and evidence behavior. Cancellation requires a reason.<br>
**Permissions:** Members see only published/open eligible activities and never officer notes.<br>
**Mobile:** Activity list cards are acceptable here because each is a distinct opportunity; editor is full-screen.<br>
**Links:** Activity detail, point submissions, partner club if applicable.

Activity lifecycle: `draft`, `published`, `closed`, `cancelled`, `archived`.

### 8.10 Activity detail/editor

**Purpose:** Inspect configuration, signups, submissions, and resulting awards for one activity.<br>
**Shows:** Member preview first; officer configuration; signup source; submission counts; unresolved verification; change history.<br>
**Actions:** Edit allowed fields, close/cancel, open submissions, open external signup, copy summary.<br>
**Validation:** Changes that would alter existing awards require a new version or explicit audited adjustment; existing reviewed submissions are never silently recomputed.<br>
**Mobile:** Member preview and actions remain first; operational tables scroll or collapse predictably.

### 8.11 Service — Point submissions

**Purpose:** Let members submit one claim and let officers turn it into an explicit awarded quantity.<br>
**Primary users:** Members, point reviewers, and adviser.<br>
**Shows:** Member, related activity/partner club, service date, claimed points, evidence, submission state, awarded points, reviewer, and appeal state.<br>
**Member actions:** Submit, correct requested information, withdraw before review, appeal a decision.<br>
**Officer actions:** Approve, adjust with reason, request correction, reject, process appeal, and open member context.<br>
**Filters/search:** Term, submission state, activity, point type, reviewer, appeal state, date, member search.<br>
**Empty states:** Member has no submissions; officer queue is clear; no filter matches.<br>
**Validation:** A submission chooses a published activity or a partner club with active standing for the current term unless an officer records a permitted manual adjustment. One submission may award any valid numeric amount up to policy and activity caps; it is never represented by duplicated one-point slots.<br>
**Permissions:** Members see only their own records and student-facing notes.<br>
**Mobile:** Review becomes a full-height sheet/page with evidence and decision footer.

A `needs_action` correction resubmits the same submission; it is not an appeal or a replacement claim. The atomic transition revalidates verified ownership, current open term, active membership, current activity policy or active partner-club standing, and proof requirements while preserving prior review, audit, and correlated resubmission history.

Every begin, proof finalization, withdrawal, review, appeal, and appeal decision reauthorizes the current actor and locks/revalidates the submission, current open term, active membership, published policy, source relationship, numeric caps, and finalized-proof requirement as applicable. Browser-provided eligibility or a previously valid membership is never sufficient authority for the write.

### 8.12 Service — Meetings

**Purpose:** Configure required meetings and reconcile attendance from dated sessions.<br>
**Primary users:** Secretary, attendance lead, adviser; members see their own attendance in My CSF.<br>
**Shows:** Logical meeting requirement, one or more sessions, date/location, linked attendance source, import state, matched/ambiguous/unmatched counts, and attendance summary.<br>
**Primary actions:** Add meeting/session; select a Drive source; preview attendance; resolve rows; commit; close session.<br>
**Secondary actions:** Manual correction with reason; cancel session; export attendance.<br>
**Filters/search:** Term, meeting/session, match status, attendance status, class, member search.<br>
**Empty states:** No meetings configured; no attendance imported; no filter matches.<br>
**Validation:** A source preview precedes commit. Name-only matches remain unresolved unless an officer selects the student.<br>
**Mobile:** Meeting list first; reconciliation is a dedicated page rather than a compressed table dialog.

Meeting and session timestamps use the shared compact Pacific-time formatter. Raw ISO/UTC timestamps are not officer- or member-facing copy.

### 8.13 Service — Partner clubs

**Purpose:** Record which clubs may issue CSF credit and review their standing each term.<br>
**Primary users:** Partner-club lead, point reviewers, adviser.<br>
**Shows:** A term-filtered directory of canonical clubs; each row opens a detail dialog with aliases, contact/adviser, relationship status, term standing, the policy-review flag and policy notes, standing history, and the club's reference spreadsheet link.<br>
**Actions:** Add club; edit in the detail dialog; approve, suspend, or expire standing; archive/restore; import Google Form responses and apply rows as draft club records.<br>
**Filters/search:** Term (chronological dropdown with the current term selected by default), standing, search.<br>
**Empty states:** No clubs for term; no filter matches.<br>
**Validation:** A club is not valid for member submission until its standing is active for the current term. A renamed club attaches an alias instead of creating silent duplicate identity. The spreadsheet link is a plain reference to the club's own spreadsheet — owned by the club, not the chapter account — and is never read programmatically. Point types, caps, and proof requirements are not stored per club; officers vet them manually during point approval against the published semester policy.<br>
**Mobile:** Directory list plus the club detail dialog as a full page.

Clubs keep applying and renewing through the existing Google Form. An officer uploads the form's response export as an **Import form responses** job; rows preview immutably (source type `partner_club_audit`, variant `partner_club_renewal`). Each row is either applied as a draft — creating a not-reviewed club record for the term — or skipped. There is no partner representative access and no Drive-linked member-Sheet import for partner clubs.

### 8.14 Classes — Semester schedule & deadlines

**Purpose:** Define the real operating calendar and owners for one semester.<br>
**Primary users:** Presidents, secretary, adviser.<br>
**Shows:** Term lifecycle, application open/close, transcript/dues cutoff, meetings, point deadline, review completion target, term-close date, owner, and status.<br>
**Primary actions:** Create planned semester; edit future deadlines; assign owner; open term-close preflight.<br>
**Secondary actions:** Duplicate the prior semester as a draft; add meeting; view previous term.<br>
**Filters:** Selected semester; historical terms appear in Previous semesters.<br>
**Empty state:** No semester configured; guided setup begins with name/dates, then policy, then imports.<br>
**Validation:** Opening a term requires an application window and published policy version. Closing requires preflight.<br>
**Permissions:** Policy/closure capabilities are separate from ordinary meeting editing.<br>
**Mobile:** Chronological list with status and owner; editor is full-screen.

### 8.15 Classes — Semester policy

**Purpose:** Version the academic, dues, service, meeting, and recognition rules used by evaluations.<br>
**Primary users:** Adviser and explicitly delegated presidents.<br>
**Shows:** Effective policy version, academic thresholds, the six operative List I/II/III × A/B grade-point values, plus/minus normalization, bonus/disqualification rules, dues requirement, service total, drive cap, per-activity cap, meeting rule, carryover behavior, and recognition rules.<br>
**Actions:** Create a new draft version; validate; publish for a planned/open term under allowed conditions.<br>
**Validation:** The default baseline is List I A=3/B=1, List II A=2/B=1, and List III A=1/B=0. A+/A− use A and B+/B− use B. Saving a draft preserves any valid advanced grade keys already stored, checks the expected draft revision, and changes no active calculation until publication. A policy used by a decided application or closed term is immutable. Re-evaluating decided records is always explicit and audited.<br>
**Empty state:** No policy exists; offer to copy the latest prior policy and require review.<br>
**Permissions:** Adviser by default.<br>
**Mobile:** Sections with a sticky save/publish footer.

### 8.16 Classes — Previous semesters

**Purpose:** Review closed terms without mixing them into current operations.<br>
**Primary users:** Officers with report access and adviser.<br>
**Shows:** Term, policy version, application totals, approved memberships, completed/incomplete outcomes, close actor/date, exports, and closure revisions.<br>
**Actions:** Open read-only term; export; adviser initiates controlled correction/reopen with reason.<br>
**Filters/search:** School year, season, lifecycle.<br>
**Empty state:** No historical terms imported; link to Imports.<br>
**Mobile:** Compact term list and read-only detail page.

### 8.17 Imports

**Purpose:** Safely convert Drive/Sheet source data into normalized records.<br>
**Primary users:** Import operators and adviser.<br>
**Shows:** Google Sheets connection state, a derived read-only import progress strip, the latest preview with its counts and normalized snapshot, a paged normalized-row table, the new-import and local-upload source sections, and import history — recent jobs, source, type, operator when recorded, preview/commit status, recorded created/updated/unresolved/error counts, abbreviated integrity digest when recorded, row reconciliation decisions/reasons, and retry or preview ancestry.<br>
**Primary actions:** Start import; continue reconciliation; commit valid rows; retry corrected rows.<br>
**Secondary actions:** Open source; download sanitized error report; compare mapping; open generated records.<br>
**Filters/search:** Source type, status, operator, date, term.<br>
**Empty state:** No imports yet; explain supported source types and start with Drive Picker.<br>
**Error:** Provider/auth errors are separate from mapping errors and row errors. Reauthorization does not discard a completed preview.<br>
**Permissions:** `manage_sheet_sync`; sensitive source access is rechecked server-side.<br>
**Mobile:** Job history is usable; mapping and reconciliation recommend desktop but remain functional in stacked full-page form.

The selected job's status, blocker list, summary language, and commit control use the same server-derived readiness result. Historical row counts or a previously successful preview cannot override a current provider, provenance, mapping, target-resolution, or job-state blocker. Missing historical fields render as **Not recorded** or **Officer unavailable**, never as an invented zero, actor, or outcome.

The import workspace is specified in Section 12.

### 8.18 Report download (Settings)

**Purpose:** Produce defensible term-scoped records for chapter operations. The standalone Reports page is retired (amended v1.5); the download lives on the Settings workspace and the old tab/route alias to it.<br>
**Primary users:** Officers with report permission and adviser.<br>
**Shows:** A Download reports card whose modal offers an explicit semester chooser, per-section checkboxes (approved members, unresolved cases, dues, point awards, meeting attendance, senior recognition, change history), and an opt-in to include uploaded proof pictures.<br>
**Actions:** Download a local ZIP containing formula-safe CSV files and a manifest; optionally a proof folder grouped by point submission with its own manifest that records any file skipped for size. There is no Google Sheets write destination.<br>
**Validation:** A semester is always explicit. The bundle requires sensitive-export permission plus the membership, dues, and service export keys; proof files travel only inside that same permission boundary.<br>
**Empty state:** Sections with no records still appear in the manifest with zero rows; never render a decorative zero chart.<br>
**Mobile:** The modal is usable; large exports are generated server-side.

### 8.19 Staff access

**Purpose:** Assign real officer positions and capabilities for a school year.<br>
**Primary users:** Adviser/admin and owner.<br>
**Shows:** Person, position, display title, effective dates, active status, account connection, capabilities, and assignment history.<br>
**Actions:** Assign, edit dates/title/capabilities, end assignment, copy prior-year templates.<br>
**Validation:** The last active adviser/owner cannot remove their own recovery access. Capability changes show their effect before confirmation.<br>
**Empty state:** Only adviser/owner exists; add officer assignments.<br>
**Mobile:** Assignment list with full-page editor.

### 8.20 Change history

**Purpose:** Explain consequential administrative changes without exposing a generic database log.<br>
**Primary users:** Officers with history permission and adviser.<br>
**Shows:** Time, actor, plain-language action, affected student/term/record, reason, correlation ID, and safe before/after summary.<br>
**Actions:** Filter; open affected record; export if permitted. There is no edit or delete.<br>
**Filters/search:** Date, actor, action category, term, target type, correlation ID.<br>
**Empty state:** No changes match; clear filters.<br>
**Permissions:** File contents, secrets, raw tokens, and unnecessary personal data never appear in event JSON or UI.<br>
**Mobile:** Chronological list with a detail sheet.

### 8.21 Settings

**Purpose:** Configure stable plugin behavior that is not a semester policy, and host the term report download (amended v1.5).<br>
**Primary users:** Adviser/admin; officers holding report-export keys reach only the Download reports card.<br>
**Shows:** The connected chapter Google account (Drive/Sheets connection status with connect/reconnect/disconnect), organization identity (name, username, logo — org admins only), and the Download reports card (Section 8.18).<br>
**Actions:** Reconnect or disconnect the Google provider; edit the organization's public name, username, and logo through the host organization update path; download term report ZIPs.<br>
**Empty/error:** Missing Google connection is an actionable setup state, not a failed semester.<br>
**Exclusions:** Academic/service rules live on the Terms page; permissions live in Staff access; communications configuration lives on the Communications workspace.

### 8.22 My CSF

**Purpose:** Give one student a truthful current-semester status and direct next steps.<br>
**Primary users:** Applicant/member.<br>
**Shows:** Current semester, application received/imported, missing information, eligibility, transcript, dues, decision, points, meeting attendance, deadlines, and completed historical memberships.<br>
**Primary actions:** Supply a permitted correction, connect student record, open requested source/evidence action, browse activities, submit points, or appeal.<br>
**State behavior:** The page leads with one next action. It never shows officer notes, other students, or an invented percentage. “No current application” links to the external application source only when configured and open.<br>
**Empty states:** Account not connected; no current application; semester not open; approved but requirements not configured; completed term.<br>
**Mobile:** This is mobile-first and uses a concise progress list, not a dense officer table.

### 8.23 Member Activities

**Purpose:** Let eligible members find approved, currently relevant activities.<br>
**Shows:** Date, title, location, point type/value, signup behavior, evidence rule, availability, and deadline.<br>
**Actions:** Open details; follow signup; submit proof when allowed.<br>
**Filters:** Upcoming/past, point type, class audience.<br>
**Empty states:** No upcoming published activities; do not imply an error.<br>
**Permissions:** Published activities only; audience restrictions enforced server-side.

### 8.24 Member Point submissions

**Purpose:** Submit and track the member’s own claims and appeals.<br>
**Shows/actions/states:** Member-safe subset of Section 8.11. Reviewer identities and private notes are hidden; student-facing correction/rejection reasons are shown.

### 8.25 Public page

**Purpose:** Provide a safe DVHS CSF identity and an entry into an authenticated class connection without becoming a public class workspace.<br>
**Shows:** Seal/name, short description, official website/Instagram links, class identity cards, member sign-in, and join guidance.<br>
**Actions:** Open the official site, sign in to My CSF, or open a class join page and enter that class's permanent join code.<br>
**Empty state:** Retain the chapter identity, official links, sign-in, and class-code guidance without inventing public content.<br>
**Privacy:** Public organization and class routes never expose Stream posts, Activities, semesters, rosters, codes, student-derived counts, applications, dues, eligibility, meeting attendance, points, proofs, notes, or account state. Class Stream and Activities require a signed-in, server-authorized class connection.<br>
**Identity:** The verified account email is the only automatic connection signal (see Amendment 5). Conflicting or shared-email evidence moves to per-class officer review, and names never auto-connect.<br>
**Mobile:** Same Let’s Assist public shell with a responsive join/sign-in flow.

---

## 9. Core workflows

### 9.1 Create and open a semester

1. Adviser opens **Classes**, creates a `planned` semester, or copies the immediately prior semester into a draft.
2. Adviser verifies name, school year, application window, deadlines, and owners.
3. Adviser reviews and publishes a new immutable policy version.
4. Secretary configures logical meetings and sessions.
5. Import operator connects the application response source.
6. Preflight lists missing policy/window/source configuration.
7. Adviser opens the semester. Opening creates one audit event with the policy version.

Prior-term closure and next-term setup may overlap.

### 9.2 Import semester applications

1. Operator chooses the Drive spreadsheet and application source type.
2. Platform lists available tabs and reads only the selected range after confirmation.
3. Operator maps identity, class, course, grade, aggregate, transcript, receipt, and relevant source columns.
4. Platform snapshots the source metadata and rows, computes hashes, normalizes fields, and validates without writing student/application records.
5. Reconciliation classifies exact matches, candidate matches, duplicates, missing data, and row errors.
6. Operator resolves ambiguous identity where evidence is sufficient. **Use match** requires the selected member and a visible explanation of the evidence; **Skip row** requires a visible explanation of why the source row must not be imported. Failed actions preserve both fields and reset only after confirmed success.
7. Commit creates/updates permitted records from the immutable preview. Reviewed platform fields become conflicts instead of being overwritten.
8. Summary links to created applications and unresolved rows. History retains the typed decision and reason and shows only recorded counts, operator, abbreviated digest, reconciliation entries, and retry/preview ancestry.

### 9.3 Review an applicant

1. Reviewer opens a URL-addressable queue and claims or receives an assignment.
2. Review page evaluates required information against the term policy and displays source provenance.
3. Reviewer verifies course rows against transcript evidence.
4. Platform calculates academic eligibility deterministically and records every check result.
5. Authorized reviewer verifies dues; adviser may waive with reason.
6. If data is missing, reviewer requests information and the application leaves the ready queue.
7. When checks pass, reviewer approves or rejects with a reason.
8. One atomic server transaction updates the application decision, creates/updates the term membership when approved, appends status history, and appends the administrative audit event.

### 9.4 Correct missing or inaccurate application data

1. Applicant sees the exact requested item in My CSF.
2. Applicant updates only fields allowed by the request, or follows instructions to update the external source.
3. The original imported value remains in immutable source data.
4. Corrected normalized value records actor, time, reason/source, and prior value.
5. Eligibility checks rerun explicitly and return the application to the appropriate queue.

### 9.5 Connect a Let’s Assist account (amended v1.5)

1. The student redeems the class's permanent join code at `/connect/<code>` with a verified signed-in account. The verified account email is the only automatic matching signal.
2. One active same-class record carrying that email connects atomically; zero matches create a new stable profile from the account identity; a conflicting account or class assignment, or an email shared by several records, creates a review request in that class's **Needs attention** queue.
3. Name and graduating class may identify candidates for officer review but never auto-connect an account.
4. Officer compares limited identity evidence in **Resolve** and connects or rejects. The account's current confirmed email, exact name, and one matching active class must corroborate the selected profile; a candidate ranking or unique name alone is insufficient.
5. Linking, unlinking, and merge resolution are audited. Unlinking/merging requires a reason.

### 9.6 Verify dues

1. Receipt source enters through the application import or an allowed correction.
2. Treasurer/adviser opens the receipt through a scoped provider link.
3. Reviewer marks `verified`, returns it for correction, or the adviser marks `waived` with a reason.
4. The platform never stores card/bank details and never claims to have processed payment.

### 9.7 Create an activity and award points

1. Activity coordinator creates a draft with term, audience, point rule, signup, and evidence behavior.
2. Officer previews the member view and publishes.
3. Publication places the activity in the eligible member feed. An officer with `manage_posts` may publish a separate cohort post and optionally request one ledger-backed announcement email.
4. Member signs up externally or in a linked Let’s Assist project, completes the activity, and submits evidence if required.
5. Reviewer approves, adjusts with reason, requests correction, or rejects.
6. Approval creates one normalized award with the numeric quantity allowed by policy.
7. An appeal creates a separate immutable workflow and never overwrites the original review history.

### 9.8 Import meeting attendance

1. Secretary opens a meeting session and chooses its attendance response sheet.
2. Platform previews rows and matches unique verified identifiers.
3. Name-only, duplicate, or malformed rows remain in reconciliation.
4. Secretary resolves candidates or records a manual correction with reason.
5. Commit writes one attendance result per student/session and retains source row/hash.
6. Members see dated attendance, not spreadsheet column names.

### 9.9 Import historical class workbooks

1. Operator selects class workbook and supported term tabs.
2. Preview identifies headers, identity rows, repeated activity slots, and meeting columns.
3. For a student-term row, repeated identical activity labels across `Activity 1…N` collapse into one legacy award whose numeric quantity equals the valid occupied slots, unless a trustworthy explicit quantity exists. Different activities produce different awards.
4. `#REF!`, malformed dates, uncertain labels, duplicates, and ambiguous names remain unresolved.
5. Historical membership is created only when the source result and imported evidence are sufficient under the selected migration rule. Otherwise the row remains an exception for officer/adviser decision.

### 9.10 Close a semester

1. Authorized officer opens term-close preflight.
2. Platform lists unresolved applications, dues, submissions, appeals, attendance matches, and requirements.
3. Blocking issues must be resolved or explicitly overridden by the adviser with reason.
4. Shared evaluator computes `completed` or `incomplete` for every term membership using the published policy version.
5. One atomic transaction records all outcomes, closure summary, policy version, actor, time, and audit event.
6. Closed term becomes read-only to ordinary officers.
7. Adviser may initiate controlled correction/reopen with a reason; reclose creates a new closure revision rather than deleting history.

### 9.11 Senior recognition

1. Platform counts only completed term memberships.
2. It applies the recognition policy version relevant to the graduating class and year, including senior-year conditions.
3. Exceptions are explicit, adviser-reviewed, and audited.
4. Export identifies policy version and generated time.

### 9.12 Publish a class or chapter post

1. An officer with `manage_posts` opens **Classes**, selects the class, and uses **Stream**. A chapter-wide member post may be created from the same reachable composer.
2. Publishing commits the post and its immutable audit receipt before any optional email operation. The UI reports **Post published** separately from **Email queued** or **Email not queued**.
3. For class email, the campaign freezes the post's term, exact class cohort, consent topic, content, and recipient snapshot. Later profile/cohort edits or post edits cannot widen, shrink, or rewrite that campaign.
4. The communications dispatcher may send only finalized ledger attempts. An unknown outcome is never blindly resent; an authorized settings operator reconciles it from exact provider evidence.
5. **Schedule post** appears only when the target environment explicitly enables the accepted publisher. A stored `scheduled` row is not itself proof of publication, email, or member-feed visibility; confirm the later Feed state. The publisher revalidates the original actor, plugin, term, class, expiry, and no-email boundary, then publishes and audits atomically. If any check fails, the post stays scheduled with a visible hold reason. Scheduled posts never queue email.

---

## 10. Terminology and state model

### 10.1 Required product terminology

| Do not use                  | Use instead                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Review inbox                | Applications awaiting decision, Point submissions awaiting review, Imported rows to resolve |
| Semester readiness          | Semester setup, or the exact missing item                                                   |
| At risk                     | The exact condition: 2 points remaining, Missing March meeting, Awaiting dues verification  |
| Prepare Spring 2026         | Spring 2026; Configure Spring 2026 only on setup action                                     |
| F25/S26 in visible headings | Fall 2025/Spring 2026; codes may remain in imports and compact metadata                     |
| CSF member ledger           | Members or Member directory                                                                 |
| Onboarding                  | Connect student record or Class join code                                                   |
| Audit                       | Change history in UI; audit remains an internal technical term                              |
| Sync                        | Import for inbound data; Export for outbound data; reserve sync for provider health logs    |
| Point claim                 | Point submission in general UI; “claim” may appear in explanatory copy                      |
| Failed member               | Incomplete semester, with explicit reasons                                                  |
| Health/risk score           | No replacement                                                                              |
| Communications/Updates      | Remove from product navigation                                                              |

### 10.2 Independent state dimensions

These states must not be collapsed into one generic application or member status.

#### Application submission

`imported` → `missing_information` or `ready` → `under_review` → `decided`

- `imported`: source row exists; normalization/checks not yet complete.
- `missing_information`: one or more required items are absent or invalid.
- `ready`: mandatory review inputs are present.
- `under_review`: assigned reviewer has started the decision.
- `decided`: an explicit approval/rejection exists.

#### Academic eligibility

`pending`, `eligible`, `ineligible`, `adviser_override`

An override stores failed checks, reason code, explanation, actor, and policy version. It does not rewrite the deterministic calculation to “eligible.”

#### Dues

`not_recorded`, `receipt_submitted`, `verified`, `waived`

If a receipt is rejected or requires correction, the application check explains the issue while dues returns/remains `receipt_submitted` until replaced or waived.

#### Application decision

`pending`, `approved`, `rejected`, `withdrawn`

#### Term membership outcome

`requirements_in_progress`, `completed`, `incomplete`, `revoked`

“Approved application” maps to `requirements_in_progress`; it does not map to `completed`.

#### Import job

`draft`, `reading`, `preview_ready`, `needs_reconciliation`, `committing`, `completed`, `completed_with_exceptions`, `failed`, `cancelled`

#### Import row

`pending`, `valid`, `candidate_match`, `ambiguous`, `duplicate`, `conflict`, `invalid`, `committed`, `skipped`, `failed`

#### Activity

`draft`, `published`, `closed`, `cancelled`, `archived`

### 10.3 Typed reason codes

Free text supplements a reason code; it never substitutes for one where reporting depends on the reason.

Minimum families:

- Missing information: `missing_transcript`, `missing_receipt`, `missing_course`, `missing_grade`, `missing_identity`, `invalid_email`, `unreadable_document`, `other`
- Ineligibility: `insufficient_total_points`, `insufficient_list_i`, `insufficient_list_i_ii`, `too_many_courses`, `disqualifying_grade`, `unrecognized_course`, `other`
- Decision: `requirements_not_met`, `information_not_received`, `duplicate_application`, `student_withdrew`, `adviser_exception`, `other`
- Membership incomplete: `points_not_met`, `drive_cap_exceeded`, `meeting_requirement_not_met`, `dues_not_verified`, `revoked_for_policy`, `other`
- Import: `required_column_missing`, `invalid_value`, `ambiguous_identity`, `duplicate_source_row`, `reviewed_field_conflict`, `unsupported_format`, `provider_error`, `other`

---

## 11. Data model and invariants

The rebuild extends the existing `plugin_data.csf_*` foundation. It does not create a second student identity system and does not destructively rename stable tables merely to match UI labels.

### 11.1 Identity and access

| Concept                     | Physical model                                                      | Required behavior                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permanent student           | `csf_profiles`                                                      | One durable student record per organization; normalized identity fields; fictional test ID support; no semester status stored here                                    |
| Platform account connection | `csf_profile_accounts`                                              | Verified account link with actor/source/time; one active unambiguous connection per user/org                                                                          |
| Link request                | `csf_profile_link_requests`                                         | Limited candidate and resolution history; exact unique confirmed email may offer student confirmation, but does not connect before confirmation; name-only never does |
| Graduating class            | `csf_cohorts`, `csf_profile_cohort_memberships`                     | Historical membership and class changes remain traceable                                                                                                              |
| Duplicate merge             | `csf_profile_merge_reviews`                                         | Preview and two-person/adviser review when configured; move references atomically; source becomes merged tombstone rather than disappearing                           |
| Staff access                | `csf_roles`, `csf_role_permissions`, `csf_staff_positions`, history | Capability-based, effective-dated assignments                                                                                                                         |

### 11.2 Semester, application, and eligibility

| Concept                 | Physical model                         | Required behavior                                                                                                                                                                          |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semester                | `csf_terms`                            | `planned/open/closed/archived`; one current operational term per org unless explicit overlap rules allow planned next term                                                                 |
| Policy                  | `csf_term_policies`                    | Immutable published versions; store academic, dues, service, meeting, and recognition rules                                                                                                |
| Deadlines               | new `csf_deadlines`                    | Term, type, label, due time, owner position/user, status, optional related record; no generic task score                                                                                   |
| Application             | `csf_term_applications`                | One active application per student/term; independent submission, eligibility, dues, and decision fields; assignee and source provenance                                                    |
| Course line             | `csf_application_course_entries`       | Raw source text plus normalized course, list, grade, base/bonus/counted points, validation, and display order                                                                              |
| Supporting file         | `csf_application_files`                | File type, provider/source ID, safe metadata, private storage reference if uploaded, and scoped access                                                                                     |
| Typed check             | new `csf_application_checks`           | One current result per application/check type plus history: `required_information`, `identity`, `academic`, `transcript`, `dues`; status, reason code, details, policy version, actor/time |
| Private note            | new `csf_application_review_notes`     | Author, visibility=`staff`, body, created/edited timestamps; editing preserves revision history or appends replacement                                                                     |
| Status/decision history | extend `csf_application_status_events` | Immutable event type, previous/next dimension state, reason code/text, actor, correlation ID                                                                                               |
| Dues verification       | new `csf_dues_records`                 | Application/term/profile, amount expected if configured, evidence file, state, verifier, waiver actor/reason; no payment credentials                                                       |
| Term membership         | `csf_term_memberships`                 | Exactly one per profile/term; linked application; outcome separate from decision; evaluation snapshot and override data                                                                    |

`csf_term_applications` gains or standardizes:

- `submission_status`
- `eligibility_status`
- `dues_status`
- `decision_status`
- `assigned_to_user_id`, `assigned_at`
- `decision_reason_code`, `decision_reason_text`
- `policy_version_evaluated`
- `source_import_row_id`
- `review_started_at`, `decided_at`, `decided_by`

Existing aggregate academic columns may remain as cached/source values but are never accepted as the only eligibility evidence when course rows are required.

### 11.3 Service and participation

| Concept          | Physical model               | Required behavior                                                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity         | `csf_opportunities`          | Structured term record with lifecycle, audience, point rule, signup, evidence, and immutable award-sensitive versioning                                                                                                                                                                                 |
| Signup           | `csf_opportunity_signups`    | External/linked-project verification state; never equated automatically with attendance or awarded points                                                                                                                                                                                               |
| Point submission | `csf_point_submissions`      | Claimed quantity, source, activity/club relation, state, and student-facing/private review fields separated                                                                                                                                                                                             |
| Evidence         | `csf_submission_files`       | At most policy-supported active proof set; private and lifecycle-managed. `pending` requires an upload token and null terminal timestamps; `finalized` requires `finalized_at` and null `failed_at`. Direct fixture inserts declare the complete lifecycle tuple instead of relying on schema defaults. |
| Awarded credit   | `csf_credit_records`         | Numeric quantity, type, status, source submission/import/manual adjustment; totals are derived                                                                                                                                                                                                          |
| Review           | `csf_submission_reviews`     | Immutable review actions and changes                                                                                                                                                                                                                                                                    |
| Appeal           | `csf_point_appeals`          | Separate member request and resolution history                                                                                                                                                                                                                                                          |
| Meeting          | `csf_meetings`               | Logical requirement for a term                                                                                                                                                                                                                                                                          |
| Session          | `csf_meeting_sessions`       | Dated attendance opportunity for one logical meeting                                                                                                                                                                                                                                                    |
| Attendance       | `csf_meeting_attendance`     | One result per profile/session with match/source/reconciliation state                                                                                                                                                                                                                                   |
| Partner club     | `csf_partner_clubs`, aliases | Durable canonical club identity                                                                                                                                                                                                                                                                         |
| Club term record | `csf_partner_club_terms`     | Per-term relationship status, workflow standing, policy-review flag (`allocation_satisfied`) with policy notes, reference-only `spreadsheet_url`, reviewer, and append-only term events                                                                                                                 |
| Club form import | shared import rows           | Immutable form-response export rows (`partner_club_audit` / `partner_club_renewal`); each row is applied as a draft not-reviewed club record or skipped                                                                                                                                                 |

Free-form “Activity 1–7” columns are import evidence only. Current operational data always uses normalized activities/submissions/awards.

### 11.4 Imports and provenance

| Concept           | Physical model                        | Required behavior                                                                                                                       |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Source            | extend `csf_sheet_sources`            | Provider, Drive file ID/name/url, modified time, source type, tab/range, owner, current mapping version                                 |
| Mapping           | source mapping JSON plus version/hash | Header signature, field destinations, transforms, defaults, author/time; historical jobs retain snapshot                                |
| Job               | extend `csf_sheet_import_jobs`        | Source snapshot/digest, type, term/cohort, status, actually recorded counts/operator, preview/retry ancestry, correlation ID, start/end |
| Row               | extend `csf_sheet_import_rows`        | Raw/normalized data, tab/range/row, row hash, validation, match candidates, typed resolution/reason, commit target, retry lineage       |
| Sync/provider log | `csf_sheet_sync_logs`                 | Technical read health only in this release; not a second business-state log or evidence of Sheet writeback                              |

### 11.5 History and correlation

Extend `csf_admin_audit_events` with:

- `correlation_id` shared by every row in one consequential transaction
- `source_type`, `source_id`, and safe `source_ref`
- typed `reason_code` plus optional explanation
- immutable event category and safe before/after summaries

Database triggers prevent update/delete of audit and immutable source rows except explicit retention procedures executed by service-role maintenance.

Request-aware consequential operations use an explicit request-receipt namespace rather than treating an arbitrary correlation value as proof of success. The receipt binds organization, actor, normalized intent/fingerprint, target, canonical committed state, and underlying audit evidence. Authorization occurs before receipt lookup. An exact retry may reuse success only while that state and evidence remain current; changed intent or stale state fails closed.

### 11.6 Organization-scoped integrity

Critical child relationships must enforce organization consistency, preferably through composite unique keys and composite foreign keys such as `(organization_id, id)`. Application, membership, course, file, dues, submission, award, attendance, import, and history records may never reference a parent from another organization.

### 11.7 Atomic operations

Security-definer RPCs remain service-role-only and perform their own organization/record validation. At minimum, these boundaries are atomic:

- Application approval/rejection plus membership, decision event, request receipt, and history
- Point-submission decision plus award/reversal and history
- Profile merge plus reference movement, merge review, request receipt, and history
- Direct student-specific link create/renew/cancel/expire plus its request receipt; delivery telemetry remains separate
- Post create/update/pin/archive plus its request receipt; optional email campaign creation remains a separate truthful outcome
- Policy publication plus history
- Attendance import-row commit plus provenance
- Term close/reclose plus every membership outcome, closure snapshot, and history

### 11.8 Derived values

The same domain evaluator powers member UI, officer tables, reports, exports, and term close. Derived values are never independently recomputed in components.

- Academic totals derive from course entries and policy snapshot.
- Service totals derive from active awarded credit records and term rules.
- Meeting completion derives from session attendance and meeting policy.
- Senior recognition derives from completed term memberships and recognition policy.
- “Remaining” values never go below zero and never imply a future outcome before the deadline.

---

## 12. Import workspace and reconciliation semantics

### 12.1 Supported source types

- Semester application responses and course/grade data
- Student roster and graduating-class identity data
- Historical class workbooks with semester tabs
- Meeting attendance responses
- Returning-club applications and club audits/renewals (Google Form response exports)

### 12.2 Workspace sections and controls

The import workspace is not a step wizard. There is no navigable step sequence, no forward/back control between steps, and no client-held step state. It is a fixed stack of sections — connection, progress, preview, sources, results — whose visibility follows recorded server state.

#### 12.2.1 Import progress strip

- A non-interactive, read-only reflection of recorded job state, rendered only once a preview exists: **Source**, **Scope**, **Map**, **Preview**, **Reconcile**, **Commit**, **Result**.
- Every stage is derived — source file name recorded; tab and range recorded; mapping snapshot at version ≥ 1; sealed snapshot; sealed with zero conflicts; a commit job exists; that job completed. A reload or a second officer sees the same position.
- It carries no controls and grants no navigation. It must never be described, or implemented, as a step the operator advances.

#### 12.2.2 Google Sheets connection

- Named status: **Connected**, **Reconnect required**, **Not connected**, **Checking access**, with the connected address, last-checked time, and the approved chapter account.
- Controls: **Recheck**; **Connect**, **Switch or reconnect**, or **Switch account** according to state; **Disconnect from CSF**; **Disconnect and revoke at Google**.
- The connection is bound to the acting Let's Assist user, organization, plugin, import purpose, and capability. It is not an organization-wide switch and cannot be completed on another operator's behalf: an operator without their own verified connection sees **Not connected**.
- A wrong, missing, or legacy-unverified identity names its own reason and blocks file selection until corrected.

#### 12.2.3 Source section — new import or local upload

- One collapsible **New Google Sheets import** section (**Start another import** once a preview exists) and a separate local-upload section for supported XLSX/CSV.
- Typed **Record type** selection, restricted to the capabilities the operator holds: student roster, application responses, historical class workbook. Target strategy follows the type — mixed-grade application sources resolve immutable per-row cohort/term targets and state so instead of offering a class control.
- Google Drive Picker selection displays exact provider file ID and name, owner when available, MIME type, modified time, safe link, and current access state.
- Operator selects graduating class where applicable, semester, and a single sheet tab, then **Header row** and a bounded **A1 range**. An explicit range must name the same selected tab; unqualified ranges are canonically scoped to that tab.
- Do not fetch every row before the operator confirms the source.

#### 12.2.4 Range inspection and column mapping

- **Inspect columns** reads only the header row and a bounded sample below it. It reads neither the full import range nor any operational record.
- The result names the workbook, tab, selected range, actually inspected range, sample row count, and column count, and states either headers-ready or an exact header-issue count.
- Column mapping opens from that inspection. Destinations are grouped by domain — identity, semester, application, courses, files, attendance, activities, club data — and required destinations show why they are required.
- Mappings bind by column position, so duplicate or empty header names stay distinct. Mapping can split repeated course/activity columns and apply controlled transforms.
- Mapping version stores header signature and transformation configuration.
- Column resolution may suggest a destination from a stable key, a configured header, an alias, or column shape, but a suggestion is never authority. The officer's explicit **Not mapped** answer is: a semantic field set to it resolves no column at all, and no alias or shape-based detection may reintroduce one. This matters most for email, where a discovered guardian, recovery, adviser, or invalid address would otherwise become matchable identity evidence for a field the officer deliberately left empty.
- **Preview normalized rows** creates the preview. Creating a preview writes no operational student/application/service record.

#### 12.2.5 Preview section

- Creates an immutable job snapshot with accessible file metadata, selected tabs/ranges, versioned mapping, raw rows, and row hashes.
- Header counts: **Rows**, **Ready**, **Existing**, **Needs review**. **Ready** displays zero until the preview is sealed, rather than implying readiness from an unsealed attempt.
- A **Normalized snapshot** block states the normalized row count, abbreviated snapshot and source digests, child-manifest digest and tab count for multi-tab sources, a not-retained field count, and warning badges for hidden, filtered, and formula-only rows with their per-tab evidence. A recorded-but-unsealed attempt and a pre-snapshot preview each say so and require a fresh preview.
- Normalized values are shown beside source values, including the resolved cohort and semester for every pending row.

#### 12.2.6 Normalized rows and paging

- The row table is a bounded display slice of one preview, ordered deterministically, with the position held in the URL so a page survives reload, sharing, and browser history.
- Controls are **First rows**, **Previous rows**, and **Next rows**, in a labelled navigation region. A single-page preview renders none of them.
- The control group states, on every page, that counts and import readiness describe the whole preview and not the visible page. A cursor that no longer selects rows says so and still offers **First rows**; it never renders as an empty preview.
- No count, badge, blocker, or commit decision is ever derived from the visible page. Readiness is server-counted across the whole preview.

#### 12.2.7 Reconciliation decisions

- Exact stable ID or exact unique normalized verified email may match automatically.
- Name plus class/year creates candidates only.
- Name alone never commits automatically.
- Operator can select a candidate, create a new record, skip, or leave unresolved. A **Use match** decision stores a typed match outcome plus a required 4–500 character officer explanation of the evidence. A **Skip row** decision stores a typed skip outcome plus a required 4–500 character explanation of why the source row must not be imported.
- A reviewed platform field that differs from the import is a conflict; resolution must explicitly keep platform or apply source with permission/reason.
- Decision controls disable while pending, preserve the selected profile/reason after validation or transport failure, and clear only after confirmed success.
- A recovery worklist is projected for rows whose outcome is unresolved or failed. It carries coordinates and recovery state only — no normalized payload, source cell values, email fields, or correlation identifier reaches the browser. **Recover stopped import** settles stale intents; blocked recovery rows hold the commit closed.

#### 12.2.8 Commit control

- Commit reads the immutable preview, not a fresh unannounced source version.
- If provider modified time changed, warn and require a new preview or explicit commit of the captured snapshot.
- Commit remains blocked until the exact file ID/name, current access, selected tab/range, mapping version, and every pending row’s resolved cohort and semester are present. UI enforces readiness and the server rechecks it before creating the commit job.
- The server returns the canonical blocker list used by job status, preview summary, and the commit control; a failed or stale job cannot be reinterpreted as ready from row counts alone. The first blocker is surfaced as **Import blocked**.
- The control names the operation it performs rather than a generic import: **Verify source and commit** on a first commit, **Resume import** when an earlier commit of the same preview did not finish, **Finish import** when nothing remains to write, **Committed** once complete. A concurrent holder is disclosed instead of silently disabling the control.
- Valid/resolved rows commit idempotently by source identity/hash. A resumed commit never rewrites an already-committed row.
- Valid rows may commit while unresolved/invalid rows remain exceptions.
- Each row records created/updated targets and correlation ID.

#### 12.2.9 Results and history

- Show created, updated, unchanged, skipped, unresolved, conflict, and failed totals.
- Link to generated records and exception table.
- “Retry corrected rows” creates a child job with `parent_job_id`; it never mutates the old job snapshot.
- A sanitized error export excludes private raw fields not needed to correct the source.
- History is bounded and discloses its bound. It distinguishes preview ancestry from retry ancestry and includes row decisions with officer/reason/time when present. It abbreviates a recorded source digest and uses **Not recorded** rather than deriving missing historical facts from current rows or another run.

### 12.3 Idempotency and overwrite rules

- `(organization, source, tab, row, row_hash, mapping_version)` is the semantic identity of a previewed source version. It is the invariant the workspace, reconciliation, and commit reason about. It is assembled from columns recorded at two levels — `organization_id` and `source_id` on the preview job, `sheet_tab_name`, `row_number`, `row_hash`, and `mapping_version` on the row — and it is not itself a single database key.
- The database enforces the coordinate half of that identity directly: `csf_sheet_import_rows_job_coordinate_idx` is `UNIQUE (job_id, sheet_tab_name, row_number)`, so one preview job holds at most one row per real source coordinate. Because a preview job carries exactly one source, that index is what makes the full tuple unique in practice.
- Commit fencing is enforced separately and just as strictly: a commit job may hold at most one running attempt (`csf_commit_attempts_one_running_idx`), attempt numbers are unique per commit job, and every correlation identifier is unique.
- Recommitting the same resolved row returns the existing target result. A resumed or retried commit never writes an already-committed row a second time.
- A changed row creates a new source version and comparison, not an in-place rewrite of evidence.
- Unreviewed imported fields may update according to declared duplicate policy.
- Reviewed applications, verified dues, approved awards, resolved attendance, and closed memberships never change silently.
- Deletes in Google Sheets do not delete platform records. They create a source discrepancy for review.

### 12.4 Row-level error examples

- Required header not mapped
- Invalid or missing email
- Unrecognized term code
- Course/grade count mismatch
- Unsupported grade value
- Transcript or receipt link inaccessible
- Ambiguous student identity
- Duplicate source submission
- `#REF!` or other formula error
- Malformed meeting date
- Reviewed platform value conflicts with source
- Activity slot cannot be converted to a numeric award

---

## 13. Integration behavior

### 13.1 Google Sheets

- Use existing Google OAuth and Sheets REST access through server code.
- Request the narrowest scopes compatible with Drive Picker and user-selected files.
- Reads are explicit previews; scheduled background business-state synchronization is off by default.
- Mapping, import, reconciliation, and history follow Section 12.
- This release is input-only: it performs no Sheet writeback and exposes no compatibility-tab or report destination. Report exports are permission-checked local ZIP archives containing formula-safe CSV files and a manifest.
- Provider/API failure shows whether authorization, access, quota, range, or parsing failed.

### 13.2 Google Drive

- Drive Picker selects a file the connected account can access.
- The CSF callback stores a connection only when Google user-info verifies the exact approved chapter identity, `dvhighcsf@gmail.com`, for the organization/plugin/import-purpose binding. A wrong, missing, or legacy-unverified identity requires account switch/reconnect before Picker access. This gate governs every Google-read importer; partner-club form-response imports are local export uploads with no Google read, so they neither require nor bypass it.
- Persist provider file ID, display name, safe URL/reference, MIME type, modified time, selected tab/range where relevant, and import/access timestamp.
- Recheck access before opening a supporting document.
- Generate scoped links or server-mediated access; never turn a private source into a public URL.
- When a source disappears or access is revoked, keep provenance and show “Source unavailable”; do not delete reviewed records.
- **Disconnect from CSF** removes the local purpose binding and preserves reviewed records/source history. **Disconnect and revoke at Google** claims remote revocation only after Google confirms it; a grant shared by another active binding is not revoked silently, and a remote-success/local-failure outcome remains recoverable rather than being reported as complete.

### 13.3 Google Forms

Forms are represented through their linked response Sheets and source metadata. The platform does not edit form structure or responses. A configured application link may appear in My CSF while the window is open.

### 13.4 Google Classroom (amended v1.1)

There is intentionally no Classroom integration. Google Classroom is retired as the chapter announcement channel; announcements are in-product cohort posts per Amendment 1.

- No Classroom OAuth scopes
- No class picker
- No recipient simulation
- Post email delivery status comes only from the durable ledger and provider events — no simulated or asserted delivery claims

Activity and deadline pages may offer a local “Copy summary” action for external use. Copying text is a convenience and does not create a communications record or imply publication.

### 13.5 Public website and Instagram

Settings stores official links. The public plugin page links outward and may show deliberately public activities. Website pages, membership policy, and social posts remain externally managed.

---

## 14. Security, privacy, and operational safeguards

### 14.1 Data access boundary

- All CSF tables remain in `plugin_data`.
- `PUBLIC`, `anon`, and ordinary `authenticated` table grants remain revoked.
- The browser never receives a general Supabase client capable of querying CSF tables.
- Server Actions obtain fresh authenticated user/org/plugin context and verify capability before any service-role query.
- Every query and mutation includes organization scope even when an ID is globally unique.
- RLS remains enabled as defense in depth rather than as the only authorization layer.

### 14.2 File safety

- Transcripts, receipts, and proofs remain private.
- Persist only needed file metadata and provider/private-storage references.
- Signed access is short-lived and scoped to an authorized request.
- File lifecycle deletion removes owned private objects when legally/operationally allowed but preserves a non-sensitive history event.
- Logs and audit events never contain full document URLs with reusable tokens.

### 14.3 Sensitive actions

The following require a reason and immutable history:

- Adviser academic override
- Dues waiver
- Application rejection or reopen
- Profile unlink/merge
- Historical identity/class correction
- Manual attendance correction
- Point adjustment/reversal
- Activity cancellation after publication
- Policy publication/replacement
- Term close/reopen/reclose
- Sensitive export
- Staff capability change
- Import-row match/skip and unknown-outcome reconciliation
- Communications quarantine acknowledgement or provider-evidence outcome reconciliation

### 14.4 Concurrency

- Review pages display a version/updated time.
- Consequential mutations use row locks or optimistic version checks. Application decisions, profile merges, direct secure-link mutations, and post mutations additionally use a stable request identifier bound to actor and normalized intent with an immutable receipt.
- If another reviewer changes the record, the stale action fails safely and shows what changed.
- Assignment does not grant permission by itself; capability and assignment are both checked where required.
- A replayed request is success only when the exact committed target/state and supporting audit evidence remain current. Reusing the identifier for changed intent, or replaying after state drift, fails closed.

### 14.5 Observability

- User-facing failures include a correlation ID.
- Server logs include correlation ID, organization ID, action type, and safe target IDs—not student names, raw rows, tokens, or document contents.
- Import/provider telemetry distinguishes authorization, provider, parser, validation, and commit failure.
- Vercel Speed Insights renders only when `VERCEL=1`; local, test, and self-hosted runs make no telemetry-script request.

### 14.6 Local/remote environment rule

Development and migration work targets the dedicated local Supabase stack. Named MCP configurations may coexist, but remote projects remain read-only unless the user separately authorizes deployment or production mutation. The migration ledger must be reconciled and a clean local replay must pass before new product migrations are accepted.

---

## 15. Seed and fixture strategy

All seed data is fictional and visibly synthetic.

- Person and organization contacts use reserved test domains and privacy-safe fictional names. A real external contact identity never enters a seed, test, screenshot, or gallery.
- Use 25–40 representative students across multiple graduating classes for ordinary local development.
- Test IDs use an unmistakable form such as `DVHS-TEST-2028-001`; never resemble a real district identifier.
- Include unique/ambiguous email matches, missing transcript, missing course, disqualifying grade, eligible calculation, dues submitted/verified/waived, approved/rejected/withdrawn applications, and adviser override.
- Include current and historical completed/incomplete memberships sufficient to test senior recognition.
- Include draft/published/closed/cancelled activities, numeric awards, correction requests, rejection, and appeal.
- Include meetings with matched, ambiguous, unmatched, excused, and manually corrected attendance.
- Include partner clubs across term-standing states (active, suspended, expired, not reviewed) and aliases.
- Include successful, partial, failed, corrected-retry, and reviewed-field-conflict imports.
- Do not seed Classroom announcements. Legacy (pre-v1.1) announcement rows may remain only as migration-history fixtures. Fixtures for the v1.1 posts surface are fictional cohort posts covering draft/published/archived, pinned, class-targeted, and email-queued states. A synthetic `scheduled` row may exist only to prove the open publisher-acceptance boundary and must not be presented as delivered or automatically published before V120 passes.
- Load/performance fixtures generate approximately 600 applications and 1,000 member profiles without being committed as private-looking named data.

Raw fixture workbooks may mirror the **shape** of observed DVHS sheets but never their private values.

---

## 16. Removal, migration, and compatibility plan

### 16.1 Remove from active product

- Legacy Communications/Updates navigation and creation UI (superseded by the Amendment 1 posts surface, amended v1.1)
- Generic Onboarding navigation
- “Review inbox,” “Semester readiness,” “At risk,” “Prepare [term],” “F25 focus,” and “CSF member ledger” copy
- Decorative metric cards and empty charts
- Hidden/duplicate navigation tabs and two-row “More tools” layouts
- Empty future-semester chips
- Spreadsheet-slot semantics as the operational point model
- Any dead button, simulated provider action, or unimplemented dialog

### 16.2 Preserve as read-only history or compatibility

- Pre-v1.1 announcement rows: migration history only. Posts created under Amendment 1 are active product data (amended v1.1)
- Existing direct plugin URLs: temporary redirect aliases
- Existing aggregate application totals: source/cache fields, not the eligibility decision model
- Existing legacy term meeting records: migrated to logical meeting/session records
- Existing class tabs: read/import evidence only; they are not compatibility-export or report-write targets in this release

### 16.3 Data migration principles

- Add normalized state/check/dues/deadline/provenance fields before switching UI.
- Backfill state dimensions deterministically from current status where possible; ambiguous mappings become explicit migration exceptions.
- Do not invent approvals, eligibility, dues verification, or completed memberships from incomplete source data.
- Preserve original row/file references and current audit records.
- Recompute derived display values through the shared evaluator after migration.
- Feature-gate the new IA until required schema and backfill checks pass locally.

### 16.4 Status mapping baseline

Current combined application statuses map conservatively:

- Draft/imported-like records → submission `imported`, decision `pending`
- Needs review → submission `ready` only if required fields validate; otherwise `missing_information`
- Accepted → submission `decided`, decision `approved`; eligibility/dues remain their evidence-derived states, not assumed
- Rejected → submission `decided`, decision `rejected`
- Withdrawn → submission `decided`, decision `withdrawn`

Current accepted/active membership maps to `requirements_in_progress`. Only a defensible existing completed result maps to `completed`.

---

## 17. Implementation roadmap

### Phase 0 — Contract and database baseline

- Adopt this specification and removal/rename matrix.
- Reconcile local migration ledger drift.
- Prove a clean local `supabase db reset`/seed replay.
- Add canonical domain types and shared reason codes.
- Add organization-scoped integrity and immutable audit/source protections.

**Exit:** Clean replay; existing CSF tests pass; no remote writes.

### Phase 1 — Application and membership core

- Add independent application state dimensions, typed checks, dues, deadlines, notes, assignments, correlation, and atomic decision updates.
- Rebuild canonical shell/navigation.
- Build Home, review queue/detail, all applications, member directory/detail, account connection, My CSF, and current-semester views.
- Remove generic home/onboarding concepts and legacy communications UI from active navigation (the Amendment 1 posts surface is not legacy UI).

**Exit:** An imported fictional application can be reviewed course-by-course, corrected, approved/rejected atomically, and seen correctly by the student.

### Phase 2 — Complete import and reconciliation

- Extend source/job/row provenance and mapping version model.
- Implement Drive source selection, tab/range selection, mapping, immutable preview, reconciliation, idempotent partial commit, summary, and retry lineage.
- Support application, roster, historical class, attendance, and club formats.

**Exit:** Every supplied workbook shape has anonymized fixtures covering success and failure; reviewed records are not silently overwritten.

### Phase 3 — Service operations

- Rebuild Activities, Point submissions, appeals, normalized awards, Meetings, attendance reconciliation, and Partner clubs under Service.
- Replace hard-coded `/7` displays with selected policy values.
- Remove free-form operational activity slots while retaining legacy evidence.

**Exit:** Member-to-officer service flow and meeting import are complete and audited.

### Phase 4 — Semester close, reports, history, and public boundary

- Build Schedule & deadlines, Policy, Previous semesters, close/reopen preflight, Seniors, Reports, Staff access, Change history, and Settings.
- Simplify public page and verify no private query path.
- Retire legacy routes/components after redirect telemetry and test coverage.

**Exit:** A fictional term can be configured, operated, closed atomically, reported, and viewed historically.

### Phase 5 — Production-quality verification

- Load representative scale fixtures.
- Complete responsive, accessibility, error-state, concurrency, security, and browser journeys.
- Run the full command/test matrix.
- Conduct role-based walkthrough with applicant, member, officer, and adviser fixtures.

**Exit:** Every acceptance criterion in Section 18 passes.

---

## 18. Verification and acceptance criteria

### 18.1 Database and security

- Clean local migration replay and deterministic fictional seed pass.
- Every CSF table has RLS enabled and no unintended browser role grant.
- Cross-organization foreign-reference and query tests fail closed.
- Application decision, point review, profile merge, policy publish, and term close are atomic and audited.
- Identity merge/connection and application decisions reject stale preflights and hard conflicts at the database/service boundary.
- Link creation/renewal cannot mutate delivery telemetry; email telemetry requires a durable queue/delivery receipt.
- Direct secure-link creation accepts only a current unique email recorded on the selected active profile and exact retries revalidate that identity/link evidence.
- Post create/update/pin/archive commits one canonical post mutation and request receipt atomically. A class-post campaign freezes its exact cohort and recipient snapshot.
- Point submission/proof/withdrawal/review/appeal boundaries reauthorize current actor, term, membership, published policy, source, cap, and proof conditions under lock as applicable.
- Audit/source evidence cannot be updated or deleted through product operations.
- Import commit is idempotent and preserves retry lineage.
- Private files require current authorization and time-limited access.
- Public routes return no private student-derived data.

### 18.2 Eligibility and membership

- Unit tests cover List I, List I+II, total thresholds, course limit, grade points, bonus caps, disqualifying grades, unknown courses, missing transcript, dues, and adviser override.
- UI/action tests cover all six List I/II/III × A/B policy values, plus/minus normalization, draft revision conflicts, preservation of valid advanced keys, and publication-only activation.
- Approved application produces `requirements_in_progress`, not `completed`.
- Term close uses the selected immutable policy version and produces explicit incomplete reasons.
- Senior recognition uses completed outcomes and versioned recognition policy.

### 18.3 Imports

- Anonymized fixtures cover every supported source shape.
- Tests cover changed headers, missing columns, duplicate emails, duplicate names, malformed dates, `#REF!`, inaccessible file links, repeated activity slots, source changes after preview, partial commit, conflict with reviewed data, and corrected retry.
- Preview writes no operational business record.
- Every committed row links back to source/job/row/hash/mapping.
- Match and skip each require a visible bounded officer reason, preserve fields on failure, and appear in truthful run history with only actually recorded actor/digest/count/ancestry facts.

### 18.4 UI and workflows

- Every visible button has a meaningful, tested action.
- Mutating buttons enter a visible pending state on the first activation, prevent duplicate requests, and preserve form data after failure.
- Persisted records and optional provider/queue side effects have separately tested success, partial-success, and failure copy.
- Classes → Stream is reachable to every `manage_posts` template; Feed remains the member label. No active UI or instruction calls either surface Classroom.
- Scheduled post UI is available only in an environment with explicit publisher opt-in. The due-post runner revalidates permission and scope, serializes concurrent claims, publishes and audits atomically, exposes hold reasons, and never queues scheduled email. The environment still needs successful hosted invocation and visible schedule → Feed evidence before operators rely on its timing.
- Google connection state displays the exact verified chapter account, refuses wrong/unverified identities, and distinguishes local disconnect, confirmed remote revoke, shared-grant preservation, and partial cleanup failure.
- Unknown delivery outcomes and quarantined webhook events expose a permission-checked, evidence-only recovery path that cannot silently retry, send, suppress, or rewrite provider evidence.
- Announcement email copy distinguishes durable queueing from provider delivery. A hosted dispatch cadence is not accepted until its configuration and repeated invocation are verified; the existence of the route/ledger alone is insufficient.
- Every linked count opens the exact underlying filtered records.
- Every status in UI matches Section 10.
- No prohibited copy appears in active CSF UI.
- URL filters and selected records survive refresh/back navigation.
- Setup, true-empty, filtered-empty, loading, partial error, full error, validation, and success states are tested.
- Destructive actions name the consequence and require a reason where specified.
- Mobile journeys work at approximately 390 px; tablet at 768–1024 px; desktop at 1440 px and above.
- Keyboard navigation, focus order, dialog/sheet focus management, labels, live regions, contrast, and reduced motion pass accessibility checks.

### 18.5 Role journeys

**Applicant:** Connect record → see imported application → respond to missing information → see decision.<br>
**Member:** See current requirements → find activity → submit proof → correct/appeal → see awarded points and attendance.<br>
**Officer:** Open assigned work → import applications → reconcile rows → review course/document/dues → decide → run activity/meeting/points work.<br>
**Adviser:** Publish policy → resolve override → manage access → run close preflight → close term → export reports → review history.

### 18.6 Performance

- Application/member tables remain interactive with approximately 600 applications and 1,000 profiles through server-side filtering/pagination.
- Route entry fetches only the selected page’s data; it does not load every CSF dataset.
- Large exports run server-side and do not block the browser.
- Provider reads use bounded ranges and previews.

### 18.7 Required command gate

The final implementation must pass the repository’s current equivalents of:

```bash
bun run typecheck
bun run lint
bun run plugin:test:registry
bun run plugin:test:contracts
bun run dv:test:db
bun run csf:test:workflows
bun run csf:test:scale
bun run csf:test:e2e
bun run build
```

Run the dedicated Playwright DVHS CSF suite and manual browser walkthrough against a freshly reset local stack. If command names change, update this document and package scripts together.

### 18.8 Final product acceptance

The rebuild is accepted only when all of the following are true:

1. An officer can explain every home item as a real task, record, or deadline.
2. An adviser can reconstruct why an application or membership outcome occurred from source evidence, policy version, checks, notes, decision, and change history.
3. A student sees only their own accurate status and a clear next step.
4. Imports can be previewed, reconciled, committed, retried, and traced without silently overwriting reviewed data.
5. Service, meetings, and partner clubs use normalized records rather than spreadsheet-slot semantics.
6. Term closure is preflighted, versioned, atomic, and reversible only through an audited adviser process.
7. Google Classroom is not represented as an integrated, tracked, or active manual CSF workflow.
8. No real private Drive data appears in repository fixtures, logs, screenshots, or public output.
9. The product looks and behaves like a focused DVHS CSF workspace inside Let’s Assist—not a generic SaaS demo or a separate microsite.

---

## 19. Product invariants

These invariants are mandatory across schema, server actions, UI, imports, tests, and reports.

1. One permanent student identity may have many semester applications and memberships.
2. Application submission, eligibility, dues, decision, and membership outcome remain independent.
3. Approval plus membership transition plus history is one atomic operation.
4. Deterministic academic calculation is preserved even when an adviser overrides its result.
5. Policy versions used by decisions and closed terms are immutable.
6. Point totals, attendance completion, and recognition derive from normalized records through one shared evaluator.
7. A multi-point activity produces one award with a numeric quantity, not duplicate one-point records.
8. A name-only import or account claim never auto-links a student.
9. Preview precedes import commit; source provenance and raw snapshots are retained.
10. Reviewed platform records are never silently overwritten by Google data.
11. Google Forms/Sheets/Drive are intake/evidence channels after cutover, not dual operational authority. This release writes no Google Sheet; reports are local formula-safe ZIP archives.
12. Google Classroom remains retired, unintegrated, and untracked.
13. Every consequential mutation is server-authorized, organization-scoped, reasoned where required, correlated, and immutable in history.
14. Every private file remains private and is opened only through a current scoped authorization check.
15. Public pages expose no student record or private aggregate derived from student records.
16. Each route fetches only what that route and user capability require.
17. Visible status language states the condition directly; generic risk/readiness/health abstractions do not return.
18. No real student or connected Drive value is copied into seeds, tests, documentation examples, or screenshots.
19. Responsive variants retain the same Let’s Assist product-company branding.
20. Synthetic fixtures and generated screenshots contain only fictional privacy-safe contacts on reserved test domains.
21. Every direct proof fixture insert declares a valid complete upload lifecycle tuple; schema defaults never substitute for finalization.
22. (amended v1.5) A class join code auto-connects only on one active same-class profile carrying the account's verified email; conflicting or shared-email matches enter per-class officer review without roster search.
23. (amended v1.5) Class-code join and officer connection resolution update organization access, the account link, cohort membership, the request record, and immutable history in one organization-scoped transaction; the join never activates term membership, while resolution may atomically activate an already-accepted application's term membership.
24. A Google connection is authorized for one signed-in user, organization, plugin, purpose, capability, return route, and short expiry; the callback rechecks current permission before storing a purpose-bound connection.
25. Historical activity imports never infer a point value. Every imported award must contain an explicit, positive numeric quantity within the accepted import bound.
26. Semester close accepts the reviewed evidence hash—not browser-supplied membership decisions—and derives outcomes while the relevant policy and operational records are locked.
27. Tracked Supabase seeds contain no executable canonical seed, live contact, OAuth/bearer material, reusable invitation material, or hosted Supabase project URL.
28. A merge, connection, application approval, or import commit is available only from the same current server-derived preflight shown to the operator.
29. Link lifecycle and email-delivery lifecycle are separate; delivery language and telemetry require durable evidence.
30. `manage_posts` provides a reachable posting workflow, and post persistence is reported independently from optional email queueing.
31. Mutating controls expose pending and settled outcomes, reject duplicate activation, and never silently discard entered data.
32. A direct student-specific link can use only one current unique email recorded on the selected active profile; creating, copying, or renewing it sends no email.
33. The published semester policy, not a draft or component default, supplies the operative six List I/II/III × A/B grade-point values; plus/minus grades normalize to their base letter.
34. Import match/skip decisions retain a typed outcome and required officer reason; import history displays only recorded counts, actor, digest, reconciliation, and ancestry.
35. Request-aware application decisions, profile merges, direct-link changes, and post mutations authorize before receipt lookup, bind actor and normalized intent, and replay only while exact committed evidence remains current.
36. A post-linked email campaign freezes its term, audience, exact class cohort where applicable, recipient snapshot, consent topic, and content; later post/profile/cohort edits cannot rewrite it.
37. A CSF Google import connection is usable only after Google verifies the exact approved chapter account for the organization/plugin/purpose binding. Disconnect preserves reviewed records and provenance.
38. Unknown email outcomes are reconciled only from durable provider evidence and are never blindly resent. Quarantine resolution acknowledges triage with immutable history but does not apply or rewrite the provider event.
39. A stored `scheduled` post is not evidence of publication, feed visibility, or email queueing. Automatic publication is available only where the authorized, retry-safe, audited due-post transition is explicitly enabled and its hosted invocation has been accepted; scheduled posts never queue email.
40. Point lifecycle mutations reauthorize current actor/ownership, open term, active membership, published policy, source, cap, and finalized-proof conditions at the database boundary as applicable.
41. Profile merge inventories every current schema reference, moves live ownership atomically, deliberately retains immutable snapshots, and refuses every uniqueness collision in the same canonical preview rechecked under the first organization identity lock; settled successful or terminally skipped import targets remain immutable evidence, while frozen/retryable/in-flight/unknown import targets block until recovery settles them; success proves no unintended live source reference remains.

---

## 20. Verified local implementation baseline — July 15, 2026

This section records the tested local CSF fixture state after the functional-density and authorization pass. It is an implementation audit, not a claim about production data.

### 20.1 Active interface decisions

- The organization identity, Let’s Assist header, and one five-item CSF navigation row remain; redundant plugin shells and large hero spacing are removed.
- Home contains four linked operational counts, the signed-in officer’s nonzero tasks, deadlines, recent imports, and recent approvals. It contains no introductory or privacy-marketing copy.
- Applications is a compact Shadcn list with search, queue filters, sort, assignment, one derived review-status column, and a single Review action. Detailed checks remain inside the selected application.
- Members is a compact directory. Application, eligibility, dues, and membership are summarized as the current membership state; account matching and reusable invitations are compact contextual lists below the directory.
- Service uses local tabs for Activities, Point submissions, Meetings, and Partner clubs. Each tab renders one primary table instead of nested dashboard cards.
- Imports prioritizes the active preview and rows requiring reconciliation. File selection, tab/range selection, mapping, saved sources, and history use progressive disclosure.
- The public route contains organization identity, external links, member sign-in, and published activities only. It does not render privacy reassurance, product explanation, or student-derived records.
- Empty states are short rows or compact setup actions. They do not reserve dashboard-sized blank panels.

### 20.2 Local database posture and fixture inventory

- The local migration ledger replays through the current CSF migrations, including the explicit `close_term` permission migration.
- The `plugin_data` schema contains 50 `csf_*` tables. All 50 have RLS enabled, none expose a browser policy, and none grant `anon`, `authenticated`, or `public` direct table access. Private operations remain server-authorized.
- Critical CSF relationships currently use 27 organization-scoped composite foreign keys.
- The anonymized local fixture contains 7 profiles, 2 terms, 4 applications, 24 typed application checks, 4 dues records, 2 memberships, 5 activities, 4 point submissions, 4 awarded credits, 2 meetings, 3 attendance records, 1 sheet source, 2 import jobs, 3 import rows, and 2 audit events.
- The fixture currently has no course-entry rows and no deadline rows. Those absences are represented as setup work, not fabricated analytics.
- All three fixture import rows still require reconciliation; reviewed platform records are not silently overwritten.
- The current Sheet source reports `needs_attention`; the interface therefore does not claim that Drive or Sheets is connected merely because a source row exists.

### 20.3 Authorization corrections verified in this pass

- Semester closure now has a dedicated `close_term` capability. Owner and adviser receive it by default; ordinary officer templates do not.
- Close-term action, preflight, query, and UI visibility resolve the same capability.
- Point submissions require an active current term plus an accepted or active membership for that term.
- Effective-dated staff assignments use inclusive chapter-local date boundaries.
- Authenticated staff can open the public route without the staff-route guard converting it into a private permission error.

### 20.4 Historical gaps recorded on July 15

This list preserves the July 15 audit snapshot. Items explicitly marked resolved were completed by the July 16 amendment; unmarked items remain acceptance work.

1. **Resolved July 16:** staff assignment/revocation now atomically maintains host membership, effective dates, and immutable history; staff without a current CSF responsibility fails closed.
2. **Resolved July 16:** application, dues, assignment, decision, override, meeting, import, export, close, and reopen capabilities are granular; Treasurer cannot decide applications.
3. Application assignment is a queue/filter concept, not yet an authorization boundary for restricted reviewers.
4. **Resolved July 16:** Staff access supports effective dates, seat limits, revocation reasons, and immutable assignment history.
5. Audit-history visibility should be domain-scoped for content/activity roles rather than granting the full chapter log.
6. **Resolved July 16 in code and fixtures:** applicant and approved-member identities are distinct, private officer routes deny both, and point submission requires approved current-semester membership.
7. **Resolved July 16 for navigation:** every documented template and seat count is provisioned with fictional actors; the role-navigation matrix passed 14/14. Complete role mutation journeys remain acceptance work.
8. Course imports and real eligibility evaluation cannot be acceptance-tested until anonymized course-entry fixtures exist.
9. **Resolved July 16 in code and database replay:** adviser reopen is reasoned, revisioned, atomic, and immutable. Its visible browser mutation lifecycle remains acceptance work.

---

## 21. Confirmed implementation and browser amendment — July 16, 2026

This amendment records facts confirmed during the local browser and operational-evidence audit. It supersedes any conflicting implementation note above without weakening the product invariants.

### 21.1 Locked interface behavior

- Home begins with **Your tasks** and only shows work the signed-in person can perform. Admins and advisers may additionally see unassigned work and broken configuration.
- Applications is one compact Shadcn list. Selecting a row opens a URL-addressable full-page review; it is not a permanent split pane or dashboard.
- The visible CSF navigation is Home, Applications, Members, Service, Semester, and More. Page-local navigation belongs inside the relevant area.
- Content begins 16–24 px below the CSF navigation. Icons are the project’s configured Lucide icons at the component default (16 px in compact controls). Routine list rows are 44–52 px tall.
- Full term names are product language. Codes such as `F26` are displayed only as source Sheet tab names or compact provenance.
- Public and authenticated pages contain functional content only. Privacy is enforced structurally and tested; reassurance banners and marketing explanations are not a product surface.

### 21.2 Chapter positions and responsibility defaults

The default templates and public seats are:

- Co-President ×2
- Vice President — Membership
- Vice President — Publicity
- Vice President — Clubs
- Treasurer
- Secretary
- Web Master
- Activity Coordinator ×5
- Data Management
- Adviser

The public title, internal responsibility subtitle, capability grants, effective dates, and host organization membership are separate fields. Assignment and revocation are atomic with host membership and immutable history. No position assignment may downgrade an existing organization admin.

Granular application capabilities distinguish viewing checks, updating checks, assigning reviewers, verifying dues, recording waivers, adding private notes, deciding applications, and recording adviser overrides. Meeting reconciliation, import resolution, sensitive export, semester closure, and adviser reopen are likewise independent capabilities. Organization administrators bypass plugin role restrictions intentionally and are tested separately.

### 21.3 Confirmed source shapes

Earlier read-only Google Drive metadata evidence, not re-executed during this validation pass, confirms:

- Spring 2026 applications: one 618-row by 23-column response tab.
- February, March, and April 2026 meeting attendance: separate one-tab sources with 18 columns each.
- Spring 2026 club audit: one 132-row by 27-column response tab.
- The 2025–26 club tracker: eleven operational tabs.
- Class-of-2027 through class-of-2030 workbooks: eight semester tabs each, including `F26`.

These counts describe source capacity and structure, not accepted platform records. They must never appear as student-derived public analytics.

### 21.4 Import contract refinements

- Application sources may use a fixed target or `derive_from_grade`; every preview row shows its resolved cohort and term.
- Mappings persist stable column indexes/keys in addition to human-readable headers. Duplicate display headers never collapse into one field.
- Native Sheets require Picker selection and explicit tab/range. Local `.xlsx` files remain a separate upload channel.
- Meeting sources use the same source → map → preview → reconcile → commit → summary grammar as application and roster imports. Partner-club form-response rows preview immutably and are resolved per row — applied as a draft club record or skipped — rather than batch-committed.
- Every explicit **Import changes** action creates a new immutable snapshot and retry lineage. Reviewed platform fields are not silently overwritten.
- Loss of Drive access changes the source state to **Reconnect** and preserves reviewed records.
- Import history is source-specific and cursor-paginated; application/member/import queries default to 50 rows and cap at 100.

### 21.5 Public privacy acceptance

Public-route tests must assert the presence of organization identity, official links, and public activities while asserting the absence of member emails, private record identifiers, application/dues/attendance/point/proof/audit payloads, and unpublished activities. A sentence claiming that records are private is neither required nor sufficient.

### 21.6 Dialog reachability

- Permission, destructive-action, and reconciliation dialogs must fit within the current viewport and expose a keyboard-reachable scroll container when their content exceeds it.
- Consent controls and the primary action remain reachable at approximately 390 px, 768 px, and 1440 px widths and at a 720 px desktop height.
- Long permission or provenance inventories scroll inside a bounded region; they do not make a fixed dialog taller than the viewport.
- The lifecycle audit found the DVHS CSF installation confirmation rendering at 2,587 px tall with hidden overflow in a 1,280 × 720 viewport. The installation path was therefore blocked until the dialog and permission list received explicit viewport bounds and vertical scrolling.

### 21.7 Local browser origin contract

- Local browser verification may use `127.0.0.1` so the Next.js app and local Supabase share a loopback host. Next.js development assets and HMR must explicitly allow that hostname.
- The development-origin allowlist contains the hostname only—no scheme, port, wildcard, LAN host, or remote origin.
- A login page that fails to hydrate must never leak credentials through a native GET fallback. Its native fallback uses POST, browser tests wait for the exact hydrated secure-check state before submission, and verification fails on a password-bearing URL.
- Test configuration prefers a complete explicitly supplied local Supabase environment and validates that its URL is loopback-only. CLI discovery is a fallback, so stopped optional services such as Studio or analytics do not invalidate an otherwise healthy local database/auth/API test target.

### 21.8 Confirmed local lifecycle state — July 16, 2026

- Migration `20260716053000_dvhs_csf_atomic_import_reconciliation.sql` makes import-row decisions, meeting-attendance commits, partner-club audit commits, normalized outcomes, and consequential audit writes crash-atomic within organization-scoped server-only RPC transactions.
- The atomic reconciliation database contract is covered by 47 focused assertions for direct client denial, cross-organization rejection, explicit actor/reason/correlation provenance, same-snapshot idempotency, and rollback when the final audit write is forced to fail.
- A clean isolated replay applied 185 migrations and passed 1,075 pgTAP assertions.
- Standalone private routes evaluate granular CSF permission before canonical redirect. A restricted officer therefore receives an explicit permission-denied state on the requested route without loading private markers. A member still receives a marker-free 404. Theme bootstrap now runs from client instrumentation before hydration; no executable React-tree script or not-found replay warning remains.
- Current-term actions use the stored `is_current` flag. A date-derived active lifecycle label does not hide **Set as current** when the authoritative flag is false.
- The shared date-only formatter preserves `YYYY-MM-DD` calendar values without a UTC conversion, preventing a Pacific-time one-day shift.
- In the namespaced synthetic organization, Classes of 2026–2030 are present. Fall 2026 is current with official dates August 13 through December 18, 2026. Policy version 1 records $5 dues, 7 required points, a 3-point per-activity maximum, a 2-point drive cap, one allowed absence, and point carryover disabled. One fictional application deadline is planned for September 4, 2026 at 11:59 PM PDT.
- The synthetic values above were created locally and are not production chapter records. Semester policy editing now writes a separate officer draft; operational application, point, meeting, report, and closeout readers continue to use only the published policy. Publishing and discarding require explicit confirmation and immutable provenance.
- Outside volunteering is an explicit versioned policy field. It defaults to disabled, appears in the draft and published-policy summaries, and is enforced by the point-submission authorization boundary. Outside-volunteering proof is always required when the published policy permits that source.
- Semester close now freezes one revision of explicit completed/incomplete outcomes. Adviser reopen requires a reason and correlation identifier, restores the prior membership state from immutable snapshots, and a later reclose creates a new revision instead of rewriting history.
- The deterministic fixture provisions fictional organization-admin, applicant, approved-member, adviser, every distinct officer permission template, two Co-President seats, and five Activity Coordinator seats. The Playwright role-navigation matrix passed 14/14 scenarios, including phone navigation and direct-URL boundaries.
- Google Picker loading and recovery states are explicit. The control stays busy through selection and metadata verification; reconnect is reserved for authentication failures, while configuration, transient, missing, inaccessible, and trashed-file failures expose accurate next actions.
- The CSF-specific plugin suite passed 187 tests and 1,250 assertions. The full plugin unit gate passed 253 tests with 0 failures and 1,614 expectations. The ordinary browser suite passed 23 tests with 3 capture-only tests skipped and 0 failures. After footer-branding and partner-club fixture sanitation, the dedicated gallery recapture passed all 3 tests under `20260716-final-gallery`.
- `bun run csf:test:workflows` passed locally. Its public-route subcheck skipped because no app server was running; structural public privacy is covered separately by the green browser suite.
- Google consent, account chooser, Picker, reconnect/revocation handling, and real Drive imports were not executed. Role navigation and direct-URL denial were exercised, but no complete visible mutation lifecycle was run. No Slides were created. No remote database, Drive file, Gmail mailbox, Classroom, website, Instagram account, or officer-maintained Sheet was mutated.

### 21.9 July 16 regression closure and remaining boundary

- Theme initializes before hydration from client instrumentation, and Vercel Speed Insights renders only on Vercel (`V68`, `V80`).
- Mixed-grade application rows retain immutable cohort/term targets; source types, selected tab/range provenance, and central commit readiness are enforced in UI and server code (`V69`, `V71`, `V72`, `V78`).
- Members may claim only current published submission-based activities; meeting time is shown in Pacific time; a requested point correction atomically resubmits the same claim with history preserved (`V70`, `V75`, `V76`).
- Home no longer leaves empty grid tracks, and phone navigation keeps primary destinations discoverable without adding a second desktop navigation layer (`V73`, `V77`).
- Application list/detail share one effective eligibility result, one concise blocking issue, and one compact sticky action bar (`V74`, `V79`).
- Mobile and desktop footers share product-company branding, and repeatable fixture upsert plus gallery capture reject real external contact identities (`V81`, `V82`).
- Direct proof probes now declare a valid complete finalized or pending upload lifecycle instead of relying on a stale schema default (`V83`).
- These closures prove deterministic local contracts and read-only browser acceptance. They do not prove live Google behavior, a complete browser mutation lifecycle, remote deployment, or the Slides suite gated by `T35`.

---

## 22. Confirmed data-integrity amendment — July 21, 2026

This amendment records the contracts verified after the July 16 browser baseline. It does not upgrade the live Google, remote-development, full browser-mutation, accessibility, or Slides acceptance status.

### 22.1 Account claim and connection resolution (superseded by Amendment 5)

- A reusable cohort link now performs candidate discovery through `csf_profile_claim_candidate`. It requires the authenticated account's confirmed email and returns a candidate only when that email identifies exactly one active profile in the same organization.
- Candidate data is intentionally limited to the student's name, cohort label, term label, and compact membership context. The applicant cannot search or enumerate the roster.
- The confirmation UI uses the functional prompt **We found your CSF record — is this you?** and a short-lived signed claim token bound to the organization, link, profile, user, and verified email.
- `csf_confirm_profile_claim` atomically activates host membership without downgrading an existing admin or staff role, verifies the profile-account link, activates cohort membership, activates an accepted term membership when present, records the resolved request, and writes correlated immutable history.
- **Not me**, missing matches, ambiguous matches, and conflicting existing links do not guess. They create or retain officer-review work without exposing another profile.
- `csf_resolve_profile_link_request` permits only organization administrators or staff with `manage_profiles`, requires an explicit reason before any identity lookup, and locks the pending request. A connection requires the account's current confirmed email to match the request snapshot and exactly one active roster profile, plus exact first/last name and exactly one matching active cohort. Request-declared email fields and even a unique exact name are review context only. The transition records a non-PII evidence snapshot with its immutable history.
- Claim, decline, and manual connection resolution accept only reusable profile-connect or combined links. An application-only link cannot be repurposed to expose or connect a profile.
- A signed claim must match the link's cohort. A manual request for an existing verified account must already have the matching active cohort membership and no conflicting active cohort; it cannot self-assign a class by submitting a different grade.
- Accepted applications are locked and must belong to the requested cohort before a term membership can be activated. This serializes account connection with application decisions instead of trusting stale browser state.
- An exact semantic retry revalidates the current profile link, organization membership, single cohort, and correlated audit evidence before returning the original receipt. A changed target, actor, rationale, revoked link, or conflicting cohort is refused rather than returning stale success and must enter the audited correction workflow.
- Focused database coverage passes 26 assertions for exact-match privacy, conflicts, transaction behavior, tenant boundaries, and server-only execution. Signed-token and UI-boundary tests are included in the private plugin suite.

### 22.2 Purpose-bound Google authorization

- Google OAuth state version 2 is HMAC-signed and binds the signed-in user, nonce cookie, organization, `dvhs-csf` plugin, connection purpose, requested CSF import capability, normalized return route, issue time, and five-minute expiry.
- CSF imports recognize the granular capabilities `import_applications`, `import_members`, `import_meetings`, and `import_partner_clubs`.
- The connect route checks active organization membership, plugin availability, and the requested capability before redirecting to Google. The callback performs the same authorization check again before exchanging or storing credentials.
- The callback verifies that the required `drive.file` scope was actually granted and stores the purpose/capability binding with the encrypted connection. The one-time nonce cookie is consumed on success and failure.
- Every stored connection is bound to the exact organization, plugin, purpose, and capability that authorized it. Token lookup, refresh, source reads, and disconnect reauthorize that same binding instead of falling back to another organization or capability.
- The one-time migration may classify a defensible legacy connection, but runtime roles cannot create an unbound token. Any legacy row that cannot be bound safely is marked for reconnect.
- Disconnect removes only the requested binding. Remote token revocation occurs only when no other active binding still depends on that Google credential.
- These route, state, authorization, and capability-wiring contracts are locally tested. Google account choice, consent, Picker, token refresh, revocation, inaccessible-file behavior, and the visible confirmation that the connected identity is `dvhighcsf@gmail.com` remain external acceptance work.

### 22.3 Strict historical import values

- Migration `20260721095945_dvhs_csf_strict_class_history_points.sql` retains the earlier class-history function under a revoked internal name and exposes a server-only compatibility wrapper.
- The wrapper rejects a non-array activity payload, non-object entries, missing or blank point fields, nonnumeric values, non-finite values, zero or negative values, and values above 100.
- No missing or malformed historical activity becomes a one-point award. Officers must reconcile the source value or omit the row from commit.
- The strict wrapper passes 9 focused database assertions; the existing class-history import contract continues to pass its 35 assertions.

### 22.4 Transactional semester close

- Semester readiness now includes unresolved import rows alongside applications, point submissions, appeals, attendance, and dues.
- Readiness produces a SHA-256 evidence hash over the current term, published policy, active memberships, verified credits, attendance, dues, applications, point work, and import rows.
- `csf_close_term_v2` requires `close_term`, locks the term and all relevant operational records, checks the published policy version and reviewed hash, and rejects a stale preflight or any remaining blocker.
- Membership completion is derived inside the transaction from the published policy, normalized verified credits, drive and per-activity caps, attendance, allowed absences, and explicit overrides. The browser does not submit outcome decisions.
- Closure, per-member outcomes, final membership states, term state, revision, evidence hash, correlation identifier, and audit history commit together. A later close after an adviser reopen creates a new revision rather than rewriting the previous result.
- The closure evidence revision and hash are stored as immutable evidence. Organization-scoped composite foreign keys protect consequential relationships from cross-tenant references.
- Focused transactional-close coverage passes 19 database assertions, including stale evidence, import blockers, server-only execution, permission denial, and derived outcomes.

### 22.5 Seed and local replay safety

- `supabase/seed.sql` is intentionally non-executable. Fictional local development data lives only in `supabase/seeds/local-only.sql` and uses reserved `.test` identities.
- `scripts/check-supabase-seed-safety.mjs` is wired into the production build and CI. It rejects unexpected seed paths, executable canonical seed content, unsafe configuration, real-looking email or phone values, OAuth/bearer material, reusable join/invitation values, and hosted Supabase URLs.
- The seed-safety scanner and its 9 focused tests pass locally. This prevents a new tracked seed leak; it does not remove sensitive material from earlier Git history or rotate any credential that may previously have been exposed.
- The earlier July disposable isolated replay applied 190 migrations, discovered 57 CSF tables, ran 43 pgTAP files, and passed 1,279 database assertions. The shared local stack was not reused for that historical replay; only fictional data was loaded.
- The private CSF plugin suite passes 272 tests with no failures; focused lint, root typecheck, `csf:test:workflows`, and the final post-hardening production build pass.

### 22.6 Remaining release boundary

The following are still required before the full lifecycle may be called complete:

1. Merge the private-plugin update through its development boundary, update PR #96, and obtain green CI, GitGuardian, and Vercel checks without changing `main` or production.
2. Obtain explicit cost confirmation before creating the persistent Supabase `development` branch, then apply migrations and fictional seed data there. Production remains read-only.
3. Complete Google console callback/origin configuration with action-time confirmation, connect the application as `dvhighcsf@gmail.com`, and exercise consent, Picker, refresh, reconnect, revoked-consent, inaccessible-file, 403, and 429 states.
4. Run the temporary private-tenant Drive import and aggregate reconciliation without capturing or committing real student rows.
5. Complete the synthetic visible mutation lifecycle for signup, staff assignments, invitations, claims, applications, points, meetings, partner clubs, close/reopen, reports, and public response privacy.
6. Complete the keyboard/focus/screen-reader pass. The production build, complete CSF browser suite, and shared plugin-isolation gate pass.
7. Produce and visually verify the three native Google Slides decks only after the final sanitized workflow screenshots are stable.

Until those items pass, the July 21 result is a verified local data-contract and partial browser milestone—not a live Google or cloud-development acceptance.

---

## 23. Final local verification amendment — July 22, 2026

This amendment updates the verification status after the final combined local run. It supersedes earlier local test counts and build-status statements, but it does not change the product contracts or upgrade any external, unexecuted, or manual acceptance scope.

### 23.1 Verified local baseline

- The latest namespaced isolated replay applied 214 migrations, discovered 82 CSF tables, ran 63 pgTAP files, and passed all 3,165 assertions. It used a dedicated Let’s Assist project identity, ports, containers, volumes, and network. It did not access, stop, reset, inspect, or reuse the Vela stack, and it did not target a remote Supabase project.
- The database acceptance includes concurrent and retry behavior rather than only single-session happy paths: signed and manual profile connection retries revalidate current membership and cohort state; application rows are locked before term activation; organization-scoped tenant foreign keys validate; the legacy close path is revoked; closure evidence hashes are immutable; nine evidence-write guards pass; and a real `dblink` two-session close-vs-insert race passes.
- The latest focused Bun verification passes 73/73 tests with 761 expectations. Root typecheck is clean, and focused ESLint is clean.
- The post-hardening private-plugin isolation browser/API smoke passes. The plugin registry now statically imports the required private submodule; it cannot silently return an empty registry when a dynamic `require` fallback fails.
- The targeted role-navigation matrix passes 14/14. The historical final full CSF Playwright run passed 26 scenarios, explicitly skipped 3 Google-dependent scenarios, and had 0 failures in 2.3 minutes; its generated report is intentionally not retained.
- The isolation smoke signs in as the seeded DV organization administrator and allows a 30-second cold-compile deadline. Fixture reset preserves profiles referenced by immutable audit history and is repeatable.
- Project-feed requests are canceled when navigation makes them obsolete. Expected aborts are ignored, while genuine fetch failures still surface. Permission-denial assertions target the single alert instead of matching duplicate page copy.
- Google connections now persist the exact organization, plugin, purpose, and capability authorized by OAuth. Every token use and refresh reauthorizes that binding. Unbound legacy connections require reconnect instead of receiving a guessed capability.
- Signed claims and officer-created link requests accept only profile-connect/combined links, enforce the requested cohort, reject cross-cohort accepted applications, and cannot self-assign a class to an existing verified account. Stale success retries are downgraded to officer review when the linked account or cohort is no longer valid.
- Term close remains one transaction over locked operational evidence. The server derives outcomes from the published policy, stores the closure revision/evidence hash, and rejects stale close attempts.
- Reports are generated as a permission-checked local ZIP containing formula-safe CSV files and a manifest. This release has no Google report-write destination.
- The latest production build passes with Next.js 16.3.0, clean TypeScript, 80 generated static pages, and sitemap generation.
- Root typecheck passes on the latest delta.
- Lint completes with 0 errors and 0 warnings.
- The private-plugin unit suite passes 272 tests.
- The final compiled-runtime isolated Playwright run passes 40 behavioral scenarios with 0 failures. Its 3 opt-in screenshot-capture scenarios are intentionally skipped because capture is a separate workflow; that separate gallery capture passes 3/3 and produces the 22 reviewed images.
- That browser run first exposed PostgREST relationship ambiguity introduced by the new composite foreign keys on onboarding/cohort relations. Private-plugin commit `7f12388` fixes the affected queries with explicit constraint embeds and adds a regression guard. The rerun is green.
- The only server output during the green run is the Next.js diagnostic `Unexpected root span type AppRender.fetch`; no application exception was emitted.
- Exact profile claim and explicit decline pass in the browser. Navigation and direct-route authorization pass for every officer permission template, plus applicant and member boundaries.
- Login testing no longer races hydration: the form exposes an explicit hydrated-ready marker, and automation waits for it before submission.
- Local Supabase environment resolution accepts safely isolated loopback endpoints on arbitrary ports while still rejecting a hosted/non-local development target.

The current curated visual evidence is [`evidence/20260806-post-cleanup/index.html`](evidence/20260806-post-cleanup/index.html). It contains 22 fictional screenshots plus sanitized summaries. This curated gallery is distinct from generated Playwright output, which is ignored and not retained. The compiled behavioral run passed 40 scenarios and intentionally skipped only the 3 opt-in gallery captures; live-Google acceptance remains a separate external gate. Raw traces, videos, network payloads, cookies, and storage state are not part of the curated gallery.

### 23.2 Acceptance that remains open

The following must not be described as completed:

1. **Live Google authorization and import.** No live Google OAuth consent, account choice, Picker selection, token refresh, reconnect/revocation, Drive read, or real Drive import was performed. The external OAuth client still needs explicit authorization for JavaScript origin `http://localhost:3001` and redirect `http://localhost:3001/api/calendar/google/callback`. The product must then visibly confirm `dvhighcsf@gmail.com` before any private source is selected.
2. **Cloud development database.** The persistent Supabase `development` branch has not been created. It requires explicit approval of the ongoing `$0.01344/hour` cost before provisioning.
3. **Green PR and CI.** `PRIVATE_SUBMODULE_TOKEN` is missing from CI. GitGuardian flags the removed literal local-only Supabase replay password in commit `f66202c`; it is not a hosted credential, but the authenticated incident still requires a false-positive disposition or an explicitly approved history rewrite. The Vercel development Preview cannot be diagnosed with the currently authenticated CLI/Chrome identities and has not passed against an isolated non-production Supabase branch.
4. **Complete visible mutation lifecycle.** The post-hardening isolation smoke and 40-scenario CSF browser suite are green, but the entire visible signup, staff assignment, invitation, officer connection resolution, application decision, activity, point/proof/appeal, meeting, partner-club, semester close/reopen, report, and public-boundary mutation sequence has not been completed as one contiguous lifecycle.
5. **Accessibility acceptance.** Responsive light/dark screenshots exist, but the full keyboard, focus, and screen-reader pass remains open.
6. **Native Google Slides.** No final Officer Operations, Member Quick Start, or Admin/Data Operations deck has been created or visually accepted.
7. **Development Preview acceptance.** A local production build is not a substitute for the branch-scoped Vercel Preview, its non-production Supabase invariant, or required remote checks.

The 3 final Playwright skips are intentional external Google consent/configuration gates, not product failures. No Google file, Sheet, report destination, or Gmail message was written. No paid Supabase branch was created. Production Supabase, production Vercel, `main`, and the existing DVHS CSF organization were not mutated. Vela was not accessed or used as infrastructure for this work.

Until these gates close, the product is a verified local implementation and browser-boundary milestone, not a completed chapter cutover or cloud-development release.

---

## 24. Lifecycle-truth implementation amendment — August 9, 2026

This amendment records the repository implementation associated with v1.3. It does not supersede the verified July/August baseline counts above until the full isolated replay, combined private/root gates, production build, and fresh browser lifecycle have been rerun against this exact combined tree.

### 24.1 Implemented contract changes under combined verification

- Profile merge and officer account connection now compute hard conflicts server-side and require corroborating identity evidence. Merge preview also owns the complete current reference catalog, every profile-key uniqueness rule (including active point claims, active staff assignments, and open point appeals), immutable-history classification, and exact live-reference rewrite plan. A settled successful or terminally skipped sheet-import target keeps both its match and frozen target on the source tombstone; only an unfrozen, not-started match moves. Any frozen/retryable/in-flight/unknown target blocks through the same preview execution rechecks under the organization identity lock. Consequential identity mutations share one organization-first lock hierarchy, and merge success requires a zero-unintended-live-source proof. The UI treats suggestions as search aids and directs officers to the audited correction workflow when email/cohort/account evidence conflicts.
- Application queue, detail, confirmation, and database decision paths share current academic/check readiness. Ordinary approval refuses missing, failed, stale, or internally contradictory evidence.
- Reusable class links and student-specific secure links use stable client request identifiers. A student-specific link accepts only one current unique email on the selected active profile, records link readiness rather than fabricated send telemetry, and revalidates the profile/email/link state before replaying success.
- Semester policy editing exposes and persists the six operative List I/II/III × A/B grade-point values while preserving valid advanced keys. Application calculation normalizes plus/minus grades to the base letter.
- Import reconciliation requires a visible officer reason for match and skip, preserves input on failure, and resets only on confirmed success. Import history projects only recorded run/preview facts, abbreviated digests, decisions, reasons, actors when available, and retry/preview ancestry.
- Post create/update/pin/archive now enters one service-only, permission-rechecked, replay-safe database mutation that commits the post and request receipt atomically. Optional email queueing remains a separately reported outcome. Class campaigns freeze the exact same-organization cohort before recipient/content finalization.
- Every point begin/proof/withdraw/review/appeal boundary revalidates current actor, term, membership, published policy, source, cap, and proof authority under lock as applicable.
- The CSF Google callback requires provider-verified identity for the exact approved chapter account. Connection health exposes the account; disconnect preserves reviewed records/provenance and distinguishes local cleanup, confirmed remote revocation, shared grants, and partial failure.
- CSF-owned communications settings expose consent/provider-topic configuration and durable recovery queues. Unknown outcomes require provider evidence; quarantined webhook triage writes an acknowledgement receipt without applying, retrying, suppressing, or rewriting the event.
- Member Feed/Stream payloads omit officer delivery lifecycle fields unless post authority is re-derived for the request. Posting roles reach the composer through **Classes → Stream**; students use **Feed**.

### 24.2 Deliberately open boundary

- The combined forward migration ledger and all pgTAP files must pass from a fresh isolated database after every concurrent lane lands. The profile-reference catalog, frozen import-target state matrix, production-shaped successful merge, point-state agreement matrix, and real dblink edit/claim lock-order suites are authored but unexecuted until that gate. Focused green or source tests are supporting evidence, not a substitute for the replay.
- The complete synthetic visible lifecycle and new sanitized delta screenshot pack remain open. They must cover signup/claim, direct links, connection/merge conflict, application decisions, imports/history, policy grades, point lifecycle, class posts/email partial outcomes, communications recovery, Google states without live mutation, close/reopen, reports, role denials, and accessibility.
- No Development/Preview or Production deployment, live Google read/write, Resend send, real student source, or officer-maintained Sheet mutation is authorized by this amendment.
- Scheduled post persistence is not publication evidence. The publisher implementation and repository scheduler are accepted, but officers use the manual path in any environment that lacks exact opt-in, successful hosted invocation, and visible schedule → Feed evidence. No queued email may be attributed to a future schedule.
- CLEAN-016 is closed by the Production Vercel Pro recurrence, repeated runtime starts, an authenticated `enabled: true` dispatcher response, and an unchanged empty delivery ledger. This proves the bounded communications worker is invoked without proving provider delivery or a fixed delivery time. The separate scheduled-post publisher remains disabled in Production, so scheduled publication stays open under CLEAN-015 and officers continue to use the manual path.
