# DVHS CSF Fall 2026 operator guide

This is the click-by-click handoff for setting up and operating the DVHigh CSF
organization. It is intentionally narrower than the full [officer
runbook](officer-runbook.md): use this page when adding people, connecting their
Let's Assist accounts, assigning officer positions, or reconciling the Fall
2026 source files.

## Environment and stop rules

- Rehearse at `https://dev.lets-assist.com/organization/dvhighcsf`. Development
  uses a separate database and must contain only reserved synthetic identities.
- Production is `https://lets-assist.com/organization/dvhighcsf`. Do not copy
  Development fixtures, links, or test decisions into Production.
- The approved Google identity is exactly `dvhighcsf@gmail.com`. Stop at the
  Google chooser if another identity is selected.
- A Google preview is read-only. Committing an import, connecting an account,
  deciding an application, publishing policy, assigning staff access, or
  sending email is a separate reviewed action.
- Never paste a roster, connection token, transcript, receipt, or student row
  into chat, tickets, screenshots, tests, or repository files.

## Add one student

1. Open the DVHigh CSF organization and select **Members**.
2. Select **Add member** at the top of the page.
3. Enter the student's exact first and last name. Add middle/preferred names
   only when the chapter source supports them.
4. Enter the current school email, personal email, or both. Do not substitute
   an officer's email.
5. Choose **Class of 2027**, **2028**, **2029**, or **2030**.
6. Select **Add student record** and wait for **CSF profile created**.
7. Confirm the row appears in **Members → Directory** with the correct class.

This creates the permanent CSF student record. It does not create a Let's
Assist login and it does not make the student a current-semester member.

## Give that student a private account-connection link

1. From **Members**, select **Account connections**.
2. Select **Student link**.
3. Choose the unconnected student record.
4. Choose one of the recorded school/personal emails offered by the product.
   The address cannot be typed arbitrarily.
5. Choose **Fall 2026**, confirm the expiry, and select **Create secure link**.
6. Wait for **Student-specific link is ready**.
7. In **Student-specific links**, select **Copy link** and share it through an
   approved chapter channel. Creating or copying the link sends no email.

The copied value must be an absolute HTTPS URL on the current environment, for
example `https://dev.lets-assist.com/...` during rehearsal. Use **Renew link**
only when the old token must stop working; use **Cancel** to invalidate it.

## Give a whole class its reusable join link

1. Open **Members → Account connections**.
2. Select **Class link**.
3. Choose the graduating class and **Fall 2026**.
4. Leave the application-form field blank unless the reviewed Fall 2026 form
   URL is ready. Add a student note only when the chapter has approved it.
5. Select **Create class link**.
6. Under **Reusable class links**, select **Copy link** for that class.
7. Repeat once for Classes of 2027, 2028, 2029, and 2030.

Use the reusable class link for ordinary rollout. Use a student-specific link
when one known record needs a bounded recovery path. Neither action emails the
student.

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

## Resolve the officer queue

1. Open **Members → Account connections → Matches to review**.
2. Open **Resolve** for the request.
3. Compare the canonical name, verified email, requested class, existing
   account, and source evidence. Do not approve on name similarity alone.
4. Enter a specific decision reason.
5. Select **Connect account** only when the verified email is unique and every
   class/identity check agrees. Otherwise reject or correct the student record
   first.
6. Return to **Members** and confirm the row says **Connected**.

## Make a connected person an officer

1. Confirm the person's member row says **Connected**. An unconnected record
   cannot receive staff access.
2. Open **More → Staff access**.
3. If the needed seat does not exist, use **Position seats → Add position** and
   review its capabilities and seat limit.
4. Select **Assign position**.
5. Choose the connected CSF profile and the position, then set the school year,
   effective start, and end dates.
6. Submit the assignment and confirm it appears in **Officer roster**.

The seeded chapter positions are CSF Owner, Adviser, Co-President, Vice
President (Membership/Publicity/Clubs), Treasurer, Secretary, Web Master,
Activity Coordinator, and Data Management. Grant the narrowest position the
person actually needs.

## Import the reviewed Fall 2026 starting records

1. Open **More → Imports**.
2. Under **Google Sheets connection**, select **Connect**.
3. Authenticate exactly `dvhighcsf@gmail.com`, return to Imports, and confirm
   the page says **Connected** before choosing any file.
4. Use **Historical records** for the prior-semester class workbooks. Choose
   the exact workbook, `S26` tab, header row `1`, and bounded range below.
5. Select **Inspect columns**, map the source columns, then create a preview.
6. Reconcile total, matched, new, ambiguous, skipped, and failed rows. Record a
   reason for every manual match or skip.
7. Commit only after an officer confirms the preview against both the class
   workbook and the Spring 2026 application responses.

### Privacy-safe source totals verified 2026-08-10

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

1. Open **Classes → Semesters & setup → Fall 2026**.
2. Add the real application window, deadlines, and required meetings.
3. Open **Policy**, enter the reviewed academic/dues/service rules, and have the
   adviser publish them.
4. Do not copy Spring 2026 dates or point rules into Fall 2026 without adviser
   approval. `dvhighcsf.org` currently says only that applications will reopen
   in Fall; it does not publish the Fall 2026 dates.

## Communications and email

1. Open **More → Communications**.
2. Use **Campaigns** for drafts and exact audience snapshots, **Delivery
   issues** for unknown/quarantined provider outcomes, and **Settings** for the
   reviewed consent-topic configuration.
3. A saved draft does not contact anyone. A queued ledger row is not proof of
   delivery.
4. Before the first real send, verify the sender, stored consent topic, Resend
   topic id, exact one-recipient test snapshot, signed webhook ingestion, and
   final delivered/bounced outcome.

## Development rehearsal state at this guide's verification point

- DVHigh CSF exists at `dev.lets-assist.com`, the DVHS CSF plugin is installed,
  Classes of 2027–2030 exist, and Fall 2026 is current.
- One synthetic `@local.test` student record, one student-specific link, and one
  reusable combined link per class were created through the hosted UI.
- The copied student link was verified as an absolute
  `https://dev.lets-assist.com/...` URL.
- Help, Members, Staff access, Imports, and the three-section Communications
  workspace were clicked through on the deployed Development build.
- Google OAuth is paused at the password step for `dvhighcsf@gmail.com`; no real
  row preview or commit has occurred.
- Fall 2026 application dates, deadlines, meetings, and published policy are
  not yet recorded. No staff position has been assigned and no campaign has
  been sent.
- Production was not changed by this rehearsal.

## Related references

- [Onboarding a new chapter](new-chapter-onboarding.md)
- [Officer runbook](officer-runbook.md)
- [Source data semantics](source-data.md)
- [Testing and release evidence](testing-and-release.md)
