-- Officer profile notes: execution grants, permission gate, validation, and
-- the tagged happy path that the appeals paper trail depends on.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

-- ---------------------------------------------------------------------------
-- A. Execution grants
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_add_profile_note(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot write a profile note'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_add_profile_note(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot write a profile note'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_add_profile_note(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'the server role can write a profile note'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
--
-- The officer is an organization admin, which short-circuits
-- csf_actor_has_permission. The bystander is an active member with no staff
-- position, so the permission gate below has a real negative case.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('cf000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-profile-notes-officer@local.test', now(), '{}', '{}', now(), now()),
  ('cf000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-profile-notes-bystander@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'CSF Profile Notes',
  'csf-profile-notes',
  'school',
  '730002'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('cf100000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'F25',
  'Fall 2025',
  '2025-2026',
  'fall'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('cf300000-0000-4000-8000-000000000001', 'cf100000-0000-4000-8000-000000000001',
   'Nia', 'Notes', 'nia', 'notes');

-- ---------------------------------------------------------------------------
-- C. Permission and validation gates
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      'cf300000-0000-4000-8000-000000000001',
      NULL, 'appealed', 'Bystander note'
    )
  $$,
  '42501',
  'Not authorized to write CSF member notes.',
  'a member without staff permissions cannot write a note'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-000000000001',
      NULL, NULL, '   '
    )
  $$,
  '23514',
  'A note needs a body.',
  'a blank body is rejected'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-00000000dead',
      NULL, NULL, 'Note for a missing member'
    )
  $$,
  'P0002',
  'CSF member not found.',
  'a note cannot target a profile outside the organization'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-00000000dead',
      NULL, 'Note for a missing term'
    )
  $$,
  'P0002',
  'Term not found.',
  'a note cannot reference a term outside the organization'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000001',
      'cf300000-0000-4000-8000-000000000001',
      NULL, 'shouting', 'Unknown tag'
    )
  $$,
  '23514',
  NULL,
  'an unknown tag is rejected by the check constraint'
);

-- ---------------------------------------------------------------------------
-- D. Happy path
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'appealed',
    'Fixed November attendance after reviewing the appeal evidence.'
  )) ->> 'tag',
  'appealed',
  'an admin can write a tagged, term-scoped note'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
     AND profile_id = 'cf300000-0000-4000-8000-000000000001'),
  1,
  'exactly one note row was written'
);

SELECT extensions.is(
  (SELECT tag FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
   ORDER BY created_at DESC LIMIT 1),
  'appealed',
  'the stored note keeps its tag'
);

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    'General observation without a tag or term.'
  )) ->> 'tag',
  NULL,
  'tag and term stay optional'
);

SELECT extensions.finish();

ROLLBACK;
