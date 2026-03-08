# Supabase RLS remediation rollout and code changes

<!-- markdownlint-disable MD013 -->

Date: 2026-03-06
Project: `lets-assist`
Supabase project: `fotdmeakexgrkronxlof`

## What has been implemented in the codebase

The application code has been updated so it can safely operate with stricter RLS policies.

### Public and cross-user profile reads

Instead of relying on broad table-level access to `profiles`, the app now uses explicit server-side safe reads for public/cross-user profile data.

New helper:

- `lib/profile/public.ts`

Updated callers:

- `app/projects/[id]/actions.ts`
- `app/projects/[id]/ProjectClient.tsx`
- `app/projects/[id]/ProjectDetails.tsx`
- `app/projects/[id]/page.tsx`
- `app/projects/UserProjects.tsx`
- `app/organization/[id]/page.tsx`
- `app/profile/[username]/page.tsx`

### Public certificate detail page

The public certificate detail page now uses server-side admin reads rather than depending on anonymous table access.

Updated file:

- `app/certificates/[id]/page.tsx`

Also hardened:

- volunteer email is no longer rendered on the public certificate detail page

### Anonymous signup token enforcement

Anonymous profile access is now treated as token-bound access, not ID-only access.

New helper:

- `lib/anonymous-signup-access.ts`

Updated anonymous flow files:

- `app/anonymous/[id]/page.tsx`
- `app/anonymous/[id]/actions.ts`
- `app/anonymous/[id]/confirm/page.tsx`
- `app/anonymous/[id]/confirm/SuccessMessage.tsx`
- `app/anonymous/[id]/AnonymousSignupClient.tsx`

### Anonymous waiver preview/download hardening

Anonymous waiver access now requires the anonymous access token in addition to the anonymous signup ID.

Updated files:

- `lib/waiver/preview-auth-helpers.ts`
- `app/api/waivers/[signatureId]/preview/route.ts`
- `app/api/waivers/[signatureId]/download/route.ts`

### Anonymous attendance/check-in compatibility

Anonymous attendance lookup and anonymous check-in were updated to use server-side privileged reads/writes and now return the anonymous access token needed for the profile link.

Updated files:

- `app/attend/[projectId]/actions.ts`
- `app/attend/[projectId]/AttendanceClient.tsx`

### RLS remediation SQL drafted

Drafted SQL migration:

- `plans/security-supabase-rls-remediation-2026-03-06.sql`
- later applied live to the production Supabase project after the app deployment was in place

This migration addresses:

- `profiles`
- `project_signups`
- `anonymous_signups`
- `certificates`
- `organization_calendar_syncs`
- `organization_calendar_events`

### Live API probe scripts

Added reproducible live probe scripts:

- `tests/live-api-probe.cjs`
- `tests/live-api-write-probe.cjs`

## Validation completed so far

### Targeted lint

Targeted ESLint run on the changed files completed with:

- `0` errors
- warnings only in pre-existing `any`-typed areas in project files

### Targeted type safety

Fresh non-incremental typecheck result:

- no type errors in the changed RLS remediation files
- existing unrelated repo errors still remain in:
  - `lib/auth/account-access.test.ts`

### Local production build

`npm run build` completed successfully locally before deployment.

## Rollout completed

### Vercel production deployment

Completed:

- linked the Vercel project
- synced the required production environment variables from local env files
- deployed the updated app to production successfully

Production deployment artifacts observed during rollout:

- production alias: `https://lets-assist.vercel.app`

### Production Supabase migration application

Completed:

- applied the full RLS remediation migration to Supabase project `fotdmeakexgrkronxlof`

### Why the deploy happened before the final migration

The stricter policies would have broken existing production flows if applied ahead of the app changes, especially:

- public profile pages
- public certificate detail pages
- anonymous signup detail/confirmation flows
- anonymous attendance-related profile links
- public project slot-count reads

That is why the actual sequence used was:

1. patch the app code
2. validate locally
3. deploy the app
4. apply the full production RLS migration
5. retest the live API and DB role probes

## Live retest results

### Database role-impersonation retest

Confirmed after the final migration:

- anonymous role sees `0` rows from:
  - `profiles`
  - `project_signups`
  - `anonymous_signups`
  - `certificates`
- anonymous update probe against `anonymous_signups` affected `0` rows
- cross-org admin could no longer read or update `Troop 941` calendar sync rows
- cross-org admin insert into `organization_calendar_events` was blocked by RLS
- the hard-coded profile-update bypass no longer worked
- self-only controls still behaved correctly for:
  - `user_calendar_connections`
  - `user_emails`
  - `project_drafts`

### Live logged-out API probe against `api.lets-assist.com`

Read probes with the publishable key returned empty arrays for:

- `profiles`
- `project_signups`
- `anonymous_signups`
- `certificates`
- `organization_calendar_syncs`

Publicly intended endpoints still returned data:

- `projects`
- `organizations`

Write probes behaved as expected:

- `anonymous_signups` PATCH returned `200` with an empty result set (no row access)
- `project_signups` POST returned `401` / RLS violation

## Outcome

The app-side compatibility changes are deployed, the production Supabase policies are re-hardened, and the live logged-out API surface no longer exposes the tables that were previously leaking sensitive data.
