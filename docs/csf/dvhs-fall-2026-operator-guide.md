# DVHS CSF Fall 2026 operator guide

This is the click-by-click handoff for setting up and operating the DVHigh CSF
organization. It is intentionally narrower than the full [officer
runbook](officer-runbook.md): use this page when adding people, connecting their
Let's Assist accounts, assigning officer positions, or reconciling the Fall
2026 source files.

## Environment and stop rules

- Rehearse at `https://dev.lets-assist.com/organization/dvhighcsf`. Development
  uses a separate database. Automated fixtures must use only reserved synthetic
  identities. A preview may read a real chapter Sheet and persist a bounded
  server-side preview job or snapshot, but it must not commit chapter rows to
  Development.
- Production is `https://lets-assist.com/organization/dvhighcsf`. Do not copy
  Development fixtures, links, or test decisions into Production.
- The approved Google identity is exactly `dvhighcsf@gmail.com`. Stop at the
  Google chooser if another identity is selected.
- A Google preview does not write to the source Sheet or commit imported rows.
  It may persist the bounded preview job and immutable source snapshot needed
  for review. Committing an import, connecting an account, deciding an
  application, publishing policy, assigning staff access, or sending email is
  a separate reviewed action.
- Never paste a roster, connection token, transcript, receipt, or student row
  into chat, tickets, screenshots, tests, or repository files.

## Before you start

Do all of this once, in order, before the first student record exists. Stages
1–3 of [onboarding a new chapter](new-chapter-onboarding.md) own the general
procedure; this is the DVHS path through them.

1. **Find or create the organization.** First open
   `/organization/dvhighcsf` on the environment you are working in. If it does
   not exist, sign in as the accepted trusted member who will own setup; the
   route states that only Trusted Members can create organizations. Open
   **Organizations**, select **Create Organization**, and confirm the form route
   is `/organization/create`. Under **Basic Information**, enter
   **Organization Name** = `DVHigh CSF`, **Username** = `dvhighcsf`, the required
   **Description** using only reviewed public chapter wording, **Website** =
   `https://www.dvhighcsf.org`, and the required **Organization Type** selected
   from the reviewed chapter classification. **Upload Logo** is optional; do not
   invent a description, type, or private contact value. After the username
   availability check succeeds, select **Create Organization**. The creator is
   inserted as the organization `admin`, and the successful form opens
   `/organization/dvhighcsf`.
2. **Entitle the plugin** (platform super admin — onboarding Stage 1). Open
   `/admin/plugins`. Under **Catalog** → **Catalog source of truth**, confirm
   **DVHS CSF** has plugin key `dvhs-csf`, is **Active**, and its **Latest
   version** matches the shipped manifest. Then open **Access** →
   **Organization access** and set **Organization** = `DVHigh CSF`, **Plugin** =
   `DVHS CSF`,
   and **Status** = **Active**. Leave **Starts at (optional)** and **Ends at
   (optional)** blank for the reviewed open window, leave **Force plugin for
   organization (managed install)** off unless that separate behavior was
   authorized, and select **Save entitlement**.
3. **Install the plugin** (organization admin — onboarding Stage 2). Open
   `/organization/dvhighcsf/settings#organization-plugins`, find **Organization
   Plugins**, and select **Open plugin marketplace**. Under **Available to
   install**, find **DVHS CSF** and select **Install**. In **Install DVHS CSF?**,
   review **This plugin requests access to:**, check **I approve installing this
   plugin and grant the requested access.**, and select **Install Plugin**.
   After installing, verify that the seeded roles list and point categories are
   populated. If either is empty the install hook failed and was compensated:
   check `plugin_audit_logs` instead of continuing, and never hand-seed the
   missing rows.
4. **Create the graduating classes** (onboarding Stage 3). Open **Classes →
   Semesters & setup** and select **Set up graduating class**. In **Set up a
   graduating class**, enter the required **Graduation year** and optional
   **Display name**, then select **Create class and semesters**. Do this once
   each for 2027, 2028, 2029, and 2030. Each class setup creates all eight
   semester records automatically, freshman fall through senior spring; do not
   add those terms individually. **Add one semester** is only for restoring a
   genuinely missing record or creating an approved exceptional record. On that
   exceptional form, leave **Current semester** unchecked unless the term is
   meant to replace the current term immediately.
5. **Make Fall 2026 current.** On the Fall 2026 term, open **Term actions** and
   select **Set as current**. Exactly one semester is current at a time.
6. **Prepare Spring 2027 and Fall 2027 without making either current.** Under
   each applicable class, open **View semester history**: prepare **Spring
   2027** (`S27`) for Classes of 2027–2030 and **Fall 2027** (`F27`) for Classes
   of 2028–2030. On each applicable row, open **Term actions → Edit term**.
   Enter only approved values in **Term label**, **Start date**, **End date**,
   **Applications open**, **Applications close**, **Sheet tab**, and **Status**,
   then select **Save term**. Application dates must be both entered or both
   blank. The dates and application window are shared semester values; the
   Sheet tab and status belong to that class-semester row. Preparation does not
   make the future term current: do not select **Set as current** for `S27` or
   `F27` during Fall 2026 setup.

Steps 4 and 5 are prerequisites, not preferences:

- In **Add a student record**, the **Class** field reads _No active classes
  configured_ and **Add student record** stays disabled until an active class
  exists.
- **Class link** is disabled with _Create an active class and open semester
  before making a reusable class link_ until both exist.
- **Student link** is disabled with _Create an open semester before making a
  student-specific link_ until a semester is open.

## Add one student

1. Open the DVHigh CSF organization and select **Members**.
2. Select **Add member** at the top of the page. The dialog is titled **Add a
   student record**.
3. Under **Student details**, enter the exact **First name** and **Last name**.
   Fill **Middle name**, **Preferred name**, or **Nicknames** only when the
   chapter source supports them.
4. Under **Contact and class**, enter the current **School email**, **Personal
   email**, or both. Do not substitute an officer's email.
5. Choose **Class** — Class of 2027, 2028, 2029, or 2030.
6. Select **Add student record** and wait for **Student record created.**
7. Confirm the row appears in **Members → Directory** with the correct class.

This creates the permanent CSF student record and nothing else. It does not
create a Let's Assist login, it does not connect an existing account, and it
does not make the student a current-semester member — semester membership comes
from an application or an audited semester correction. The dialog says this
itself under **Account access comes next**: after saving, go to **Members →
Account connections** and either issue a **Student link** for one person or copy
the reusable class link. Connecting an account is the separate, reviewed action
described in the next three sections.

### Choose exactly one of the three connection paths

1. **Candidate claim — exact record found:** the signed-in student follows the
   reviewed reusable class link and sees **We found your CSF record — is this
   you?**. After checking the displayed name and class, they select **Yes,
   connect this record** only when both are exact; otherwise they select **Not
   me**. Declining creates a review request and does not connect the account.
2. **Direct student-specific invitation:** the student opens the private link
   created for their one record, signs in with the exact verified address held
   on that record, and selects **Accept invitation**. This path does not show the
   reusable-link candidate confirmation.
3. **No automatic match — reusable class link:** when no exact candidate is
   available, the student selects **Add profile details**, enters only the
   requested identity details, and selects **Find my record**. The request then
   waits in **Matches to review** for officer review when required; it does not
   let the student choose or connect a roster row.

The lower generic **Use this profile** control belongs to a different card for
an already-selected organization profile. It is not the candidate confirmation
and must never be described as a substitute for **Yes, connect this record**.

Officers still provision access through one of two link controls: **Student link
→ Create a student-specific link → Create secure link → Copy link** for one
known record, or **Class link → Create a reusable class link → Create class link
→ Copy link** for class rollout. Use **Renew link** only to invalidate an old
student token, **Cancel** to stop one without replacement, and **Deactivate**
before replacing the one active class/semester reusable link.

Similarity is never a fourth connection path. Any request that cannot satisfy
the exact account/profile evidence enters **Matches to review**, where
**Connect account** is available only after the database recomputes canonical
evidence; otherwise use **Reject request** or correct the student record first.

## Give that student a private account-connection link

1. From **Members**, select **Account connections**.
2. Select **Student link**. The dialog is titled **Create a student-specific
   link**.
3. Under **Unconnected student record**, choose the student. Records with a
   verified account, and records without a unique current school or personal
   email, are excluded from this list by design.
4. Under **Email on this student record**, choose one of the recorded
   school/personal addresses the product offers. The address cannot be typed
   arbitrarily.
5. Choose **Semester** = Fall 2026 and confirm **Expires in days** (default
   `14`, range 1–90). Leave **Internal label** as derived unless the chapter has
   a reason to change it; it is officer-only.
6. Select **Create secure link** and wait for **Student-specific link is
   ready.**
7. In **Student-specific links**, select **Copy link** and share it through an
   approved chapter channel. Creating or copying the link sends no email.

The copied value must be an absolute HTTPS URL on the current environment, for
example `https://dev.lets-assist.com/...` during rehearsal. Use **Renew link**
only when the old token must stop working; use **Cancel** to invalidate it.
**Open link in new tab** is an officer convenience, not the student test — see
[Test every link signed out](#test-every-link-signed-out).

If the row's badge reads **Recorded email changed**, the student record no
longer carries that exact address on an active profile. **Copy link** and
**Renew link** are withdrawn and only **Cancel** remains: correct the student
record through the audited member-correction workflow first, then issue a new
link.

## Give a whole class its reusable join link

1. Open **Members → Account connections**.
2. Select **Class link**. The dialog is titled **Create a reusable class link**.
3. Choose **Class** and **Semester** = Fall 2026. **Link name** derives from
   both and is officer-facing only.
4. Leave **Application form (optional)** blank unless the reviewed Fall 2026
   form URL is ready. Add a **Student note** only when the chapter has approved
   the wording.
5. Select **Create class link** and wait for **Reusable class link created.**
6. Under **Reusable class links**, select **Copy link** for that class.
7. Repeat once for Classes of 2027, 2028, 2029, and 2030.

One class may hold only one active reusable link per semester; a second create
is refused rather than silently duplicated. Use **Deactivate** on the existing
link before replacing it.

Use the reusable class link for ordinary rollout. Use a student-specific link
when one known record needs a bounded recovery path. Neither action emails the
student.

## Find a record when it is not in the list

Both pickers on **Account connections** are one bounded server page, not the
whole roster. When the record you need is not listed:

1. Under **Student record search**, type a name or recorded email and select
   **Search records**. **Clear** returns to the unfiltered page.
2. Read the count line under the form. It states how many records match, how
   many are available on this result page, and separately how many are eligible
   in the student-specific link picker.
3. Use **First results** / **More results** to page the resolution list, and
   **First student records** / **More student records** to page the
   student-specific link picker. They are separate pages of the same search.

An empty picker is disambiguated in the message: _no student record matching
your search on this page_, _none of this page is eligible_, or _no unconnected
student record has a unique current email_. Only the last means the record must
be corrected before a link is possible.

## Test every link signed out

The page says it directly: _Test copied links while signed out or in a private
browser window. An officer's signed-in session is not the student onboarding
journey._

Before publishing any link, paste the copied URL into a signed-out or private
window and confirm it renders the student's first screen. **Open link in new
tab** reuses your officer session, so it proves the URL resolves and nothing
about the student's path. Never complete a claim on a student's behalf.

## What the student does

1. Open the reviewed class or student-specific link in a signed-out/private
   browser window.
2. Create a Let's Assist account or sign in using the exact verified email on
   the CSF record.
3. Follow the one path the page presents: **Yes, connect this record** / **Not
   me** for an exact candidate, **Accept invitation** for a direct
   student-specific invitation, or **Add profile details → Find my record** when
   no automatic match exists.
4. If the last path creates a request, wait for an officer decision; do not
   submit another profile or try to choose a roster record.

The student never chooses a roster record from a list and never assigns their
own class or officer access.

## Resolve the account review queue

1. Open **Members → Account connections**. Requests waiting on a decision are
   counted in the header and listed under **Matches to review**.
2. Select **Resolve** on the request, or **Review in Resolve** on one of its
   ranked suggestions. The dialog is titled **Review account connection**.
   Everything under **Suggestions · advisory only** is a discovery aid: a
   suggestion badged **Canonical evidence ready** still has to be checked, and
   one badged **Review only** never authorizes a connection.
3. Choose the **Student record**. The dialog then states either **Canonical
   identity evidence** — confirmed account address matches the roster address,
   exact first and last name, exactly one active membership matching the
   requested class — or **Connection unavailable** with the specific blockers.
4. Enter a **Decision reason** naming the exact evidence you checked, or why the
   request must be rejected. At least 4 characters are required.
5. Select **Connect account**. This control is rendered only when the database
   confirms canonical evidence for the selected record; if it is absent, that is
   the answer. Otherwise select **Reject request**, or correct the student
   record through the audited member-correction workflow and start again.
6. Return to **Members** and confirm the row says **Connected**.

If suggestions cannot be loaded, the request stays open for rejection and
**Connect account** is withheld until canonical evidence can be read again.

## Make a connected person an officer

1. Confirm the person's member row says **Connected**. An unconnected record
   cannot receive staff access.
2. Open **More → Staff access**.
3. If the needed seat does not exist, use **Position seats → Add position**.
   The dialog is **Add CSF position**: set the public title, the responsibility
   shown to staff, the seat limit, and the **Access** checkboxes. **Add
   position** is a create form and shows no capability diff; the diff belongs to
   editing (see below).
4. Select **Assign position**. The dialog is titled **Assign staff access**.
   The trigger is disabled while nothing can be assigned, and the line beneath
   it names which: _Connect a member's verified account first in Members →
   Account connections_, or _Add an active position under Position seats before
   assigning access_.
5. Fill **CSF member profile** (search by name or email; only connected members
   appear — an empty result reads _No connected members match that search_),
   **Position**, **School year**, and optionally **Public title override**,
   **Effective from**, **Effective through**, and **Notes**.
6. Select **Assign access**, wait for **Staff access assigned.**, and confirm
   the row appears in **Officer roster**.

To change what an existing position can do, open **Position seats → Manage** on
that position. Editing shows **Capability changes to save**, which lists
**Capabilities to grant** and **Capabilities to remove** for the current
checkbox selection. That panel describes only the request this form would send —
it states so itself — and the server decides the result after you save.

The seeded chapter positions are CSF Owner, Adviser, Co-President, Vice
President (Membership/Publicity/Clubs), Treasurer, Secretary, Web Master,
Activity Coordinator, and Data Management. Grant the narrowest position the
person actually needs.

### Recovery access cannot be removed

The chapter must always keep at least one account able to reach **Staff
access**. Recovery access is the **Staff access** capability (`manage_roles`) on
an unarchived position, held by a real account through an active, currently
effective assignment — not a role name, so a chapter that moved the capability
onto a custom position is recoverable through that position.

Two paths are refused by the database, not merely hidden in the interface:

- **Revoke** on the last such assignment fails with _This is the last active
  position that can still manage CSF staff access. Give another active position
  the Staff access capability, or assign someone to a position that already has
  it, before ending this one._
- **Manage** on the last such position fails when you clear its **Staff access**
  capability, with _This change would leave no active position able to manage
  CSF staff access. Keep the Staff access capability on at least one position
  that has a currently effective active assignment._

Grant the replacement seat first, confirm it is effective today — a future
**Effective from** does not count — and only then end the old one.

## Import the reviewed Fall 2026 starting records

Use this source order:

1. Preview, reconcile, and—only in the authorized Production cutover—commit the
   primary `CSF Application - Spring 2026 (Responses)` application seed first.
   Choose **Applications** as the **Record type**. Its grade and semester values
   establish the initial class targets. Do not first load a class-history sheet
   as **Student roster** to manufacture a competing primary identity source.
2. Only after that application seed is reviewed, process the historical
   Classes of 2027–2030 sheets as **Historical records**. Reconcile every
   overlap against the primary application result; never let a historical row
   silently replace newer application identity or class evidence.

Each source keeps its own immutable preview. **Preview**, **Reconcile**, and
**Commit** are separate boundaries; a clean preview neither imports rows nor
authorizes a commit.

### Connect Google first — and connect it yourself

1. Open **More → Imports**.
2. Under **Google Sheets connection**, read the badge: **Connected**, **Not
   connected**, **Reconnect required**, or **Checking access**. The approved
   account is named on the panel.
3. Select **Connect** (or **Switch or reconnect** when the badge says so;
   **Switch account** when already connected), sign in to Google as exactly
   `dvhighcsf@gmail.com`, and approve the requested Drive access.
4. Return to Imports and confirm the badge reads **Connected** before choosing
   any file. **Recheck** re-reads current access.

**The connection is stored against the Let's Assist account that completed it.**
It is not a chapter-wide switch: an officer who has not completed this
connection themselves sees **Not connected** on the same page — or **Reconnect
required** if they hold an older, unbound Google connection — even when a
colleague is connected. Nobody can complete this authorization on another operator's behalf —
the person who will run the import must be signed in to Let's Assist as
themselves, press **Connect**, and choose the chapter account at Google's own
chooser. If Google offers only a personal account, stop at the chooser; a wrong
account produces **Reconnect required** with _This is not the approved chapter
account_, and the product refuses to select files until it is corrected.

### Build and reconcile the preview

The **Import progress** strip (Source → Scope → Map → Preview → Reconcile →
Commit → Result) is a read-only reflection of recorded state. It is not a wizard
and has no controls; you cannot click a stage, and a reload or a second officer
sees the same position. The work happens in these sections:

1. Open **New Google Sheets import** (titled **Start another import** once a
   preview exists).
2. Choose **Record type**: **Student roster**, **Applications**, or **Historical
   records**. Use **Historical records** for the prior-semester class workbooks.
3. Select the spreadsheet through the Google picker.
4. Set **Graduating class** and **Semester**, then **Sheet tab**. For
   **Applications** the class is not chosen here — the panel states _Resolved
   for each row from grade and semester_.
5. Under **Source range**, set **Header row** (`1` for the class workbooks) and
   the bounded **A1 range**.
6. Select **Inspect columns**. This reads only the header and up to three
   following rows; it does not read the import range and imports nothing. The
   result names the workbook and tab, the selected range, the inspected range,
   the sample row count, and the column count, and badges either **Headers
   ready** or a header-issue count.
7. Complete **Column mapping**. Mappings are stored by column position, so
   duplicate header names stay distinct.
8. Select **Preview normalized rows**. Previewing does not import anything.

The preview header carries four counts — **Rows**, **Ready**, **Existing**,
**Needs review** — plus a **Normalized snapshot** block with the normalized row
count, abbreviated snapshot and source digests, a not-retained field count, and
badges for hidden, filtered, or formula-only rows. Record a reason for every
manual match (**Use match**) and every **Skip row**.

**Normalized rows** below it shows one page at a time. Page it with **First
rows**, **Previous rows**, and **Next rows**. Read the line those controls
carry: _Counts and import readiness describe the whole preview, not this page._
Never treat the visible page as the reconciliation total, and never conclude a
preview is clean because the page you are on looks clean.

### Commit

Commit only after an officer confirms the whole preview against both the class
workbook and the Spring 2026 application responses.

The commit control names what it is about to do: **Verify source and commit** on
a first commit, **Resume import** when an earlier commit of this preview stopped
part-way, **Finish import** when nothing is left to write, and **Committed**
afterwards. It stays disabled while the preview is not sealed, while rows still
need a decision, while **Import blocked** names a blocker, while **Recovery
needed** rows are undecided, or while another officer holds the commit. A
resumed commit does not write committed rows twice.

On Development, stop after the reviewed preview and reconciliation evidence.
Commit real chapter rows only in Production after the release gates below pass;
never copy the Development fixture rows or connection links forward.

### Privacy-safe source totals verified 2026-08-11

| Graduating class | Historical source  | Exact bounded range |             Rows after header |
| ---------------- | ------------------ | ------------------- | ----------------------------: |
| 2027             | `c/o 2027` → `S26` | `A1:O168`           |                           167 |
| 2028             | `c/o 2028` → `S26` | `A1:O168`           |                           167 |
| 2029             | `c/o 2029` → `S26` | `A1:N89`            |                            88 |
| 2030             | `c/o 2030` → `F26` | `A1:O1`             | 0; header only, do not import |

The three non-empty class sheets contain 422 unique names with no exact
cross-class overlap. They do not contain reliable account emails, so they are
historical evidence—not sufficient account-connection evidence by themselves.

The Spring 2026 application source is `CSF Application - Spring 2026
(Responses)` → `Form Responses 1`, bounded range `A1:Q518`: 517 response rows,
516 unique emails/names, and one duplicate response. Its grade distribution is
90 grade 9, 176 grade 10, 166 grade 11, and 85 grade 12.

Exact-name reconciliation before any commit currently produces:

| Fall 2026 class | Application-only | Class-sheet-only | Exact overlap |
| --------------- | ---------------: | ---------------: | ------------: |
| 2027            |                5 |                6 |           161 |
| 2028            |               11 |                3 |           164 |
| 2029            |                2 |                0 |            88 |

These differences are a review queue, not errors to auto-resolve. Grade 12
responses belong to the graduated Class of 2026 and must not be placed in an
active Fall 2026 class.

## Set up Fall 2026 policy only from approved chapter facts

Every date, point requirement, dues rule, and deadline on this page is an
adviser decision. An officer records it; an officer does not choose it. Nothing
in this guide, in the public site, or in a prior semester authorizes a value.

1. Open **Classes → Semesters & setup → Fall 2026**.
2. Add the real application window, deadlines, and required meetings. Enter both
   application dates or leave both blank; before a semester opens both are
   required and the closing date must follow the opening date.
3. Open **Policy** and enter the reviewed academic/dues/service rules. A draft
   saved by an officer governs nothing — the surface says _Draft saved; awaiting
   an adviser or organization admin._ An adviser or organization admin completes
   **Publish policy**, which requires a **Publication reason** and an explicit
   typed confirmation. Points recorded under a missing published policy are
   refused by design.
4. Do not copy Spring 2026 dates or point rules into Fall 2026 without adviser
   approval. `dvhighcsf.org` currently says only that applications will reopen
   in Fall; it does not publish the Fall 2026 dates.

Where the chapter's own sources disagree, the adviser resolves the conflict and
that resolution is recorded — see below. Do not resolve one by inference, and do
not turn historical Spring 2026 text into a Fall 2026 rule.

### Public-site conflicts to resolve before publishing

The public site is useful supporting evidence, but it is not the Fall 2026
policy source of truth. A read-only review on 2026-08-11 found all of the
following; an adviser must resolve them before the values or links are entered
in Let's Assist:

- **Membership** says Spring 2026 requires seven activity points, while its
  penalty section later refers to reaching a two-point requirement. Do not
  choose either value by inference.
- The **CSF Activities** and **Tutoring** links on the Membership page currently
  open Squarespace not-found pages. Do not publish them as member resources
  until their destinations are corrected.
- The home page refers to the 2026-2027 officer team, while the **Officers**
  page is still headed 2025-2026. Confirm the current roster before assigning
  Fall 2026 staff seats.
- The **Clubs** page contains an apparent duplicate or spelling variant in the
  Spring 2026 list. Reconcile clubs against the reviewed audit and returning-
  club sources instead of importing the rendered page as a clean master list.

Record the adviser's approved resolution in the semester policy or source
review evidence. Do not silently "fix" historical Spring 2026 text by turning
it into a Fall 2026 rule.

## Applications

1. Open **Applications → Review queue** for unresolved work. Use **All
   applications** for search and decision history; neither view changes an
   application.
2. Open the application and review identity/source, academic evidence,
   transcript and receipt access, **Application checks**, dues, notes, and
   **Application history**. Dues evidence and academic eligibility are separate
   facts.
3. Read **Decision preflight**. It is the latest loaded state, not an
   authorization token: the server reloads and rechecks the same evidence when
   the decision is saved. If the action bar says **Approval blocked**, resolve
   the named blocker or record an allowed adviser override through its
   dedicated control; do not work around it by creating membership.
4. Select **Record decision** and enter **Review notes**. **Request changes**
   returns the application for correction, **Approve application** creates or
   updates semester membership atomically, and **Reject** records a final
   application decision. Approval does not mark semester requirements complete.
5. If the result says **Decision already saved; reload required** or **Decision
   request conflict; reload required**, select **Reload application** before
   doing anything else. A missing response never authorizes a second manual
   write.
6. After saving, confirm **Decision record**, its reason, and **Term
   membership**. Withdrawals and adviser overrides require their own current
   evidence and recorded reason; never infer either from the imported response.

## Service activities and points

1. Open **Activities** and use its creation control. Enter the reviewed term,
   audience, date, location, signup mode, point type/value/cap, and proof rule.
   Use **Save draft** while incomplete; draft activities remain officer-only.
2. Review the saved details and member-facing signup/proof consequence. Select
   **Publish activity** only when the record is complete. A row reading
   **Published** is publication evidence; a saved draft is not.
3. Open **Point submissions**. Select **Review**, inspect the activity or club,
   claimed number, source relationship, and proof, then enter **Awarded points**
   and **Review notes**. Use **Request changes**, **Reject**, or **Approve
   award** according to the evidence. Review notes are required for rejection,
   requested changes, and an adjusted award.
4. Confirm the result in **CSF point awards** and in the student's **My CSF**
   view. After **Request changes**, the member uses **Update and resubmit**; an
   appeal is a separate decision. Neither rewrites the original submission or
   award history.

Every mutation rechecks the acting account, active membership, current open
term, published policy, source relationship, cap, class, and finalized proof.
If any changed, reload and resolve the current blocker.

## Posts

1. Open **Classes**, choose the class, then **Stream**. A class audience targets
   only that cohort; members read published results in **Feed**.
2. In the composer choose **Save as draft**, **Publish now**, or—only when the
   authenticated publisher is available—**Schedule for later**. The final
   button reads **Post saved**, **Publish post**, or **Schedule post** for that
   choice.
3. Interpret post persistence before the separate email result. **Post saved;
   email not queued** means the post is durable even though email work was not
   created. **Post saved; email status unknown** requires administrator review;
   it does not authorize recreating the post.
4. **Also send this as an email** requests a separate queue action for the
   reviewed term, audience, class, content, consent topic, and recipient
   snapshot. Read **Email queued**, **Email not queued**, or **Email queue status
   unknown** literally. Queued still does not mean sent or delivered.
5. Scheduled posts never queue email. Use **Publish now** until the target
   environment has an accepted enabled schedule → **Feed** transition.

## Communications and email

1. Open **More → Communications**.
2. Use its three sections: **Campaigns** for drafts and exact audience
   snapshots, **Delivery issues** for unknown/quarantined provider outcomes, and
   **Settings** for the reviewed consent configuration.
3. **Settings** stores exactly two values per audience — **Consent topic key**
   and **Resend topic id**. An established consent key is locked, because
   existing opt-outs are stored under that exact key; changing one takes a
   dedicated audited migration. A missing pair keeps broadcast queueing disabled
   for that audience rather than guessing a scope.
4. In **Campaigns**, create and review a draft, then select **Finalize content**.
   That freezes content and still queues nothing. Select **Snapshot audience**
   to record canonical included/excluded totals. Only after reviewing that
   snapshot select **Finalize & queue**.
5. Read the campaign's **Delivery** panel as three separate facts: its status,
   the **Recipient ledger** counts, and the **Provider attempts** counts.

Queued is not sent, and sent is not delivered:

- A saved draft contacts nobody.
- **Finalize & queue** says what it does in its own confirmation: it closes the
  audience, creates the durable delivery ledger, and queues one attempt per
  included recipient — _This action does not call the email provider._
- A queued ledger row is therefore not evidence that an email left the system,
  and never evidence that one arrived. Only a signature-verified provider
  outcome is delivery evidence.
- The dispatch schedule requests a run every ten minutes but observed hosted
  starts are irregular. Never promise a delivery time.

Before the first real send, verify the sender domain, stored consent topic,
Resend topic id, an exact one-recipient test snapshot, signed webhook ingestion,
and the final delivered/bounced outcome — each as its own piece of evidence.

## Development versus Production

They are separate deployments over separate databases, and nothing crosses
between them:

|                          | Development                                          | Production                                       |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| URL                      | `https://dev.lets-assist.com/organization/dvhighcsf` | `https://lets-assist.com/organization/dvhighcsf` |
| Branch                   | `development`                                        | `main`                                           |
| Database                 | separate Supabase Development branch                 | Production                                       |
| Records                  | synthetic data plus bounded preview artifacts        | real chapter records                             |
| Real chapter Sheets      | read-only source; preview artifacts may persist      | commit only after the release gates pass         |
| Links, tokens, decisions | rehearsal artifacts; never carried forward           | issued fresh                                     |

A Development rehearsal proves the procedure, not the release. A green
Development result is not Production readiness, and this guide does not claim
Production readiness for any surface: Production's communications webhook is
still disabled, no chapter roster has been committed anywhere, and the release
gates in [testing and release](testing-and-release.md) are open. Do not copy a
Development fixture, connection link, import preview, or policy decision into
Production, and do not treat a Development screenshot as Production evidence.

At this guide's current evidence point, the repository has 281 migrations
through `20260813011000`, the Development database has 273 through
`20260812152300`, and Production has 236 through `20260811001500`. The
Development Vercel alias still serves earlier code built from the 272-migration
tree because the external 100-deployment-per-day project cap blocked its
refresh. Neither database parity nor exact-current-code hosted evidence exists.

## Development rehearsal state at this guide's verification point

- DVHigh CSF exists at `dev.lets-assist.com`, the DVHS CSF plugin is installed,
  Classes of 2027–2030 exist, and Fall 2026 is current.
- Two Development-only student records, two student-specific links, and one
  reusable combined link per class are present. One record uses the reserved
  synthetic identity; no real chapter roster import has been committed.
- The copied student link was verified as an absolute
  `https://dev.lets-assist.com/...` URL.
- Members renders **Account connections** as its own view. Each ready link
  offers **Copy link** and **Open link in new tab**, and the view closes with an
  explicit instruction to test copied links while signed out or in a private
  window. Staff access explains why **Assign position** is disabled when no
  verified account exists and links directly back to that view.
- Help, Members, Staff access, Imports, and the three-section Communications
  workspace were clicked through on the deployed Development build. Help is
  filtered by exact position capabilities rather than broad route access.
- Google OAuth and Picker are connected. The real Spring 2026 application
  workbook bounded `A1:Q518` was inspected and mapped. The saved source passed
  the metadata RPC and appended 85 stored preview rows.
- Preview failed while sealing because the caller summary wrongly stated the
  reserved derived `rows` key. The run left one failed preview job; zero term
  applications were committed. No names or email addresses are recorded in
  this guide; real-source evidence remains aggregate-only.
- `dev.lets-assist.com` still serves exact SHA
  `cf330e5faa844d63a2f41c8f0be4d1c727d51a47`. That deployment is Ready but
  stale: its repository tree ended at 272 through
  `20260812132725_csf_drive_metadata_compare_and_set_fence`, and the external
  Vercel 100-deployment-per-day project cap prevented a refreshed deployment.
- This repository has 281 ordered migrations through
  `20260813011000_close_csf_representative_and_publication_races`; Hosted
  Development Supabase remains at 273 through
  `20260812152300_atomic_csf_post_replies`. The six newest `development`
  migrations — `20260812161500_atomic_project_signup_rejection`,
  `20260812185500_atomic_staff_invite_issuer_redemption`,
  `20260812193400_protect_staff_invite_issuer_capability`,
  `20260812203000_make_content_reports_server_written`,
  `20260812203500_close_plugin_data_browser_default_acl`, and
  `20260813010000_atomic_ai_quota_receipts` — plus
  `20260812225436_recheck_csf_activity_partner_authorization_under_lock` and
  `20260813011000_close_csf_representative_and_publication_races` are not
  applied to any hosted database.
- The exact local isolated union replay passed all 131 pgTAP files and 5,485
  assertions against 281 migrations. This local result does not establish
  hosted acceptance.
- The `20260813011000` repair remains ordered after #174 and #158 and does not
  restate either dependency's definitions.
- Pull requests #152, #174, and #179 are merged in current `development`; #158
  and #175 remain open with later or interleaving migrations. The 281-row pin
  is provisional, and the last migration pull request to merge must recompute
  the count, head, and exact tail from the merged tree.
- The 95 INFO / 0 WARN / 0 ERROR security and 611 INFO / 0 WARN / 0 ERROR
  performance advisor counts were captured on the preceding 272-migration
  Development shape. They have not been re-established for either hosted 273 or
  repository 281 and are not current-parity evidence.
- The seven-argument metadata RPC exists, the old four-argument overload is
  absent, and only `service_role` can execute the current RPC; `anon` and
  `authenticated` cannot. The Drive metadata RPC is no longer the Preview
  blocker.
- The caller-summary correction and inactive-access hardening are combined in
  private development commit `605342c`, and this root worktree's gitlink points
  to that exact commit locally. The stale Ready Development SHA above does not
  include that local gitlink update.
- Fall 2026 application dates, deadlines, meetings, and published policy are
  not yet recorded. No staff position has been assigned.
- Three controlled Development test messages produced three signature-verified
  `sent` events and three signature-verified `delivered` events with no webhook
  quarantine rows. The checked-in GitHub dispatcher has repeated successful
  hosted runs, but its actual start intervals are irregular and provide no fixed
  delivery-time promise. No broad chapter campaign has been sent. Production's
  webhook remains disabled and must be rotated and proved during release.
- The scheduled-post transition, hold recovery, authenticated route, and
  repository-owned GitHub scheduler are implemented. Development's branch-
  scoped publisher opt-in is present on the exact Ready deployment, and a
  visible synthetic composer schedule/readback/archive lifecycle passed with
  no email option. An enabled publisher invocation and visible schedule → Feed
  publication are still required before officers rely on automatic release.
- Production was not changed by this rehearsal.

## Production cutover checklist

Do not use real chapter rows or credentials until every item is checked:

- [ ] Obtain separate Production authorization; keep `development` and
      Production databases, links, tokens, previews, and decisions isolated.
- [ ] Verify the root tree is the approved exact commit and the private plugin
      remains a clean gitlink at its approved SHA.
- [ ] Run the read-only
      `scripts/production-cutover-preflight.sql` with the reviewed Production
      read-only URL. It must select the exact 236-row baseline, pass every
      shared blocker, and name any cancellation-job transitions for explicit
      review. Rehearse the full 45-migration transition on a Production-shaped
      clone and verify the backup restore before scheduling the window.
- [ ] At T-0 enable maintenance mode, stop writers and scheduled workers, take
      the final snapshots, and pair the schema push with the exact compatible
      application deployment. A partial or divergent ledger is a stop.
- [ ] Replay the ordered migration ledger through `20260813011000` in the
      authorized release gate and prove exact repository/Production ledger parity,
      advisors, function ACLs, relation ACLs, storage posture, and active-member
      storage authorization.
- [ ] Re-run the preflight on the 281-row target and require the shared tenant
      and receipt checks plus the target-only relation, constraint, and index
      and extension-posture checks to pass before reopening writes.
- [ ] Pass the final combined static, focused source, database, private-plugin,
      and browser gates; complete keyboard, focus, and screen-reader acceptance.
- [ ] Confirm the super-admin entitlement and organization-admin install,
      Classes of 2027–2030 with eight semesters each, Fall 2026 current, future-term
      setup, officer seats, and published policy.
- [ ] Complete live `dvhighcsf@gmail.com` OAuth, Picker, preview, reconnect,
      revocation, and failure-state checks without committing during rehearsal.
- [ ] Test every class and student-specific link while signed out or in a
      private window; complete existing-account claim and officer-review paths.
- [ ] Commit the Spring 2026 application seed before historical class sheets,
      reconcile counts and identity conflicts, then accept applications,
      service/points, posts, Communications, and role-aware Help journeys.
- [ ] Verify sender domain, consent topics, one-recipient delivery, signed
      webhook reduction, unknown-outcome handling, and Production scheduled-post
      publication without claiming a fixed delivery time.
- [ ] Record the exact cutover evidence and remaining limitations. Never copy a
      Development fixture, connection link, import preview, or policy decision into
      Production.

## Related references

- [Onboarding a new chapter](new-chapter-onboarding.md)
- [Officer runbook](officer-runbook.md)
- [Source data semantics](source-data.md)
- [Testing and release evidence](testing-and-release.md)
