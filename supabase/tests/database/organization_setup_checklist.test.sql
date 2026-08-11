-- The setup-checklist dismissal column must be readable by clients, writable
-- only by organization admins, and must not widen the organizations read
-- surface that 20260712014700 deliberately narrowed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

SELECT extensions.has_column(
  'public', 'organizations', 'setup_checklist_dismissed_at',
  'organizations carries the dismissal timestamp'
);

SELECT extensions.col_is_null(
  'public', 'organizations', 'setup_checklist_dismissed_at',
  'not dismissed is representable'
);

SELECT extensions.ok(
  has_column_privilege(
    'authenticated', 'public.organizations',
    'setup_checklist_dismissed_at', 'SELECT'
  ),
  'authenticated can read the dismissal timestamp'
);

-- The column-level read boundary this table relies on must still hold. If a
-- future migration re-grants table-wide SELECT, these two would start passing
-- for the wrong reason, so they are asserted alongside.
SELECT extensions.ok(
  NOT has_column_privilege('anon', 'public.organizations', 'join_code', 'SELECT'),
  'anon still cannot read the join code'
);

SELECT extensions.ok(
  NOT has_column_privilege(
    'anon', 'public.organizations', 'staff_join_token', 'SELECT'
  ),
  'anon still cannot read the staff join token'
);

SELECT extensions.ok(
  NOT has_column_privilege(
    'anon', 'public.organizations',
    'setup_checklist_dismissed_at', 'SELECT'
  ),
  'the dismissal timestamp is not exposed to anonymous callers'
);

-- Writes stay governed by the existing admin-only UPDATE policy rather than by
-- a new grant.
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organizations'::regclass
      AND p.polcmd = 'w'
  ),
  'organizations still restricts updates through RLS'
);

SELECT * FROM extensions.finish();

ROLLBACK;
