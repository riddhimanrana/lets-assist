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
   `/admin/plugins`. On **Plugin details**, confirm **DVHS CSF** has **Plugin
   key** `dvhs-csf`, has **Active in catalog** set, and shows a **Latest
   version** matching the shipped manifest. Then open **Organization access**
   and set **Organization** = `DVHigh CSF`, **Plugin** = `DVHS CSF`, and
   **Status** = **Active**. Leave **Starts at** and **Ends at** blank for the
   reviewed open window, leave **Platform controlled** off unless that separate
   behavior was authorized, and select **Save access**. **Force install** is a
   different operation and lives on **Advanced**; entitling never needs it.
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
4. **Create the graduating classes** (onboarding Stage 3). Open **Classes**
   and select **Add a class**. In **Set up a graduating class**, enter the
   required **Graduation year** and optional **Display name**, then select
   **Create class and semesters**. Do this once
   each for 2027, 2028, 2029, and 2030. Each class setup creates all eight
   semester records automatically, freshman fall through senior spring; do not
   add those terms individually. **Add one semester** (behind **Class
   administration** on the Terms page) is only for restoring a
   genuinely missing record or creating an approved exceptional record. On that
   exceptional form, leave **Current semester** unchecked unless the term is
   meant to replace the current term immediately. This creates the Class of
   2030 cohort shell, not student records; populate that class through the new
   application cycle using the explicit profile and application-resolution
   sequence below.
5. **Make Fall 2026 current.** On the Fall 2026 term, open **Term actions** and
   select **Set as current**. Exactly one semester is current at a time.
6. **Prepare Spring 2027 and Fall 2027 without making either current.** Under
   each applicable class, open **View semester history**: prepare **Spring
   2027** (`S27`) for Classes of 2027–2030 and **Fall 2027** (`F27`) for Classes
   of 2028–2030. On each applicable row, open **Term actions → Edit term**.
   Enter only approved values in **Term label**, **Start date**, **End date**,
   **Applications open**, **Applications close**, **Application form link**,
   **Sheet tab**, and **Status**, then select **Save term**. Application dates
   must be both entered or both blank. **Application form link** holds the
   semester's reviewed Google Forms application URL; the public class page shows
   it as the apply button only while that semester is current and inside its
   application window, and a blank value hides the button. The dates,
   application window, and form link are shared semester values; the Sheet tab
   and status belong to that class-semester row. Preparation does not
   make the future term current: do not select **Set as current** for `S27` or
   `F27` during Fall 2026 setup.

Steps 4 and 5 are prerequisites, not preferences:

- In **Add a student record**, the **Class** field reads _No active classes
  configured_ and **Add student record** stays disabled until an active class
  exists.
- **Invite students** lives on each class page, so no class join code can exist
  before its graduating class does. A class without a code shows _This class
  does not have an active code yet._ and offers **Create code**.

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
itself under **Account access comes next**: after saving, share the class's
permanent join code from **Invite students** on the class page. Connecting an
account is the separate, reviewed action described in the next sections.

## Share the class join code

The class join code is the one student connection path. Each graduating class
holds one permanent 6-character code — letters and digits only; the characters
O, I, 0, and 1 never appear. The code connects a verified account to the
graduating class and nothing more: it never activates membership for any
semester.

1. Open **Classes**, choose the class, and select **Invite students**. The
   dialog shows the active code with **Copy**.
2. If the dialog reads _This class does not have an active code yet._, select
   **Create code**. Use **Regenerate code** only when the old code must stop
   working — the replaced code is refused immediately — and **Disable code** to
   withdraw the code without a replacement.
3. Share only the code, or its `/connect/<code>` URL on the current
   environment, through an approved chapter channel. Viewing, copying,
   regenerating, or disabling a code sends no email, so the product never shows
   a sent time or resend count for it.
4. Repeat once for Classes of 2027, 2028, 2029, and 2030.

Before publishing a code, open its `/connect/<code>` URL in a signed-out or
private browser window and confirm it renders the student's first screen. An
officer's signed-in session is not the student onboarding journey; never
complete a connection on a student's behalf. A mistyped, disabled, or replaced
code renders **This class join code is unavailable** with instructions to ask
an officer for the current code.

## What the student does

1. Open `/connect/<code>` from the shared code, or open the connect page —
   headed **Student record connection** — and type the code under **Class join
   code**. The field states the format itself: _6 letters and numbers; codes
   never use O, I, 0, or 1_.
2. Create a Let's Assist account or sign in. The signed-out entry page is
   headed **Join or connect to CSF** and names both audiences: **Already have a
   CSF record?** for returning members, and **You are new to CSF**, which
   carries the semester's application button when the current term has an
   **Application form link**.
3. Select **Add profile details**. The dialog is titled **Find your CSF
   record**: the student enters only the requested identity details under
   **Student information** and selects **Find my record**.
4. The server connects on exactly one automatic signal — the account's
   verified email. One active record in the code's class carrying that email
   connects atomically with recorded history; no matching record creates a new
   stable profile in that class from the verified account identity; a
   conflicting account, a conflicting class assignment, or several records
   sharing the email creates a request in that class's **Needs attention**
   queue and connects nothing.

The student never chooses a roster record from a list and never assigns their
own class or officer access. Submitted names are review context for officers;
they are never an automatic matching signal.

## Resolve the connection queue

Requests that could not connect automatically wait on the class's own
**Members** tab, not in an organization-wide view. **Home** shows a
**Connection requests** chip with the total pending count; it opens the classes
hub.

For Classes of 2027–2029, the historical class sheets do not supply reliable
account emails. Establish a current, unique school or personal email from the
approved current application cycle or another reviewed current source, recorded
through the audited member-correction workflow, before expecting either an
automatic email match or officer **Connect account** evidence. Without it, a
returning student's join cannot find the historical record and creates a
separate new profile that must later be merged through the audited workflow.
Never backfill an address from the Spring 2026 comparison workbook merely to
make a match.

1. Open **Classes**, choose the class, then **Members**. Requests wait under
   **Needs attention** — _Class-code joins waiting for an officer decision_ —
   one bounded page at a time, paged with **First page** and **Next**.
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
6. Return to the class **Members** tab and confirm the request left **Needs
   attention** and the student's roster row shows the connected account.

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
   Unlinked accounts_, or _Add an active position under Position seats before
   assigning access_.
5. Fill **Person** using **Search members and organization accounts**. Verified
   CSF members and active organization accounts are eligible; an empty result
   reads _No eligible account matches that search._ Then choose **Position** and
   optionally fill **Public title override**, **Effective from**, **Effective
   through**, and **Notes**. The selected roster school year is applied
   automatically.
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

Import the approved Class of 2027, Class of 2028, and Class of 2029 workbooks
as **Historical records**, one class at a time. After selecting a workbook, run
semester-tab discovery. Review every populated canonical semester tab that
discovery returns, confirm its inferred semester and bounded range, and give
each tab its own immutable preview before commit. Do not assume `S26` is the
only historical tab. A populated canonical tab is a blocker when its semester
has not been configured for that class; configure the missing semester, then
inspect and preview again. Header-only or template tabs are not import targets.

Class of 2026 is out of scope. Do not select, preview, reconcile, or import its
rows. Skip the template-only Class of 2030 workbook; create Class of 2030
student records through the new application cycle sequence below instead. Do
not use the Spring 2026 application response workbook as a Fall 2026 roster
seed.

Each discovered populated tab keeps its own immutable preview. **Preview**,
**Reconcile**, and **Commit** are separate boundaries; a clean preview neither
imports rows nor authorizes a commit. Choose **Historical records**, never
**Student roster** or **Applications**, as the **Record type** for these sheets.

### Connect Google first — and connect it yourself

1. Open **More → Imports**.
2. Under **Google Drive connection**, read the badge: **Connected**, **Not
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
4. For a historical class workbook, run semester-tab discovery and review every
   populated canonical tab it returns. Confirm the **Graduating class**,
   inferred **Semester**, **Sheet tab**, and bounded range for each preview. For
   **Applications** the class is not chosen here; the panel states _Resolved
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
never copy the Development fixture rows or class join codes forward.

### Privacy-safe Spring 2026 reference totals verified 2026-08-11

These `S26` totals are reconciliation references, not the complete historical
import scope. Discovery determines the populated canonical tabs that must be
reviewed for each approved workbook.

| Graduating class | Historical source  | Exact bounded range | Rows after header |
| ---------------- | ------------------ | ------------------- | ----------------: |
| 2027             | `c/o 2027` → `S26` | `A1:O168`           |               167 |
| 2028             | `c/o 2028` → `S26` | `A1:O168`           |               167 |
| 2029             | `c/o 2029` → `S26` | `A1:N89`            |                88 |

The three non-empty class sheets contain 422 unique names with no exact
cross-class overlap. They do not contain reliable account emails, so they are
historical evidence, not account-connection evidence. Account connections
require current canonical evidence: the signed-in account's confirmed address,
an exact name, and one matching active class, revalidated by the server.

For historical comparison only, the Spring 2026 application source is `CSF
Application - Spring 2026 (Responses)` → `Form Responses 1`, bounded range
`A1:Q518`: 517 response rows, 516 unique emails/names, and one duplicate
response. Its grade distribution is 90 grade 9, 176 grade 10, 166 grade 11, and
85 grade 12. These aggregates help explain reconciliation differences; they do
not expand the import scope or authorize an account connection.

The historical exact-name comparison currently produces:

| Fall 2026 class | Application-only | Class-sheet-only | Exact overlap |
| --------------- | ---------------: | ---------------: | ------------: |
| 2027            |                5 |                6 |           161 |
| 2028            |               11 |                3 |           164 |
| 2029            |                2 |                0 |            88 |

These differences require historical reconciliation, not automatic identity
resolution. Class of 2026 remains out of scope, and the Class of 2030 template
remains unimported.

## Create and resolve Class of 2030 from the new application cycle

An application response never creates a student profile, and an application
decision never creates one. The central application import refuses a row with
no reviewed profile target. Never select, preview, or import the Class of 2030
workbook. Use the current application form and this sequence:

1. Record the reviewed new application form URL in the current term's
   **Application form link** (**Term actions → Edit term**); the public class
   page then offers it while the application window is open. A student submits
   that current form before an officer creates or resolves platform records.
2. Open **More → Imports**, choose **Applications**, select the exact current
   response file, tab, and bounded range, complete the mapping, and select
   **Preview normalized rows**. Preview persists source evidence but creates no
   profile, application, term membership, or account connection.
3. A row without a reviewed profile is held for reconciliation. Open **Members
   → Add member**, use **Add a student record**, enter the exact reviewed name
   and current unique school/personal email, choose **Class** = Class of 2030,
   and select **Add student record**. Wait for **Student record created.** If a
   current profile already exists, review it instead of creating a duplicate.
4. The staff profile action records a replay-safe `profile.create` audit receipt
   and places the permanent profile in the selected class. It does not create
   the imported application, term membership, or account connection. The audit
   receipt identifies the staff write; it does not replace the source-row
   evidence.
5. Return to the application preview. Select the profile under **Match to
   member**, enter a 4–500 character **Match reason** naming the corroborating
   current evidence, and select **Use match**. Profile creation and import-row
   reconciliation are two separate audited actions: reconciliation records the
   selected target, actor, reason, and immutable source-row history. Name
   similarity alone is not evidence.
6. Resolve or explicitly skip every row, then select **Verify source and
   commit**. A targetless application row cannot be committed. Commit attaches
   the application to the reviewed profile with source provenance; it does not
   decide the application or create term membership.
7. Open **Applications → Review queue**, complete the required checks and dues
   review, and use **Record decision**. **Approve application** creates or
   updates term membership atomically with the application decision and
   history. Approving the application creates or updates term membership; it
   does not create the profile.
8. Connect the account separately through the class join code's exact
   verified-email match or the reasoned officer-review path. Neither profile
   creation nor application processing silently connects an account.

## Set up Fall 2026 policy only from approved chapter facts

Every date, point requirement, dues rule, and deadline on this page is an
adviser decision. An officer records it; an officer does not choose it. Nothing
in this guide, in the public site, or in a prior semester authorizes a value.

1. Open **More → Terms** and choose **Fall 2026** in the term selector. The
   page shows the term's dates, its **Deadlines**, and its **Meeting
   schedule**; **Start next term** and **Close term** are the lifecycle
   actions, and closing shows the **Semester close preflight** inside its
   own dialog.
2. Add the real application window, deadlines, and required meetings. Enter both
   application dates or leave both blank; before a semester opens both are
   required and the closing date must follow the opening date.
3. Expand **Chapter rules** and enter the reviewed academic/dues/service rules
   under **Edit chapter rules**. A draft
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
2. Open the application and review the applicant identity, **Courses as
   imported**, **Reported point totals**, **Transcript**, and **Webstore
   receipt**. Dues evidence and academic eligibility remain separate facts.
3. Use **Reject** only with a recorded reason, or **Approve** after the evidence
   is complete. Approval creates or updates semester membership atomically; it
   does not mark semester requirements complete.
4. If a response is lost or rejected, reload the application before retrying.
   A missing response never authorizes a second manual write.

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

## Partner clubs

1. Open **Service → Partner clubs**. The term dropdown is chronological with
   the current term selected by default; the directory shows only that term's
   club records.
2. Use **Add club** to create a canonical club, or open a row's detail dialog
   to edit it, approve/suspend/expire its term standing, or archive/restore
   the club. Standing changes are explicit; a prior semester's standing is
   never overwritten.
3. Clubs apply and renew through the existing Google Form. Upload the response
   export with **Import form responses**. Rows preview immutably; apply each
   row as a draft — which creates a not-reviewed club record for the term — or
   skip it. This is a local export upload, not a Drive read.
4. The club's spreadsheet link is reference only. It points at the club's own
   spreadsheet, owned by the club and never read by the product.
5. A member point claim against a partner club requires only active standing
   for the current term. Vet point types, caps, and proof manually during
   point approval against the published semester policy; there is no per-club
   point policy, member-Sheet import, or partner representative access.

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
3. **Communications settings** shows only the officer-safe state for each
   audience: **Ready** or **Needs provider setup**. Use **Check communications
   setup** to ask the platform to provision and validate the audience boundary.
   Provider identifiers remain in platform-admin diagnostics. A degraded or
   incomplete setup keeps broadcast queueing disabled rather than guessing a
   scope.
4. In **Campaigns**, start with **New email** and save the draft, then select
   **Finalize content**. That freezes content and still queues nothing. Select
   **Review recipients** to record canonical included/excluded totals. Only
   after reviewing that count select **Queue for sending**.
5. Read the campaign's **Delivery** panel as three separate facts: its status,
   the **Recipient ledger** counts, and the **Provider attempts** counts.

Queued is not sent, and sent is not delivered:

- A saved draft contacts nobody.
- **Queue for sending** says what it does in its own confirmation: it closes
  the audience, creates the durable delivery ledger, and queues one attempt per
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
| Codes, tokens, decisions | rehearsal artifacts; never carried forward           | issued fresh                                     |

A Development rehearsal proves the procedure, not the release. A green
Development result is not Production readiness, and this guide does not claim
Production readiness for any surface: Production's communications webhook is
still disabled, no chapter roster has been committed anywhere, and the release
gates in [testing and release](testing-and-release.md) are open. Do not copy a
Development fixture, class join code, import preview, or policy decision into
Production, and do not treat a Development screenshot as Production evidence.

At this guide's current evidence point, the repository has 292 migrations
through `20260815100500`; the Development database remains at 273 through
`20260812152300`; and Production has 236 through `20260811001500`. The nineteen
repository-only migrations have not been applied or deployed in hosted Development.
The Development Vercel alias still serves earlier code built from the
272-migration tree because the external 100-deployment-per-day project cap
blocked its refresh. Neither the database nor hosted code gate is current for
the 292-migration repository tree.

## Development rehearsal state at this guide's verification point

- DVHigh CSF exists at `dev.lets-assist.com`, the DVHS CSF plugin is installed,
  Classes of 2027–2030 exist, and Fall 2026 is current.
- Two Development-only student records are present. One uses the reserved
  synthetic identity; no real chapter roster import has been committed.
- The rehearsal artifacts recorded for the retired link-based onboarding
  system are superseded: student connection now goes through each class page's
  **Invite students** join code, the `/connect/<code>` route, and the class
  **Members** tab's **Needs attention** queue. Staff access explains why
  **Assign position** is disabled when no verified account exists and links
  back to the members view.
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
- Hosted Development Supabase remains at 273 ordered migrations through
  `20260812152300_atomic_csf_post_replies`; this repository has 292 through
  `20260815100500_dvhs_csf_application_queue_projection`. The nineteen
  repository-only migrations are
  `20260812161500_atomic_project_signup_rejection`,
  `20260812185500_atomic_staff_invite_issuer_redemption`,
  `20260812193329_google_cap_replay_safety`,
  `20260812193400_protect_staff_invite_issuer_capability`,
  `20260812203000_make_content_reports_server_written`,
  `20260812203500_close_plugin_data_browser_default_acl`,
  `20260812220000_csf_meeting_permission_followups`,
  `20260813010000_atomic_ai_quota_receipts`,
  `20260813012206_google_cap_effect_fencing`,
  `20260813013000_reconcile_project_lifecycle_boundaries`,
  `20260813013100_lock_project_lifecycle_transactions`,
  `20260813013200_recheck_csf_activity_partner_authorization_under_lock`,
  `20260813013300_close_csf_representative_and_publication_races`,
  `20260813020000_cancellation_preserves_unknown_delivery_outcomes`,
  `20260813085442_harden_private_is_plugin_enabled_acl`,
  `20260813091801_harden_dv_private_policy_helper_acls`,
  `20260814001123_csf_import_lineage_transport_settlement`,
  `20260814051720_csf_post_mutation_outcome_recovery`, and
  `20260815100500_dvhs_csf_application_queue_projection`; they have not been
  applied or deployed to any hosted database.
- The `20260813013200` migration preserves the seven activity/partner-club
  under-lock authorization rechecks. `20260813013300` extends that boundary to
  representative assignment and revocation and serializes activity publication
  against term closure with the shared advisory and term row locks.
- `20260813020000` preserves ambiguous delivery evidence during cancellation,
  recomputes current ambiguous-delivery and unexpired processing-lease counts
  under the campaign lock, and keeps later provider reconciliation possible.
- `20260813091801` removes inherited `PUBLIC` execution from the fixed-path DV
  student and household policy helpers. Their 20 current RLS callers are all
  `authenticated`, so only `authenticated` and owner `postgres` retain
  execution; `anon` and `service_role` do not.
- `20260814001123` closes the central import lock inversion by applying the
  identity-first order to begin and commit, removes the caller-selected
  six-argument failure overload, and leaves only a service-role five-argument
  settlement that can record an unknown transport outcome.
- `20260814051720` adds the service-only
  `plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)` resolver: it
  rechecks `manage_posts` before and after the same per-request advisory lock
  and reports only whether the caller's own post-mutation receipt committed.
- The current exact local isolated union replay passed all 292 migrations and
  142 pgTAP files with 5,785 assertions and 84 CSF tables present. It is local
  evidence only and is not hosted acceptance.
- Pull requests #152, #158, #174, #177, #179, and #181 are merged in current
  `development`; #180 remains open with a later migration. The 292-row pin is
  provisional, and the last migration pull request to merge must recompute the
  count, head, and exact tail from the merged tree.
- The 95 INFO / 0 WARN / 0 ERROR security and 611 INFO / 0 WARN / 0 ERROR
  performance advisor counts were captured on the preceding 272-migration
  Development shape. They have not been re-established for either hosted 273 or
  repository 292 and are not current-parity evidence.
- The seven-argument metadata RPC exists, the old four-argument overload is
  absent, and only `service_role` can execute the current RPC; `anon` and
  `authenticated` cannot. The Drive metadata RPC is no longer the Preview
  blocker.
- Superseded August 13 gitlink snapshot, retained verbatim for lineage: "The
  current root gitlink is `cdbeb59e6cc086e8794ec8b35157ab043f65c01c`. The
  locally known private `origin/development` still ends at
  `605342ca8a3f2d83c4a7b40abf60ba03b9f12b5b`, so the current target is not
  contained there and remains a local-only, private-first release blocker."
  That snapshot no longer describes this tree.
- The private-first merge has since been published: the locally known private
  `origin/development` and the staged root gitlink are both
  `c33b9c2ac7f084d14daad5df999d5eda3a2c2ac1` (`c33b9c2`), which contains
  `cdbeb59e`, the meeting hardening, and the `ca817bf` preview-summary
  correction. The target is published and contained, and the strict submodule
  publication gate passes. The stale Ready Development SHA above does not
  include this gitlink.
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
      review. Rehearse the full 57-migration transition on a Production-shaped
      clone and verify the backup restore before scheduling the window.
- [ ] At T-0 enable maintenance mode, stop writers and scheduled workers, take
      the final snapshots, and pair the schema push with the exact compatible
      application deployment. A partial or divergent ledger is a stop.
- [ ] Replay the ordered migration ledger through `20260815110000` in the
      authorized release gate and prove exact repository/Production ledger parity,
      advisors, function ACLs, relation ACLs, storage posture, and active-member
      storage authorization.
- [ ] Re-run the preflight on the 293-row target and require the shared tenant
      and receipt checks plus the target-only relation, constraint, and index
      and extension-posture checks to pass before reopening writes.
- [ ] Pass the final combined static, focused source, database, private-plugin,
      and browser gates; complete keyboard, focus, and screen-reader acceptance.
- [ ] Confirm the super-admin entitlement and organization-admin install,
      Classes of 2027–2030 with eight semesters each, Fall 2026 current, future-term
      setup, officer seats, and published policy.
- [ ] Complete live `dvhighcsf@gmail.com` OAuth, Picker, preview, reconnect,
      revocation, and failure-state checks without committing during rehearsal.
- [ ] Test every class join code at its `/connect/<code>` URL while signed out
      or in a private window; complete the exact verified-email auto-connect
      and officer-review paths.
- [ ] For each approved Class of 2027, 2028, and 2029 workbook, discover every
      populated canonical semester tab, confirm its configured semester and
      bounded range, review and reconcile its immutable preview, and commit only
      those approved tabs. Keep Class of 2026 out of scope, skip the Class of
      2030 template, create 2030 through the new application cycle, and then
      accept applications, service/points, posts, Communications, and role-aware
      Help journeys.
- [ ] Verify sender domain, consent topics, one-recipient delivery, signed
      webhook reduction, unknown-outcome handling, and Production scheduled-post
      publication without claiming a fixed delivery time.
- [ ] Record the exact cutover evidence and remaining limitations. Never copy a
      Development fixture, class join code, import preview, or policy decision into
      Production.

## Related references

- [Onboarding a new chapter](new-chapter-onboarding.md)
- [Officer runbook](officer-runbook.md)
- [Source data semantics](source-data.md)
- [Testing and release evidence](testing-and-release.md)
