# DVHS CSF Fall 2026 operator guide

This is the click-by-click handoff for setting up and operating the DVHigh CSF
organization. It is intentionally narrower than the full [officer
runbook](officer-runbook.md): use this page when adding people, connecting their
Let's Assist accounts, assigning officer positions, or reconciling the Fall
2026 source files.

## Environment and stop rules

- Rehearse at `https://dev.lets-assist.com/organization/dvhighcsf`. Development
  uses a separate database. Automated fixtures must use only reserved synthetic
  identities. Real chapter Sheets may be inspected in a read-only preview, but
  do not commit their rows to Development.
- Production is `https://lets-assist.com/organization/dvhighcsf`. Do not copy
  Development fixtures, links, or test decisions into Production.
- The approved Google identity is exactly `dvhighcsf@gmail.com`. Stop at the
  Google chooser if another identity is selected.
- A Google preview is read-only. Committing an import, connecting an account,
  deciding an application, publishing policy, assigning staff access, or
  sending email is a separate reviewed action.
- Never paste a roster, connection token, transcript, receipt, or student row
  into chat, tickets, screenshots, tests, or repository files.

## Before you start

Do all of this once, in order, before the first student record exists. Stages
1–3 of [onboarding a new chapter](new-chapter-onboarding.md) own the general
procedure; this is the DVHS path through them.

1. **Find or create the organization.** Open
   `/organization/dvhighcsf` on the environment you are working in. If it does
   not exist there yet, a trusted member must create the organization first; its
   creator becomes the organization `admin`.
2. **Entitle the plugin** (platform super admin — onboarding Stage 1). In
   `/admin/plugins`, confirm `dvhs-csf` is active and its latest version matches
   the shipped manifest, then grant this organization an entitlement with an
   open window.
3. **Install the plugin** (organization admin — onboarding Stage 2). In the
   organization's **Settings → Plugins**, review the declared permissions and
   confirm the consent gate. After installing, verify that the seeded roles list
   and point categories are populated. If either is empty the install hook
   failed and was compensated: check `plugin_audit_logs` instead of continuing,
   and never hand-seed the missing rows.
4. **Create the graduating classes** (onboarding Stage 3). Open **Classes →
   Semesters & setup** and select **Set up graduating class** once for each of
   2027, 2028, 2029, and 2030. Each class is created together with its eight
   semester records, freshman fall through senior spring. **Add one semester**
   exists only to restore a missing or exceptional record.
5. **Make Fall 2026 current.** On the Fall 2026 term, open **Term actions** and
   select **Set as current**. Exactly one semester is current at a time.

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

1. Open the link in a signed-out/private browser window.
2. Create a Let's Assist account or sign in using the exact verified email on
   the CSF record.
3. At **We found your CSF record — is this you?**, verify the displayed name and
   class.
4. Select **Use this profile** only when both are correct. Select **Not me** if
   anything conflicts.
5. If the account cannot be connected automatically, submit the request and
   wait for an officer decision.

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
4. Read the campaign's **Delivery** panel as three separate facts: its status,
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
| Records                  | reserved synthetic identities only                   | real chapter records                             |
| Real chapter Sheets      | read-only preview only; never commit rows            | commit only after the release gates pass         |
| Links, tokens, decisions | rehearsal artifacts; never carried forward           | issued fresh                                     |

A Development rehearsal proves the procedure, not the release. A green
Development result is not Production readiness, and this guide does not claim
Production readiness for any surface: Production's communications webhook is
still disabled, no chapter roster has been committed anywhere, and the release
gates in [testing and release](testing-and-release.md) are open. Do not copy a
Development fixture, connection link, import preview, or policy decision into
Production, and do not treat a Development screenshot as Production evidence.

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
- Google Cloud origins, callbacks, and Drive/Sheets/Picker key restrictions are
  configured. The in-product connection is **Not connected** until an operator
  completes a fresh `dvhighcsf@gmail.com` password/verification handoff; no real
  row preview or commit has occurred.
- The Development database was verified against all 245 repository migrations
  through `20260811132454`. The unused `pg_graphql` extension is absent from the
  Development schema, and leaked-password protection is enabled. That parity
  claim is now stale in two ways and both must be closed before this section is
  read as current: the repository has since added
  `20260811160000_dvhs_csf_recovery_seat_floor` and
  `20260811161000_dvhs_csf_cohort_link_uniqueness` on `development`, neither of
  which has been applied to hosted Development; and the current
  `dev.lets-assist.com` alias is behind the repository head because Vercel's
  Hobby build limit rejected the newer deployment. Treat hosted acceptance as
  stale until an exact-head deployment is Ready, the outstanding migrations are
  applied, and both are rechecked.
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

## Related references

- [Onboarding a new chapter](new-chapter-onboarding.md)
- [Officer runbook](officer-runbook.md)
- [Source data semantics](source-data.md)
- [Testing and release evidence](testing-and-release.md)
