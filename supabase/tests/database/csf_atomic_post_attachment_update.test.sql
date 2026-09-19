-- Atomic CSF post and attachment updates. Synthetic identities only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

SELECT extensions.has_function(
  'plugin_data',
  'csf_update_post_with_attachments',
  ARRAY['uuid', 'uuid', 'jsonb', 'jsonb', 'uuid', 'uuid'],
  'the atomic post and attachment update boundary exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'service role can call the atomic update boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the atomic update boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot call the atomic update boundary'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.pg_get_userbyid(proc.proowner)
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
  ),
  'postgres',
  'the atomic update boundary retains its postgres owner'
);
SELECT extensions.is(
  (
    SELECT proc.proconfig
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the atomic update boundary retains its empty search path'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
  ),
  'the atomic update boundary remains security definer'
);
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
    ),
    'PERFORM pg_catalog.pg_advisory_xact_lock('
  ) > 0,
  'the atomic update boundary takes the organization advisory transaction lock'
);
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
    ),
    'PERFORM pg_catalog.pg_advisory_xact_lock('
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_update_post_with_attachments(uuid,uuid,jsonb,jsonb,uuid,uuid)'::regprocedure
    ),
    'v_mutation := plugin_data.csf_mutate_post('
  ),
  'the organization lock is acquired before the post mutation can lock the row'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ac000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'atomic-post-admin@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'Atomic Post Attachments',
  'atomic-post-attachments',
  'school',
  '995301'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES (
  'ac400000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'Members flyer',
  'Members-only details.',
  'members',
  'published',
  false,
  false,
  now(),
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000001',
  1, 1024, false
);

SELECT plugin_data.csf_replace_post_attachments(
  'ac100000-0000-4000-8000-000000000001',
  'ac400000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'objectPath',
      'ac100000-0000-4000-8000-000000000001/dvhs-csf/post-images/'
        || 'ac400000-0000-4000-8000-000000000001/'
        || repeat('a', 64) || '.png',
    'fileName', 'members-flyer.png',
    'mimeType', 'image/png',
    'sizeBytes', 1024,
    'checksumSha256', repeat('a', 64),
    'altText', 'Members-only event details'
  )),
  'ac300000-0000-4000-8000-000000000001'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000002',
  0, 0, false
);

CREATE FUNCTION pg_temp.fail_attachment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced attachment replacement failure';
END;
$$;

CREATE TRIGGER force_attachment_delete_failure
BEFORE DELETE ON plugin_data.csf_announcement_attachments
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_attachment_delete();

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_update_post_with_attachments(
    'ac100000-0000-4000-8000-000000000001',
    'ac400000-0000-4000-8000-000000000001',
    '{"title":"Public update","body":"Public details.","audience":"public","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
    '[]'::jsonb,
    'ac000000-0000-4000-8000-000000000001',
    'ac300000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'forced attachment replacement failure',
  'an attachment failure aborts the surrounding post update'
);
SELECT extensions.is(
  (SELECT audience FROM plugin_data.csf_announcements
   WHERE id = 'ac400000-0000-4000-8000-000000000001'),
  'members',
  'a failed attachment replacement cannot expose the post publicly'
);
SELECT extensions.is(
  (SELECT title FROM plugin_data.csf_announcements
   WHERE id = 'ac400000-0000-4000-8000-000000000001'),
  'Members flyer',
  'a failed attachment replacement rolls back the post content change'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ac400000-0000-4000-8000-000000000001'),
  1,
  'a failed replacement preserves the prior flyer metadata'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
     AND correlation_id = 'ac300000-0000-4000-8000-000000000002'),
  0,
  'a failed atomic update leaves no mutation or attachment receipt'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
     AND request_id = 'ac300000-0000-4000-8000-000000000002'),
  'pending',
  'the failed request remains pending for an exact retry'
);

DROP TRIGGER force_attachment_delete_failure
  ON plugin_data.csf_announcement_attachments;

CREATE TEMP TABLE atomic_update_results (
  key text PRIMARY KEY,
  result jsonb NOT NULL
);

INSERT INTO atomic_update_results (key, result)
SELECT 'success', plugin_data.csf_update_post_with_attachments(
  'ac100000-0000-4000-8000-000000000001',
  'ac400000-0000-4000-8000-000000000001',
  '{"title":"Public update","body":"Public details.","audience":"public","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  '[]'::jsonb,
  'ac000000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000002'
);

SELECT extensions.is(
  (SELECT result ->> 'status' FROM atomic_update_results WHERE key = 'success'),
  'published',
  'the atomic update returns the post mutation receipt'
);
SELECT extensions.is(
  (SELECT audience FROM plugin_data.csf_announcements
   WHERE id = 'ac400000-0000-4000-8000-000000000001'),
  'public',
  'a successful retry publishes the new audience'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ac400000-0000-4000-8000-000000000001'),
  0,
  'the same successful transaction removes the prior flyer metadata'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ac300000-0000-4000-8000-000000000002'
     AND source_type = 'post_mutation_request'),
  1,
  'the successful update writes one post mutation receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ac300000-0000-4000-8000-000000000002'
     AND source_type = 'post_attachment_request'),
  1,
  'the successful update writes one attachment receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE object_path LIKE '%/' || repeat('a', 64) || '.png'),
  1,
  'the successful removal retains durable storage cleanup'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ac100000-0000-4000-8000-000000000001'
     AND request_id = 'ac300000-0000-4000-8000-000000000002'),
  'saved',
  'the successful retry marks attachment persistence complete'
);

INSERT INTO atomic_update_results (key, result)
SELECT 'replay', plugin_data.csf_update_post_with_attachments(
  'ac100000-0000-4000-8000-000000000001',
  'ac400000-0000-4000-8000-000000000001',
  '{"title":"Public update","body":"Public details.","audience":"public","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  '[]'::jsonb,
  'ac000000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000002'
);

SELECT extensions.is(
  (SELECT (result ->> 'idempotent')::boolean
   FROM atomic_update_results WHERE key = 'replay'),
  true,
  'an exact retry replays the post mutation receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ac300000-0000-4000-8000-000000000002'),
  2,
  'an exact retry does not duplicate either receipt'
);

SELECT * FROM extensions.finish();
ROLLBACK;
