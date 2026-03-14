# Hybrid anonymous session + durable anonymous profile

## Recommendation

Keep the current `anonymous_signups` model as the durable source of truth for volunteer participation, and use Supabase anonymous auth only as an optional guest-session layer.

Why this split fits Lets Assist better:

- `anonymous_signups` is email-backed, recoverable, and cross-device via emailed links.
- Supabase anonymous auth is best for temporary browser-scoped guest state.
- The repo already has proven transfer/linking logic from anonymous participation into real accounts.
- RLS stays simpler if durable anonymous profiles continue to be server-mediated instead of client-exposed.

## What changed now

The current anonymous project signup flow now requires Turnstile verification when configured:

- initial anonymous project signup
- normal reuse of an existing anonymous profile for a new slot
- resend confirmation email from the pending-signup dialog

Multi-slot anonymous signup keeps a single verification for the first eligible slot request, then allows follow-up requests in the same flow to reuse the just-created anonymous profile without re-solving Turnstile.

## Recommended architecture

### 1. Durable volunteer identity stays in `anonymous_signups`

Keep using the existing tables for volunteer participation:

- `anonymous_signups`
- `project_signups`
- `waiver_signatures`

This remains the system of record for:

- volunteer name/email/phone
- email confirmation state
- emailed access links
- project signup history
- waiver reuse and later account linking

### 2. Optional guest session uses Supabase anonymous auth

Use `supabase.auth.signInAnonymously()` only when a visitor needs authenticated-but-temporary behavior before entering email.

Good examples:

- draft availability selections
- partially completed waiver/form progress
- temporary personalization in the current browser
- guest-only upload or intake state that should follow RLS

### 3. Add guest-session-only tables instead of mixing concerns

If guest-session features are added, prefer separate tables keyed to the anonymous auth user id.

Suggested table:

`guest_project_drafts`

Suggested columns:

- `id uuid primary key`
- `auth_user_id uuid not null references auth.users(id) on delete cascade`
- `project_id uuid not null references projects(id) on delete cascade`
- `draft_payload jsonb not null default '{}'::jsonb`
- `last_selected_schedule_ids text[] not null default '{}'`
- `last_seen_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Optional link table if you want to preserve the relationship between a browser guest session and the later durable anonymous profile:

`anonymous_profile_sessions`

Suggested columns:

- `id uuid primary key`
- `anonymous_signup_id uuid not null references anonymous_signups(id) on delete cascade`
- `auth_user_id uuid not null references auth.users(id) on delete cascade`
- `linked_at timestamptz not null default now()`
- `last_seen_at timestamptz not null default now()`
- `converted_user_id uuid null references profiles(id) on delete set null`
- `invalidated_at timestamptz null`

This table should be optional. Only add it if the guest session needs to reconnect to the durable anonymous profile later.

## Recommended flow

### Flow A: current durable anonymous signup only

1. Visitor opens a project.
2. Visitor fills the anonymous signup dialog.
3. Turnstile is solved.
4. Server creates or reuses `anonymous_signups`.
5. Server creates `project_signups`.
6. Email confirmation link is sent.
7. Visitor confirms and later accesses `/anonymous/[id]?token=...`.
8. Visitor can later link this profile to a real account using the existing transfer flow.

### Flow B: optional hybrid guest session + durable anonymous profile

1. Visitor lands on a public project page.
2. If they need guest-only state, create a Supabase anonymous auth session.
3. Store guest draft data in `guest_project_drafts` with RLS based on `auth.uid()` and `is_anonymous = true`.
4. When the visitor actually submits the signup form, collect name/email/phone and solve Turnstile.
5. Create or reuse the durable `anonymous_signups` row.
6. If useful, create an `anonymous_profile_sessions` link row from the guest auth user to the durable anonymous profile.
7. Continue using the current email confirmation and `/anonymous/[id]` access model.
8. If the user later creates or links a full account, keep the current transfer path for `project_signups` and `waiver_signatures`.
9. Clean up expired guest-session rows separately from durable anonymous profiles.

## RLS guidance

Supabase anonymous auth users use the `authenticated` Postgres role, so guest-session tables need restrictive policies that explicitly check the JWT claim.

Recommended pattern for guest-only tables:

- allow `select/insert/update/delete` only when `auth.uid() = auth_user_id`
- require `(select (auth.jwt()->>'is_anonymous')::boolean) is true`
- use restrictive policies when combining with any broader authenticated-user policy

Recommended non-goal:

- do **not** expose `anonymous_signups` directly to client-side RLS queries just because a user has an anonymous auth session

Keep `anonymous_signups` access server-mediated with the existing tokenized profile access model.

## Conversion guidance

If a guest session later becomes a real account, there are two different upgrade paths:

### Convert the Supabase anonymous auth user itself

Use identity linking (`updateUser`, `linkIdentity`) when the goal is to keep browser-session-owned guest data attached to the same auth user.

Best for:

- guest drafts
- session-owned temporary uploads
- current-device progress

### Link the durable anonymous volunteer profile to a real account

Keep the current Lets Assist transfer/link flow when the goal is to migrate confirmed volunteer participation.

Best for:

- `project_signups`
- `waiver_signatures`
- emailed anonymous profile access
- cross-device recoverability

## Cleanup strategy

Keep cleanup split by data type:

- durable volunteer data: continue using the existing project-aware cleanup rules for `anonymous_signups`
- guest session data: use a short TTL cleanup job for `guest_project_drafts` and optional `anonymous_profile_sessions`
- Supabase anonymous auth rows: if anonymous auth is enabled broadly, add a separate cleanup policy for stale anonymous auth users

## Suggested next steps

1. Keep the current Turnstile-protected anonymous signup flow as the default public volunteer path.
2. Only add Supabase anonymous auth if you want real guest-session features before email capture.
3. If guest drafts are needed, add `guest_project_drafts` first.
4. If you later need stronger batching guarantees for multi-slot signups, move multi-slot anonymous signup into a dedicated server action that verifies Turnstile once per batch.
