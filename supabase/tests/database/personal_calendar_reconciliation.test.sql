BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(88);
CREATE TEMP TABLE update_functions(signature text PRIMARY KEY);
INSERT INTO update_functions VALUES
 ('public.claim_personal_calendar_update(uuid,uuid,jsonb)'),
 ('public.claim_personal_calendar_sync(uuid,text,uuid,text,text,text)'),
 ('public.advance_personal_calendar_sync(uuid,text,uuid,uuid,text,jsonb)'),
 ('app_private.personal_calendar_project_source(uuid,uuid)'),
 ('public.find_personal_calendar_receipt_event(uuid,text,uuid)'),
 ('app_private.personal_calendar_connection_revision(uuid,uuid)');
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app_private.personal_calendar_sync_receipts'::regclass
  AND conname = 'personal_calendar_sync_receipts_phase_check' AND pg_get_constraintdef(oid) LIKE '%updating%'), 'receipts accept the updating phase');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM update_functions f, unnest(ARRAY['anon','authenticated']) r
  WHERE has_function_privilege(r, f.signature, 'EXECUTE')), 'browser roles cannot invoke update or helper functions');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM update_functions f JOIN pg_proc p ON p.oid = f.signature::regprocedure,
  aclexplode(p.proacl) a WHERE a.grantee = 0), 'no update function keeps a PUBLIC execute grant');
SELECT extensions.ok((SELECT bool_and(has_function_privilege('service_role', f.signature, 'EXECUTE')) FROM update_functions f), 'service role can invoke every update function');
SELECT extensions.ok((SELECT bool_and(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM update_functions f
  JOIN pg_proc p ON p.oid = f.signature::regprocedure), 'update functions are invokers with an empty search path');

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT ('fd000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', 'calendar-update-' || n || '@example.test', now(), '{}', '{}', now(), now() FROM generate_series(1,2) n;
INSERT INTO public.user_calendar_connections(id,user_id,provider,access_token,refresh_token,token_expires_at,calendar_email,is_active,preferences,granted_scopes,connection_type)
SELECT ('fd300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('fd000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
 'google','fictional-access','fictional-refresh',now()+interval '1 hour','calendar-update-' || n || '@example.test',true,
 '{"volunteering_calendar_id":"legacy@example.test"}','https://www.googleapis.com/auth/calendar.app.created','calendar' FROM generate_series(1,2) n;
INSERT INTO public.user_google_oauth_connection_bindings(connection_id,user_id,provider,purpose)
SELECT ('fd300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('fd000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'google', 'personal_calendar' FROM generate_series(1,2) n;
-- 1 modern, 2 legacy marker, 3 never synced, 4 draft, 5 interrupted create, 6 deletion fence, 7 cancelled.
INSERT INTO public.projects (id, creator_id, title, location, description, event_type, verification_method, schedule, require_login, status, visibility, workflow_status, creator_calendar_event_id)
SELECT ('fd100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'fd000000-0000-4000-8000-000000000001', 'Synthetic update project', 'Local', 'Synthetic', 'oneTime', 'manual',
 '{"oneTime":{"date":"2030-10-10","startTime":"10:00","endTime":"12:00","volunteers":20}}', true,
 CASE WHEN n = 7 THEN 'cancelled' ELSE 'upcoming' END, 'public', CASE WHEN n = 4 THEN 'draft' ELSE 'published' END,
 CASE n WHEN 2 THEN 'legacyupdate2' WHEN 4 THEN 'draftevent04' WHEN 6 THEN 'legacyupdate6' WHEN 7 THEN 'cancelevent7' END
FROM generate_series(1,7) n;
CREATE TEMP TABLE update_results (label text PRIMARY KEY, data jsonb);
GRANT ALL ON update_results TO service_role;
CREATE FUNCTION pg_temp.source(p_project uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT app_private.personal_calendar_project_source(p_project, 'fd000000-0000-4000-8000-000000000001');
$$;
CREATE FUNCTION pg_temp.claim_update(p_label text, p_project uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
 v := public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001', p_project, pg_temp.source(p_project));
 INSERT INTO update_results VALUES (p_label, v);
 RETURN v;
END$$;
CREATE FUNCTION pg_temp.advance_update(p_label text, p_step text, p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.advance_personal_calendar_sync((data->>'user_id')::uuid, data->>'source_kind', (data->>'source_id')::uuid, (data->>'claim_token')::uuid, p_step, p_payload) FROM update_results WHERE label = p_label;
$$;
CREATE FUNCTION pg_temp.plan(p_calendar text, p_connection text, p_events jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('calendar_id', p_calendar, 'connection_id', p_connection, 'events', p_events));
$$;
SET LOCAL ROLE service_role;

-- Claim boundary.
SELECT extensions.ok(public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000003',pg_temp.source('fd100000-0000-4000-8000-000000000003')) IS NULL, 'a never-synced project claims nothing');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000003'), 0::bigint, 'a never-synced project gains no receipt');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000002','fd100000-0000-4000-8000-000000000001',pg_temp.source('fd100000-0000-4000-8000-000000000001'))$$, 'P0002', NULL, 'another actor cannot claim a creator project update');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','[]')$$, '22023', NULL, 'a malformed expected source is refused');

INSERT INTO update_results VALUES ('create', public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000001','sync'));
DO $$BEGIN
 PERFORM pg_temp.advance_update('create','plan','{"calendar_id":"owned@example.test","events":[{"id":"updevent01","event":{"summary":"Old one"}},{"id":"updevent02","event":{"summary":"Old two"}}]}');
 PERFORM pg_temp.advance_update('create','confirm','{"event_id":"updevent01"}');
 PERFORM pg_temp.advance_update('create','confirm','{"event_id":"updevent02"}');
 PERFORM pg_temp.advance_update('create','finish');
END$$;
SELECT extensions.ok((SELECT creator_synced_at IS NOT NULL FROM public.projects WHERE id='fd100000-0000-4000-8000-000000000001'), 'fixture create settles through the replaced functions');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001',pg_temp.source('fd100000-0000-4000-8000-000000000001') || '{"title":"Stale title"}')$$, '55000', NULL, 'a stale service read of the project is refused');
SELECT extensions.is((SELECT phase FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000001'), 'synced', 'a refused claim leaves the receipt settled');
SELECT extensions.is(pg_temp.claim_update('u1','fd100000-0000-4000-8000-000000000001')->>'phase', 'updating', 'a current read claims the updating phase');
SELECT extensions.ok((SELECT u.data->>'generation' = c.data->>'generation' AND u.data->>'calendar_id' = 'owned@example.test' FROM update_results u, update_results c WHERE u.label='u1' AND c.label='create'), 'the update keeps its generation and calendar');
SELECT extensions.is((SELECT jsonb_agg(e->>'id') FROM update_results u, jsonb_array_elements(u.data->'events') e WHERE u.label='u1'), '["updevent01","updevent02"]'::jsonb, 'the update keeps every event ID');
SELECT extensions.ok((SELECT data->'confirmed_event_ids' = '[]'::jsonb AND data->'update_source' = pg_temp.source('fd100000-0000-4000-8000-000000000001') FROM update_results WHERE label='u1'), 'a new plan resets confirmations and freezes the locked source');
SELECT extensions.ok((SELECT creator_synced_at IS NULL AND creator_calendar_event_id = 'updevent01' FROM public.projects WHERE id='fd100000-0000-4000-8000-000000000001'), 'an update in flight keeps the marker without claiming success');
SELECT extensions.throws_ok($$SELECT pg_temp.claim_update('busy','fd100000-0000-4000-8000-000000000001')$$, '55P03', NULL, 'a second update cannot acquire the active lease');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'updevent01')$$, '55P03', NULL, 'removal cannot acquire the active update lease');

-- Plan boundary.
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','finish')$$, '55000', NULL, 'an unplanned update cannot finish on old confirmations');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','confirm','{"event_id":"updevent01"}')$$, '55000', NULL, 'an unplanned update cannot confirm an event');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}}]'))$$, '55000', NULL, 'a changed occurrence count is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"replacement","event":{"summary":"New two"}}]'))$$, '22023', NULL, 'a replacement event ID is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('other@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":{"summary":"New two"}}]'))$$, '22023', NULL, 'a replacement calendar is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000002','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":{"summary":"New two"}}]'))$$, '42501', NULL, 'another account connection cannot pin the plan');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":{"summary":"New two"}}]') || '{"connection_updated_at":"2000-01-01T00:00:00Z"}')$$, '42501', NULL, 'a credential read at another connection revision cannot pin the plan');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test',NULL,'[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":{"summary":"New two"}}]'))$$, '22023', NULL, 'a plan without a connection is refused');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":null}]'))$$, '22023', NULL, 'every replacement needs a payload');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"New one"}},{"id":"updevent02","event":{"summary":"New two"}}]'))$$, 'same-ID replacements are saved together');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"Third"}},{"id":"updevent02","event":{"summary":"Third"}}]'))$$, '22023', NULL, 'a saved update plan cannot be replaced under the same claim');
SELECT extensions.is((SELECT events->1->'event'->>'summary' FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000001'), 'New two', 'the frozen replacement payload is stored');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','confirm','{"event_id":"unrelated"}')$$, '22023', NULL, 'confirmation cannot add unknown IDs');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_update('u1','confirm','{"event_id":"updevent01"}')$$, 'the first updated event can be confirmed');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','finish')$$, '55000', NULL, 'a partial update cannot finish');
SELECT extensions.ok((SELECT creator_synced_at IS NULL FROM public.projects WHERE id='fd100000-0000-4000-8000-000000000001'), 'a partial update is not stamped synced');
DO $$BEGIN PERFORM pg_temp.advance_update('u1','release'); END$$;

-- Resume, stale source and replan.
SELECT extensions.ok((SELECT r->>'phase' = 'updating' AND r->'confirmed_event_ids' = '["updevent01"]'::jsonb AND r->>'update_planned_at' IS NOT NULL
  FROM (SELECT pg_temp.claim_update('u2','fd100000-0000-4000-8000-000000000001') AS r) x), 'a retry resumes the frozen plan and its confirmations');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u1','renew')$$, '55000', NULL, 'a stale update claim is fenced');
UPDATE public.projects SET title='Changed during update' WHERE id='fd100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u2','renew')$$, '55000', NULL, 'a changed source stops the next provider write');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u2','confirm','{"event_id":"updevent02"}')$$, '55000', NULL, 'a changed source refuses a late confirmation');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_update('u2','release')$$, 'a stale worker can still release its lease');
SELECT extensions.ok((SELECT r->'confirmed_event_ids' = '[]'::jsonb AND r->>'update_planned_at' IS NULL AND r->'update_source'->>'title' = 'Changed during update'
  FROM (SELECT pg_temp.claim_update('u3','fd100000-0000-4000-8000-000000000001') AS r) x), 'a changed source is replanned against the newly locked project');
SELECT extensions.ok((SELECT u.data->>'generation' = c.data->>'generation' AND u.data->'events'->0->>'id' = 'updevent01' AND u.data->'events'->1->>'id' = 'updevent02'
  FROM update_results u, update_results c WHERE u.label='u3' AND c.label='create'), 'a replan keeps the generation and event IDs');
DO $$BEGIN
 PERFORM pg_temp.advance_update('u3','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"Newest one"}},{"id":"updevent02","event":{"summary":"Newest two"}}]'));
 PERFORM pg_temp.advance_update('u3','confirm','{"event_id":"updevent01"}');
 PERFORM pg_temp.advance_update('u3','confirm','{"event_id":"updevent02"}');
END$$;
UPDATE public.projects SET location='Moved' WHERE id='fd100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','finish')$$, '55000', NULL, 'a fully confirmed stale plan cannot stamp the current project');
SELECT extensions.ok((SELECT creator_synced_at IS NULL FROM public.projects WHERE id='fd100000-0000-4000-8000-000000000001'), 'the current project stays unsynced after a stale finish');
UPDATE public.projects SET location='Local' WHERE id='fd100000-0000-4000-8000-000000000001';

-- Connection fence before writes and the terminal acknowledgement.
UPDATE public.user_calendar_connections SET calendar_email='rebound@example.test' WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','renew')$$, '42501', NULL, 'the same connection ID bound to another identity cannot renew for a write');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','finish')$$, '42501', NULL, 'the same connection ID bound to another identity cannot acknowledge success');
UPDATE public.user_calendar_connections SET calendar_email='calendar-update-1@example.test' WHERE id='fd300000-0000-4000-8000-000000000001';
UPDATE public.user_calendar_connections SET is_active=false WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','renew')$$, '42501', NULL, 'a disconnected account cannot renew for another write');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','finish')$$, '42501', NULL, 'a disconnected account cannot acknowledge success');
UPDATE public.user_calendar_connections SET is_active=true WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.is(pg_temp.advance_update('u3','finish')->>'phase', 'synced', 'all confirmations settle the update');
SELECT extensions.ok((SELECT creator_synced_at IS NOT NULL AND creator_calendar_event_id = 'updevent01' FROM public.projects WHERE id='fd100000-0000-4000-8000-000000000001'), 'completion timestamps the source under its original marker');
SELECT extensions.ok((SELECT update_source IS NULL AND update_planned_at IS NULL AND update_connection_id IS NULL AND claim_token IS NULL AND lease_until IS NULL
  FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000001'), 'completion clears the update state and lease');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u3','renew')$$, '55000', NULL, 'a settled update cannot be advanced again');
SELECT extensions.is(public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000001','sync')->>'phase', 'synced', 'a create replay on a settled receipt stays a no-op');

-- A changed connection restarts confirmations.
DO $$BEGIN
 PERFORM pg_temp.claim_update('u4','fd100000-0000-4000-8000-000000000001');
 PERFORM pg_temp.advance_update('u4','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"Again one"}},{"id":"updevent02","event":{"summary":"Again two"}}]'));
 PERFORM pg_temp.advance_update('u4','confirm','{"event_id":"updevent01"}');
 PERFORM pg_temp.advance_update('u4','release');
END$$;
UPDATE public.user_calendar_connections SET is_active=false WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.ok((SELECT r->'confirmed_event_ids' = '[]'::jsonb AND r->>'update_planned_at' IS NULL AND r->>'update_connection_id' IS NULL
  FROM (SELECT pg_temp.claim_update('u5','fd100000-0000-4000-8000-000000000001') AS r) x), 'confirmations made under a lost connection are not reused');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('u5','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"Again one"}},{"id":"updevent02","event":{"summary":"Again two"}}]'))$$, '42501', NULL, 'a disconnected account cannot save an update plan');
UPDATE public.user_calendar_connections SET is_active=true WHERE id='fd300000-0000-4000-8000-000000000001';
DO $$BEGIN
 PERFORM pg_temp.advance_update('u5','release');
 PERFORM pg_temp.claim_update('u6','fd100000-0000-4000-8000-000000000001');
 PERFORM pg_temp.advance_update('u6','plan',pg_temp.plan('owned@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"updevent01","event":{"summary":"Again one"}},{"id":"updevent02","event":{"summary":"Again two"}}]'));
 PERFORM pg_temp.advance_update('u6','confirm','{"event_id":"updevent01"}');
 PERFORM pg_temp.advance_update('u6','release');
END$$;
UPDATE public.user_calendar_connections SET calendar_email='rebound@example.test' WHERE id='fd300000-0000-4000-8000-000000000001';
SELECT extensions.ok((SELECT r->'confirmed_event_ids' = '[]'::jsonb AND r->>'update_planned_at' IS NULL AND r->>'update_connection_revision' IS NULL
   AND r->'events'->0->>'id' = 'updevent01' AND r->'events'->1->>'id' = 'updevent02'
  FROM (SELECT pg_temp.claim_update('u7','fd100000-0000-4000-8000-000000000001') AS r) x), 'a same-ID rebind replans the same events instead of trusting earlier confirmations');
UPDATE public.user_calendar_connections SET calendar_email='calendar-update-1@example.test' WHERE id='fd300000-0000-4000-8000-000000000001';
DO $$BEGIN PERFORM pg_temp.advance_update('u7','release'); END$$;

-- Create and removal claims around an unfinished update.
SELECT extensions.ok((SELECT r->>'phase' = 'updating' AND r->'claim_token' = 'null'::jsonb
  FROM (SELECT public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000001','sync') AS r) x), 'a create claim reports an unfinished update without a claim token');
SELECT extensions.ok((SELECT lease_until IS NULL AND phase = 'updating' FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000001'), 'a create claim takes no lease on an unfinished update');
INSERT INTO update_results VALUES ('rm', public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'updevent01'));
SELECT extensions.ok((SELECT data->>'phase' = 'removing' AND data->'update_source' = 'null'::jsonb AND data->'events'->1->>'id' = 'updevent02' FROM update_results WHERE label='rm'), 'removal supersedes an unfinished update with every planned ID');
DO $$BEGIN PERFORM pg_temp.advance_update('rm','release'); END$$;
SELECT extensions.throws_ok($$SELECT pg_temp.claim_update('during-remove','fd100000-0000-4000-8000-000000000001')$$, '55000', NULL, 'an unsettled removal refuses updates');
INSERT INTO update_results VALUES ('rm2', public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'updevent01'));
DO $$BEGIN
 PERFORM pg_temp.advance_update('rm2','confirm','{"event_id":"updevent01"}');
 PERFORM pg_temp.advance_update('rm2','confirm','{"event_id":"updevent02"}');
 PERFORM pg_temp.advance_update('rm2','finish');
END$$;
SELECT extensions.ok(pg_temp.claim_update('after-remove','fd100000-0000-4000-8000-000000000001') IS NULL, 'a settled removal leaves nothing to update');
SELECT extensions.ok(public.find_personal_calendar_receipt_event('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000001') IS NULL, 'a settled removal is not an unresolved receipt');

-- Legacy single marker.
SELECT extensions.ok((SELECT r->>'phase' = 'updating' AND r->>'legacy_event_id' = 'legacyupdate2' AND r->>'calendar_id' IS NULL AND r->'events' = '[]'::jsonb
  FROM (SELECT pg_temp.claim_update('l1','fd100000-0000-4000-8000-000000000002') AS r) x), 'a legacy marker is adopted without a destination or plan');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('l1','plan',pg_temp.plan('other@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"legacyupdate2","event":{"summary":"Legacy new"}}]'))$$, '42501', NULL, 'a legacy update cannot target a calendar the connection never stored');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('l1','plan',pg_temp.plan('primary','fd300000-0000-4000-8000-000000000001','[{"id":"legacyupdate2","event":{"summary":"Legacy new"}}]'))$$, '22023', NULL, 'a legacy update cannot target the primary calendar');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('l1','plan',pg_temp.plan('legacy@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"legacyupdate2","event":{"summary":"Legacy new"}},{"id":"legacyextra1","event":{"summary":"Extra"}}]'))$$, '55000', NULL, 'a legacy update covers exactly its one known event');
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('l1','plan',pg_temp.plan('legacy@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"legacyother2","event":{"summary":"Legacy new"}}]'))$$, '22023', NULL, 'a legacy update cannot name another event');
SELECT extensions.lives_ok($$SELECT pg_temp.advance_update('l1','plan',pg_temp.plan('legacy@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"legacyupdate2","event":{"summary":"Legacy new"}}]'))$$, 'a legacy update pins the stored destination and known ID');
DO $$BEGIN PERFORM pg_temp.advance_update('l1','confirm','{"event_id":"legacyupdate2"}'); END$$;
SELECT extensions.is(pg_temp.advance_update('l1','finish')->>'phase', 'synced', 'a confirmed legacy update settles');
SELECT extensions.ok((SELECT r.calendar_id = 'legacy@example.test' AND r.events->0->>'id' = 'legacyupdate2' AND r.legacy_event_id = 'legacyupdate2' AND r.generation::text = u.data->>'generation'
  FROM app_private.personal_calendar_sync_receipts r, update_results u WHERE r.source_id='fd100000-0000-4000-8000-000000000002' AND u.label='l1'), 'the legacy receipt keeps its ID and generation');
SELECT extensions.is(public.find_personal_calendar_receipt_event('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000002'), 'legacyupdate2', 'the owner can look up their unresolved receipt event');
SELECT extensions.ok(public.find_personal_calendar_receipt_event('fd000000-0000-4000-8000-000000000002','project','fd100000-0000-4000-8000-000000000002') IS NULL, 'another actor cannot look up that receipt');
SELECT extensions.is(public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project',NULL,'remove',NULL,'legacyupdate2')->>'phase', 'removing', 'an updated legacy entry is still removable by its ID');

-- Source eligibility and unsettled creates.
SELECT extensions.throws_ok($$SELECT pg_temp.claim_update('draft','fd100000-0000-4000-8000-000000000004')$$, '55000', NULL, 'an unpublished project refuses calendar updates');
SELECT extensions.throws_ok($$SELECT pg_temp.claim_update('cancelled','fd100000-0000-4000-8000-000000000007')$$, '55000', NULL, 'a cancelled project refuses calendar updates');
SELECT extensions.is((SELECT count(*) FROM app_private.personal_calendar_sync_receipts WHERE source_id IN ('fd100000-0000-4000-8000-000000000004','fd100000-0000-4000-8000-000000000007')), 0::bigint, 'a refused source records no update state');
INSERT INTO update_results VALUES ('p5', public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000005','sync'));
DO $$BEGIN PERFORM pg_temp.advance_update('p5','release'); END$$;
SELECT extensions.ok(pg_temp.claim_update('p5-unplanned','fd100000-0000-4000-8000-000000000005') IS NULL, 'a create with no saved plan has nothing to update');
INSERT INTO update_results VALUES ('p5b', public.claim_personal_calendar_sync('fd000000-0000-4000-8000-000000000001','project','fd100000-0000-4000-8000-000000000005','sync'));
DO $$BEGIN
 PERFORM pg_temp.advance_update('p5b','plan','{"calendar_id":"owned@example.test","events":[{"id":"p5event001","event":{"summary":"Planned"}}]}');
 PERFORM pg_temp.advance_update('p5b','release');
END$$;
SELECT extensions.throws_ok($$SELECT pg_temp.claim_update('p5-planned','fd100000-0000-4000-8000-000000000005')$$, '55000', NULL, 'an interrupted create must settle before an update');
SELECT extensions.is((SELECT phase FROM app_private.personal_calendar_sync_receipts WHERE source_id='fd100000-0000-4000-8000-000000000005'), 'syncing', 'a refused update leaves the interrupted create resumable');

-- Account deletion fence.
SELECT extensions.is(pg_temp.claim_update('d1','fd100000-0000-4000-8000-000000000006')->>'phase', 'updating', 'an active account can claim an update');
-- The project must keep anchoring the receipt's event before any step that leads to a write.
UPDATE public.projects SET creator_calendar_event_id='otheranchor6' WHERE id='fd100000-0000-4000-8000-000000000006';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('d1','plan',pg_temp.plan('legacy@example.test','fd300000-0000-4000-8000-000000000001','[{"id":"legacyupdate6","event":{"summary":"Legacy new"}}]'))$$, '55000', NULL, 'a changed event anchor refuses the update plan');
UPDATE public.projects SET creator_calendar_event_id=NULL WHERE id='fd100000-0000-4000-8000-000000000006';
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('d1','renew')$$, '55000', NULL, 'a cleared event anchor refuses renewal before a write');
UPDATE public.projects SET creator_calendar_event_id='legacyupdate6' WHERE id='fd100000-0000-4000-8000-000000000006';
SELECT extensions.lives_ok($$SELECT pg_temp.advance_update('d1','renew')$$, 'the restored anchor and unchanged source renew again');
RESET ROLE;
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
VALUES ('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','self_delete','database_pending');
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT pg_temp.advance_update('d1','renew')$$, '42501', NULL, 'pending deletion stops an update in flight');
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000002','{}')$$, '42501', NULL, 'pending deletion prevents new update claims');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','{}')$$, '42501', NULL, 'an authenticated role cannot claim an update');
SELECT extensions.throws_ok($$SELECT app_private.personal_calendar_project_source('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001')$$, '42501', NULL, 'an authenticated role cannot read the source projection');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT extensions.throws_ok($$SELECT public.claim_personal_calendar_update('fd000000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','{}')$$, '42501', NULL, 'an anonymous role cannot claim an update');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
