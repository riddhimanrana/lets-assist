# Supabase RLS penetration test report

<!-- markdownlint-disable MD013 -->

Date: 2026-03-06
Project: `lets-assist` (`fotdmeakexgrkronxlof`)

## Scope

This audit tested the live Supabase RLS behavior for the production `lets-assist` project using non-persistent SQL probes.

Methodology:

- inspected all public-table RLS policies via `pg_policies`
- inspected security-definer helpers used by policies
- simulated application roles with `set local role ...` and `request.jwt.claims`
- used real production identities and relationships for role-based probes
- wrapped write probes in `begin` / `rollback` so no test data was persisted
- mapped exposed tables back to application query paths in the repo

## Test identities used

- anonymous role: `anon`
- authenticated outsider: `72898b29…`
  - no org membership, no creator privileges
- cross-org admin: `7b97983a…`
  - admin of `Windemere Ranch Middle School`
  - not a member of `Troop 941`
- target org admin: `b6ee0559…`
  - admin of `Troop 941`
- self-access control user: `7062f213…`
  - has `user_calendar_connections` rows

## Executive summary

The RLS layer is **not currently accurate or safe** across several high-value tables.

### Confirmed critical issues

1. `profiles` is readable by anonymous users, including rows with email and phone data.
2. `profiles` has a hard-coded UUID bypass that allows one specific account to update any profile.
3. `project_signups` is readable by anonymous users.
4. `anonymous_signups` is readable by anonymous users and updateable by anonymous users.
5. `certificates` is readable by anonymous users, including volunteer email data.
6. `organization_calendar_syncs` and `organization_calendar_events` allow cross-organization access because the policy predicate uses a tautological alias comparison.

### Confirmed controls that behaved correctly

1. Anonymous `projects` access was limited to public/unlisted published rows.
2. `user_calendar_connections` remained self-only.
3. `user_emails` remained self-only.
4. `project_drafts` remained self-only.

### Suspicious or latent issues

1. `waiver_definitions`, `waiver_definition_fields`, and `waiver_definition_signers` do not currently restrict reads by project visibility/workflow status.
   - No live non-public project-scoped waiver definitions existed during testing, so this was not a live data leak today.
2. `notifications` insert policy text appears broader than intended, but the anonymous insert probe did **not** reproduce successfully.
3. `content_flags` admin access depends on `auth.jwt()->>'role' = 'admin'`, which may not match your actual JWT shape.

## Confirmed findings

## 1. `profiles` is public-readable and exposes sensitive columns

### Profiles read policy evidence

- `profiles_select_anon`: `true`
- `profiles_select_authenticated`: `... OR true`

### Profiles read live probe result

As `anon`, the database returned:

- `profiles_visible = 56`
- `profiles_with_email = 55`
- `profiles_with_phone = 16`

### Profiles read risk

This exposes user directory data to unauthenticated callers, including:

- `email`
- `phone`
- `trusted_member`
- `profile_visibility`
- other profile metadata

### Profiles read affected app query paths

- `hooks/useUserProfile.ts`
- `app/profile/[username]/page.tsx`
- `app/home/page.tsx`
- `app/organization/page.tsx`
- `app/projects/create/page.tsx`
- many admin flows also query `profiles`, but the exposure exists even before admin-only app logic runs

## 2. `profiles` contains a hard-coded global update bypass

### Profiles update policy evidence

`profiles_update_authenticated` includes:

- `auth.uid() = id`
- `auth.uid() = 'b6ee0559-a406-4992-b621-9c5af015adce'`
- `is_super_admin()`

### Profiles update live probe result

- account `b6ee0559…` successfully updated another user's profile in a rolled-back transaction
- normal outsider account `72898b29…` could **not** update another user's profile

### Profiles update risk

This is a hidden privileged backdoor in RLS, separate from `is_super_admin()`.
If that UUID corresponds to a normal application user, compromise of that account gives profile-wide write access.

### Profiles update affected app query paths

Any profile mutation path is affected because the database itself grants the bypass.

## 3. `project_signups` is public-readable

### Project signups policy evidence

- `project_signups select all`: `true`

### Project signups live probe result

As `anon`, the database returned:

- `project_signups_visible = 18`
- `signups_with_user_id = 11`
- `signups_with_comment = 3`

### Project signups risk

Anonymous callers can enumerate signup records, including linked user IDs and volunteer comments.
Depending on joins used by callers, this can expose attendee participation data well beyond intended public-attendee flows.

### Project signups affected app query paths

- `app/projects/[id]/page.tsx`
- `app/projects/[id]/ProjectDetails.tsx`
- `app/projects/[id]/signups/actions.ts`
- `app/projects/[id]/attendance/AttendanceClient.tsx`
- `app/organization/[id]/reports/actions.ts`
- `utils/calendar-helpers.ts`
- `app/dashboard/page.tsx`

## 4. `anonymous_signups` is public-readable and public-updateable

### Anonymous signups policy evidence

- `anon_signups_select_anyone`: `true`
- `anon_signups_update_policy`: `qual = true`, `with_check = true`

### Anonymous signups live probe result

As `anon`, the database returned:

- `anonymous_signups_visible = 8`
- `anonymous_signups_with_email = 8`
- `anonymous_signups_with_phone = 4`

Also, as `anon`, a rolled-back update against row `4e5e8ff0…` succeeded:

- `anon_updated_anonymous_signup = 1`

### Anonymous signups risk

This is one of the most severe findings in the audit:

- anonymous users can read all anonymous signup records
- anonymous users can mutate arbitrary anonymous signup records
- exposed fields include `email`, `name`, and `phone_number`

### Anonymous signups affected app query paths

- `app/anonymous/[id]/page.tsx`
- `app/anonymous/[id]/actions.ts`
- `app/anonymous/[id]/confirm/page.tsx`
- `app/projects/[id]/actions.ts`
- `app/anonymous/[id]/AnonymousSignupClient.tsx`

## 5. `certificates` is anonymous-readable

### Certificates policy evidence

- `certificates_select_anon`: `true`

### Certificates live probe result

As `anon`, the database returned:

- `certificates_visible = 25`
- `certificates_with_email = 25`

### Certificates risk

Anonymous callers can read certificate rows containing volunteer identity/contact-adjacent data such as:

- `volunteer_email`
- `volunteer_name`
- `project_title`
- `organization_name`
- event timing metadata

### Certificates affected app query paths

- `app/certificates/page.tsx`
- `app/certificates/[id]/page.tsx`
- `app/dashboard/page.tsx`
- `app/organization/[id]/reports/actions.ts`
- `app/projects/[id]/hours/actions.ts`
- `app/organization/[id]/member-hours-actions.ts`

## 6. Cross-org escalation in `organization_calendar_syncs`

### Calendar syncs policy evidence

Several `organization_calendar_syncs` policies contain this predicate pattern:

- `om.organization_id = om.organization_id`

That comparison is tautologically true and does **not** bind the membership row to the target row's `organization_id`.

### Calendar syncs live probe result

Using `7b97983a…` (admin of `Windemere Ranch Middle School`, not a member of `Troop 941`):

- `troop_calendar_syncs_visible_to_other_org_admin = 1`
- `troop_calendar_syncs_updated_by_other_org_admin = 1`

### Calendar syncs risk

An admin of one organization can read and update another organization's calendar sync configuration.
That exposes or allows manipulation of org-linked calendar metadata.

### Calendar syncs affected app query paths

- `app/organization/[id]/calendar/actions.ts`

## 7. Cross-org escalation in `organization_calendar_events`

### Calendar events policy evidence

The `organization_calendar_events` policies use the same broken alias pattern:

- `om.organization_id = om.organization_id`

### Calendar events live probe result

Using the same cross-org admin identity `7b97983a…`, a rolled-back insert into `Troop 941` succeeded:

- `troop_calendar_events_inserted_by_other_org_admin = 1`

### Calendar events risk

An admin/staff user from one organization can create or modify another organization's calendar-event linkage rows.

### Calendar events affected app query paths

- `app/organization/[id]/calendar/actions.ts`

## Positive controls that passed

## 1. Anonymous project visibility gate worked

Database totals:

- `total_projects = 75`
- `anon_expected_projects = 72`

As `anon`:

- `visible_projects = 72`

This matched the intended `projects_select_anon` visibility rule.

## 2. Self-only tables stayed self-only

As outsider `72898b29…`:

- `outsider_visible_other_user_calendar_connections = 0`
- `outsider_visible_other_user_emails = 0`
- `outsider_visible_other_user_drafts = 0`

As valid owners:

- `own_calendar_connections_visible = 3` for `7062f213…`
- `own_user_emails_visible = 1` for `b6ee0559…`

These behaved correctly.

## Latent / follow-up issues

## 1. Waiver definition read policies are broader than project visibility

Policies:

- `waiver_definitions_read_policy`
- `waiver_definition_fields_read_policy`
- `waiver_definition_signers_read_policy`

They allow reads whenever the linked project exists, without checking whether the project is public/unlisted published.

### Waiver definitions current live state

- `total_waiver_definitions = 11`
- `project_scoped = 11`
- `nonpublic_project_scoped = 0`

So this is **not a live leak today**, but it is a future-risk policy bug.

## 2. `notifications` insert policy should be reviewed

The policy text looks unusually broad:

- `Insert own or by project owner`
- includes an `auth.uid() IS NULL` branch

However, an anonymous insert probe did **not** reproduce; Supabase rejected the row with an RLS violation.

Recommendation: review this policy anyway, but do not treat it as confirmed exploitable based on this audit alone.

## 3. `content_flags` admin policy may not match actual JWT claims

Policies use:

- `auth.jwt()->>'role' = 'admin'`

Your actual application JWTs appear to use standard Supabase `authenticated` role plus custom app metadata, so this may be a functional mismatch rather than a data leak.

## Remediation priority

## Immediate

1. Lock down `profiles` reads and remove the hard-coded UUID update bypass.
2. Replace `project_signups select all` with owner/participant/explicit-public-attendee access only.
3. Replace `anonymous_signups` public read/update policies with token-bound or owner-bound access.
4. Remove anonymous read access to `certificates` unless the entire certificate object is intentionally public.
5. Fix all `organization_calendar_syncs` and `organization_calendar_events` policies so they compare membership to the target row's `organization_id`.

## Next

1. Review `waiver_definitions*` read policies before any non-public waiver definitions are created.
2. Review `notifications` insert behavior and simplify policy intent.
3. Review `content_flags` admin claim logic for consistency with your JWT structure.

## Suggested retest plan after fixes

After policy remediation, rerun these exact probes:

- anonymous count checks for `profiles`, `project_signups`, `anonymous_signups`, `certificates`
- outsider-vs-owner checks for `user_calendar_connections`, `user_emails`, `project_drafts`
- cross-org admin read/update/insert checks for `organization_calendar_syncs` and `organization_calendar_events`
- profile cross-user update checks for the old hard-coded UUID path
- waiver-definition visibility checks once non-public project waivers exist

## Bottom line

The current RLS layer has multiple confirmed authorization bugs, including public disclosure of profile/contact-like data and cross-organization calendar privilege escalation. The most urgent tables to fix are:

- `profiles`
- `project_signups`
- `anonymous_signups`
- `certificates`
- `organization_calendar_syncs`
- `organization_calendar_events`
