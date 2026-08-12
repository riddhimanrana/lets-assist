-- Contract for officer follow-up replies on CSF member posts (Amendment 2).
--
-- Three things must hold: the table is server-only like every sibling
-- plugin_data table, parent deletion cannot bypass the reviewed reply boundary,
-- and the database itself refuses a blank or unbounded body.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(20);

SELECT extensions.ok(
  to_regclass('plugin_data.csf_announcement_replies') IS NOT NULL,
  'the announcement replies table exists'
);

SELECT extensions.ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'plugin_data.csf_announcement_replies'::regclass
  ),
  'the replies table enforces row level security'
);

-- ---------------------------------------------------------------------------
-- Privilege boundary: service-role only, like every sibling plugin_data table
-- ---------------------------------------------------------------------------

WITH table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'plugin_data.csf_announcement_replies',
    privilege_name
  ),
  format('anon cannot %s announcement replies', privilege_name)
)
FROM table_privileges;

WITH table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'plugin_data.csf_announcement_replies',
    privilege_name
  ),
  format('authenticated cannot %s announcement replies', privilege_name)
)
FROM table_privileges;

SELECT extensions.ok(
  has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'REFERENCES'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'TRIGGER'
  ),
  'the server role reads replies but writes only through the transaction RPC'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'reply-officer@local.test', now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'CSF Replies', 'csf-replies', 'school', '987001'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, published_at, created_by
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'Park Cleanup Reminder', 'Bring gloves.', 'members', 'published', now(),
  'ce000000-0000-4000-8000-000000000001'
);

-- ---------------------------------------------------------------------------
-- Body bounds: refused by the table, not just the application
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_announcement_replies (
      organization_id, announcement_id, body, created_by
    ) VALUES (
      'ce100000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      '   ',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  NULL,
  'a whitespace-only reply body is refused'
);

SELECT extensions.throws_ok(
  format(
    $$
      INSERT INTO plugin_data.csf_announcement_replies (
        organization_id, announcement_id, body, created_by
      ) VALUES (
        'ce100000-0000-4000-8000-000000000001',
        'ce200000-0000-4000-8000-000000000001',
        %L,
        'ce000000-0000-4000-8000-000000000001'
      )
    $$,
    repeat('x', 4001)
  ),
  '23514',
  NULL,
  'a reply body over 4000 characters is refused'
);

INSERT INTO plugin_data.csf_announcement_replies (
  id, organization_id, announcement_id, body, created_by
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'Rescheduled to 9 AM — same meeting spot.',
  'ce000000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_announcement_replies
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a bounded reply on a published post is accepted'
);

-- ---------------------------------------------------------------------------
-- Departed author: the reply survives without a byline
-- ---------------------------------------------------------------------------

DELETE FROM auth.users WHERE id = 'ce000000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (
    SELECT created_by IS NULL
    FROM plugin_data.csf_announcement_replies
    WHERE id = 'ce300000-0000-4000-8000-000000000001'
  ),
  'deleting the author account nulls the byline and keeps the reply'
);

-- ---------------------------------------------------------------------------
-- Parent deletion is restricted; explicit plugin teardown is the sole bulk path
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ DELETE FROM plugin_data.csf_announcements
     WHERE id = 'ce200000-0000-4000-8000-000000000001' $$,
  '23503',
  NULL,
  'a parent post cannot cascade around the reply transaction boundary'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_announcement_replies
    WHERE announcement_id = 'ce200000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a refused parent delete leaves the reply intact'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_purge_recovery_foundations(
    'ce100000-0000-4000-8000-000000000001'
  ) $$,
  'the reviewed plugin teardown explicitly removes tenant replies'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM plugin_data.csf_announcement_replies
    WHERE announcement_id = 'ce200000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'plugin teardown removes the reply before its parent'
);

SELECT extensions.lives_ok(
  $$ DELETE FROM plugin_data.csf_announcements
     WHERE id = 'ce200000-0000-4000-8000-000000000001' $$,
  'the parent post can be deleted after the explicit teardown'
);

SELECT * FROM extensions.finish();

ROLLBACK;
