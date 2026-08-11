# Onboarding a new CSF chapter

End-to-end procedure for bringing a chapter onto the DVHS CSF plugin, from an empty organization to students signing up. Written to be run in order; each stage names the person who can do it.

This generalizes the DVHS-specific cutover in [officer runbook §10](officer-runbook.md#10-fall-2026-rollout-cohort-links-legacy-seed-and-posts). Day-to-day operation after onboarding is the rest of the [officer runbook](officer-runbook.md).

**Rehearse the whole sequence locally first** — `bun run dev` brings up the isolated CSF stack with fictional fixtures. Never rehearse against a real chapter's data.

## DVHS hosted Development rehearsal

Use `https://dev.lets-assist.com` only for the final shared rehearsal. It is the
`development` branch deployed against the separate Supabase Development branch;
it is not Production. The hosted fixture refresh is intentionally explicit:

```sh
CSF_LOCAL_TEST_PASSWORD="$(security find-generic-password -s lets-assist-dev-csf-fixture -a riddhiman.rana -w)" \
  bun run csf:seed:hosted:development
```

The command rejects local and Production targets, verifies the Development
project ref, and only seeds reserved `.test` identities. The shared fixture
password is stored in macOS Keychain under service
`lets-assist-dev-csf-fixture`; do not put it in a document, message, shell
history, or repository.

Use these roles to verify the actual permission boundary rather than testing
everything as an administrator:

| Account                          | Rehearsal purpose                                           |
| -------------------------------- | ----------------------------------------------------------- |
| `csf.admin@local.test`           | Organization and CSF administration                         |
| `csf.vp-membership@local.test`   | Applications, members, and account connections              |
| `csf.secretary@local.test`       | Meetings and attendance                                     |
| `csf.treasurer@local.test`       | Dues                                                        |
| `csf.data-management@local.test` | Imports and reconciliation                                  |
| `student.2028@local.test`        | Existing Class of 2028 record and exact-email profile claim |
| `csf.applicant@local.test`       | Applicant and unmatched account-link paths                  |
| `platform.outsider@local.test`   | Public/private boundary check                               |

The current Development rehearsal tracks Classes of 2027, 2028, 2029, and 2030. Each class has an active Fall 2026 semester record and reusable combined
link. Development dates and policies are rehearsal inputs only; an adviser must
replace and approve them from the chapter calendar before a Production cutover.

### Development acceptance walk-through

1. Sign in as `csf.admin@local.test`; open **DVHS CSF → Classes**. Confirm all
   four classes point to Fall 2026, the application window is set, the policy is
   published, and each class has one active reusable link.
2. Open **Members → account connections** and note the queue before testing a
   new link. Never expose or export the member roster to perform this check.
3. In a signed-out window, open the Class of 2028 link and sign in as
   `student.2028@local.test`. Confirm **Is this you?**, choose **Use this
   profile**, then verify **Home** and **My CSF** show the class, current policy,
   and historical semesters.
4. Repeat with `csf.applicant@local.test`, choose **Not me** or submit the
   unmatched request, then return as the Membership VP. Verify the request
   appears in the officer queue. Connect only when the recorded email, name, and
   class all corroborate; otherwise reject with a reason.
5. Sign in as `platform.outsider@local.test`. The public organization page may
   show public activities, but must not expose roster, applications, evidence,
   attendance, points, or account-connection data.
6. As the relevant officer roles, click through Applications, Members,
   Activities, Points, Meetings, Partner clubs, Imports, Reports, Staff access,
   Change history, Communications, and Settings. A hidden route is an expected
   permission result; a blank page, runtime error, or cross-role private data is
   not.
7. Keep email in no-send mode until the Resend topic id, webhook, audience
   consent key, sender domain, and exact recipient snapshot are all visible.
   Queue/delivery/provider outcomes are separate states.
8. Download a report ZIP and inspect it locally. Do not upload generated reports
   or browser traces to the repository.

For Google acceptance, Chrome must be signed into exactly
`dvhighcsf@gmail.com`. If the account is not offered by Google, stop at the
chooser. Do not authorize a personal account. Selecting a Sheet and generating
an import preview are read-only; committing rows is a separate consequential
step that requires the named officer to review counts, mappings, conflicts, and
source identity first.

## Before you start

| Prerequisite                            | Who provides it | Notes                                                                                      |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| The organization exists on the platform | An org admin    | Created by a trusted member; the creator becomes `admin`                                   |
| A named chapter owner                   | The chapter     | Becomes the `owner` staff position, which carries every capability                         |
| A chapter Google account                | The chapter     | For Sheets and Drive imports. Never a personal account — see [source data](source-data.md) |
| Legacy records, if any                  | The chapter     | Rosters, attendance, club audits. Layouts in [source data](source-data.md)                 |

## Stage 1 — Entitlement (platform super admin)

DVHS CSF is a private plugin, so the organization needs an explicit entitlement before it can install anything.

1. In `/admin/plugins`, confirm `dvhs-csf` is `is_active` and its `latest_version` matches the shipped manifest.
2. Grant the organization an entitlement with an open window.

Full detail, including what `is_forced` and `force_update_version` do: [plugin install guide](../development/plugin-install-guide.md).

## Stage 2 — Install (organization admin)

In `/organization/[id]/settings` → Plugins, review the declared permissions and confirm the consent gate.

Installing runs the `onInstall` hook, which seeds the chapter's default roles and point categories. **Verify before continuing:** the roles list is populated and point categories exist. If either is empty the hook failed and was compensated — check `plugin_audit_logs` rather than proceeding.

On a hosted Supabase project, **Data API → Exposed schemas** must include
`plugin_data`. The plugin's server-only client addresses that schema through
PostgREST during installation and normal operation. An install that reports
`Invalid schema: plugin_data` should be left compensated, the setting corrected,
and the normal install action retried; never hand-seed the missing rows.

Exposing the schema is not permission to expose chapter data. Before continuing,
verify that `anon` and `authenticated` still have no schema usage or table
grants, while `service_role` has schema usage:

```sql
select
  has_schema_privilege('anon', 'plugin_data', 'USAGE') as anon_usage,
  has_schema_privilege('authenticated', 'plugin_data', 'USAGE') as authenticated_usage,
  has_schema_privilege('service_role', 'plugin_data', 'USAGE') as service_role_usage,
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'plugin_data'
  ) as browser_table_grants;
```

The required result is `false`, `false`, `true`, and `0`, respectively.

## Stage 3 — Semester and cohorts

Following [officer runbook §2](officer-runbook.md) and §10.1:

1. Create one cohort per graduating class the chapter tracks. Include a graduated class only if you intend to seed its history.
2. Create the terms you have records for, marking past terms **closed** and the incoming term **current**. Exactly one term is current at a time. Enter both application dates or leave both blank; before opening a semester, both are required and the closing date must follow the opening date.
3. Set the term policy — point requirements, deadlines, proof rules — before any member-facing work. Points recorded under a missing policy are refused by design. A policy draft does not govern records until an adviser publishes it.
4. Assign staff positions from the role templates. The chapter owner must hold an active `owner` position; owner authority is derived from that position, never from an email address.

## Stage 4 — Legacy import (optional)

Only if the chapter has history worth carrying. Skip entirely for a brand-new chapter.

Import through the Sheets workspace preview → commit fence. Google and the chapter website are source evidence, not a second database. Every commit is staff-approved and only reversible forward. The order matters, because later imports reference earlier ones:

1. **Club registry and policies** — partner-form imports, producing partner clubs with per-club point policy.
2. **Member roster** — an application-responses import for the earliest term you are seeding. Grade maps to graduating class.
3. **Attendance** — a meeting-attendance import per term. Name-only rows will land ambiguous; resolve what you can. `skipped` is an honest terminal state for a departed student.
4. **Per-club points** — normalize first with `bun run csf:normalize:legacy`, review every generated mapping (sheet selection, club name, excluded rows, points per mark), then re-run with `--apply` and upload each normalized workbook as a partner-club-audit import.

**Acceptance before moving on:** per-cohort roster counts match the application grade distribution; at least three clubs' point totals spot-checked against their source workbooks; the ambiguous-row queue is triaged to zero or every remaining row is documented.

DVHS-specific file names and expected row counts are in [officer runbook §10.2](officer-runbook.md).

## Stage 5 — Communications setup

Before any announcement email: save the broadcast topic and the Resend topic id in the organization's plugin settings for the `term_members` audience. Cohort posts email through the same announcements consent topic, and the durable ledger will refuse to queue without it.

## Stage 6 — Student rollout

1. Create one cohort onboarding link per graduating class for the current term, combined link type. These replace whatever the chapter published before — Classroom codes, a form, a spreadsheet.
2. Publish the links wherever the chapter reaches students.

What a student experiences: they sign up through the link, skip the generic platform tour, confirm an exact-email claim ("is this you?"), pick a username in place, and land on their class Home with the CSF member tour.

A student whose sign-up email is not on the roster submits a **link request** instead. Officers resolve these in the Members queue, which offers ranked name-similarity suggestions for one-click connection. **Roster names are never exposed to students** — the student sees only their own request's state.

## Stage 7 — First-term operation

Ordinary running is the officer runbook. The first term is worth watching more closely:

- Post from the class Stream with audience `class` (one cohort) or `members` (whole chapter). Pin sparingly.
- The "also send as email" toggle queues exactly one campaign per post through the durable ledger. Retries are safe; edits after queueing never change the email already sent. Delivery drains every 10 minutes via the `csf-communications-dispatch` workflow.
- Grant posting rights through the `manage_posts` capability. Publicity VP and Web Master templates carry it; org admins and the owner always have it.
- Recipients opt out through the link in every announcement email. Opt-outs exclude the address from future snapshots automatically — never hand-manage them.

## Stage 8 — First close

Run a term close only after at least one full cycle of points and attendance. The close is transactional and has a preflight that names every blocking condition; do not work around a block, resolve it. Close and reopen are both audited. See [officer runbook §8](officer-runbook.md).

## Stop rules

Stop and escalate rather than improvising:

| Condition                                        | Action                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| The wrong Google identity is connected           | Stop before selecting files; reconnect the approved chapter account                                            |
| An imported point value is missing or malformed  | Leave the row unresolved and fix the source mapping. Never guess a value                                       |
| A profile is duplicate or ambiguous              | Send it to account-connection review. Never search the roster on a student's behalf or read names back to them |
| `onInstall` left roles or point categories empty | Do not proceed to Stage 3. Check `plugin_audit_logs`                                                           |
| A term policy is missing                         | Do not record points. Create the policy first                                                                  |

## Related

- [Officer runbook](officer-runbook.md) — day-to-day operation
- [Formal invariants](invariants.md) — what must always hold
- [Product contract](product-contract.md)
- [Source data layout](source-data.md)
- [Plugin install guide](../development/plugin-install-guide.md)
