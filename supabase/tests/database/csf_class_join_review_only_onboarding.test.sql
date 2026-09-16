-- Scanning a class QR never mints a record, and only an exact name self-links.
--
-- Three claims:
--   * an unmatched student reaches the officer queue with no profile created;
--   * a tolerant (prefix) name match reaches the queue too, while the exact
--     match in the same class self-links;
--   * the declared new/returning intent lands on the student's own unresolved
--     request and nowhere else.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the server role can record a declared member intent'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anon cannot record a declared member intent'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_record_class_join_member_intent(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot record a declared member intent'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cf100000-0000-4000-8000-000000000001','authenticated','authenticated','owner@local.test',now(),'{}','{}',now(),now()),
  ('cf100000-0000-4000-8000-000000000002','authenticated','authenticated','stranger@local.test',now(),'{}','{}',now(),now()),
  ('cf100000-0000-4000-8000-000000000003','authenticated','authenticated','prefix@local.test',now(),'{}','{}',now(),now()),
  ('cf100000-0000-4000-8000-000000000004','authenticated','authenticated','exact@local.test',now(),'{}','{}',now(),now()),
  ('cf100000-0000-4000-8000-000000000005','authenticated','authenticated','other@local.test',now(),'{}','{}',now(),now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('cf200000-0000-4000-8000-000000000001','Review Only Test','review-only-test','school','984011');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES ('cf300000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001',2030,'Class of 2030');

CREATE TEMP TABLE review_only_code AS
SELECT plugin_data.csf_rotate_class_join_code(
  'cf200000-0000-4000-8000-000000000001',
  'cf300000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001'
) ->> 'code' AS code;
CREATE TEMP TABLE review_only_code_id AS
SELECT id FROM plugin_data.csf_class_join_codes
WHERE organization_id = 'cf200000-0000-4000-8000-000000000001'
  AND cohort_id = 'cf300000-0000-4000-8000-000000000001'
  AND status = 'active';

-- Saisampath is on the roster; nobody named Nobody Here is.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('cf400000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','Saisampath','Uppu','saisampath','uppu'),
  ('cf400000-0000-4000-8000-000000000002','cf200000-0000-4000-8000-000000000001','Exact','Person','exact','person');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001','active'),
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000002','cf300000-0000-4000-8000-000000000001','active');

-- 1. Nothing matches: review, no profile, no account link.
CREATE TEMP TABLE review_only_results (scenario text, payload jsonb);
INSERT INTO review_only_results VALUES ('unmatched', plugin_data.csf_join_class_by_code(
  'cf200000-0000-4000-8000-000000000001',(SELECT code FROM review_only_code),
  'cf100000-0000-4000-8000-000000000002','stranger@local.test','Nobody','Here',NULL));
SELECT extensions.is((SELECT payload->>'needsReview' FROM review_only_results WHERE scenario='unmatched'),'true','an unmatched student reaches officer review');
SELECT extensions.is((SELECT payload->>'connected' FROM review_only_results WHERE scenario='unmatched'),'false','an unmatched student is not connected');
SELECT extensions.is((SELECT payload->>'profileId' FROM review_only_results WHERE scenario='unmatched'),NULL,'an unmatched join names no record');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profiles WHERE organization_id='cf200000-0000-4000-8000-000000000001'),
  2::bigint,'the roster still holds only the records staff put there');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id='cf200000-0000-4000-8000-000000000001'),
  0::bigint,'an unmatched join creates no account link');
SELECT extensions.is(
  (SELECT count(*) FROM public.organization_members WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002' AND status='active'),
  1::bigint,'a waiting student still reaches the class feed');

-- 2. Intent is recorded on that request, and only by its owner.
SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000002','new')->>'recorded',
  'true','the student who filed the request can declare their intent');
SELECT extensions.is(
  (SELECT submitted_returning_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002'),
  'new','the declared intent reaches the request an officer reviews');
SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000002','returning')->>'recorded',
  'true','a student may correct their own declaration');
SELECT extensions.is(
  (SELECT submitted_returning_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002'),
  'returning','the correction replaces the earlier declaration');
-- A double-click, a retry, or a resubmitted form says the same thing. It must
-- be answered, not rewritten: officers read `updated_at` as "something
-- changed", and a second audit row would claim a decision that never happened.
CREATE TEMP TABLE intent_replay_state AS
SELECT updated_at FROM plugin_data.csf_profile_link_requests
WHERE organization_id='cf200000-0000-4000-8000-000000000001'
  AND user_id='cf100000-0000-4000-8000-000000000002';
SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000002','returning')->>'replayed',
  'true','declaring the same intent again is a replay');
SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000002','returning')->>'recorded',
  'true','and still reports the declaration as held');
SELECT extensions.is(
  (SELECT updated_at FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002'),
  (SELECT updated_at FROM intent_replay_state),
  'an unchanged declaration does not touch the request');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_admin_audit_events
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND action='class.join_code.member_intent_declared'),
  2::bigint,'and writes no second audit row');

SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000005','new')->>'recorded',
  'false','another account cannot declare an intent on someone else''s request');
SELECT extensions.throws_ok(
  $q$SELECT plugin_data.csf_record_class_join_member_intent('cf200000-0000-4000-8000-000000000001',(SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),'cf100000-0000-4000-8000-000000000002','officer')$q$,
  'P0001',NULL,'only new or returning may be declared');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_admin_audit_events
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND action='class.join_code.member_intent_declared'),
  2::bigint,'each real change is audited exactly once');
-- Both audit rows are written inside this one transaction, so `created_at` is
-- the same transaction timestamp for both and `id` is a random uuid: there is
-- no "latest" to order by. Each row is identified by the declaration it
-- records instead, which also proves the chain rather than just its last link.
SELECT extensions.is(
  (SELECT before_data->>'memberIntent' FROM plugin_data.csf_admin_audit_events
   WHERE organization_id='cf200000-0000-4000-8000-000000000001'
     AND action='class.join_code.member_intent_declared'
     AND after_data->>'memberIntent'='new'),
  'unknown','the first declaration records the undeclared state it replaced');
SELECT extensions.is(
  (SELECT before_data->>'memberIntent' FROM plugin_data.csf_admin_audit_events
   WHERE organization_id='cf200000-0000-4000-8000-000000000001'
     AND action='class.join_code.member_intent_declared'
     AND after_data->>'memberIntent'='returning'),
  'new','the correction records what it changed from');

-- A settled request is closed to this: staff own the outcome from there.
UPDATE plugin_data.csf_profile_link_requests SET match_status='resolved'
  WHERE organization_id='cf200000-0000-4000-8000-000000000001'
    AND user_id='cf100000-0000-4000-8000-000000000002';
SELECT extensions.is(
  plugin_data.csf_record_class_join_member_intent(
    'cf200000-0000-4000-8000-000000000001',
    (SELECT (payload->>'requestId')::uuid FROM review_only_results WHERE scenario='unmatched'),
    'cf100000-0000-4000-8000-000000000002','new')->>'recorded',
  'false','a resolved request no longer accepts a declaration');
SELECT extensions.is(
  (SELECT submitted_returning_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002'),
  'returning','and the settled declaration is left as staff found it');
UPDATE plugin_data.csf_profile_link_requests SET match_status='needs_review'
  WHERE organization_id='cf200000-0000-4000-8000-000000000001'
    AND user_id='cf100000-0000-4000-8000-000000000002';

-- 3. A name is never ownership. Not a prefix, and not an exact match either:
--    the attacker case is a classmate who knows a name and has the same code.
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000003','prefix@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Sai Uppu',
    encode(extensions.digest(convert_to('Sai Uppu','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','a first-name prefix match is an officer request, not a connection');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND profile_id='cf400000-0000-4000-8000-000000000001'),
  0::bigint,'a prefix match leaves the record unclaimed');
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000004','exact@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Exact Person',
    encode(extensions.digest(convert_to('Exact Person','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','an exact name with no curated contact is still only a suggestion');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND profile_id='cf400000-0000-4000-8000-000000000002'),
  0::bigint,'an exact name match alone creates no verified connection');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND connection_basis='self_confirmed_account_name'),
  0::bigint,'no path mints a self-confirmed name connection');

-- A student typing their own application address does not get in either: that
-- column is unverified by policy.
UPDATE plugin_data.csf_profiles
  SET reported_application_personal_email='reported@local.test'
  WHERE id='cf400000-0000-4000-8000-000000000001';
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('cf100000-0000-4000-8000-000000000006','authenticated','authenticated','reported@local.test',now(),'{}','{}',now(),now());
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000006','reported@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Saisampath Uppu',
    encode(extensions.digest(convert_to('Saisampath Uppu','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','a self-reported application address is not ownership proof');

-- 4. A curated contact an officer put on the record is. One record only.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, school_email, normalized_school_email
) VALUES (
  'cf400000-0000-4000-8000-000000000003','cf200000-0000-4000-8000-000000000001',
  'Curated','Contact','curated','contact','curated@local.test','curated@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000003','cf300000-0000-4000-8000-000000000001','active');
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('cf100000-0000-4000-8000-000000000007','authenticated','authenticated','curated@local.test',now(),'{}','{}',now(),now());

-- First prove a shared address blocks it, then remove the collision.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, reported_application_personal_email
) VALUES (
  'cf400000-0000-4000-8000-000000000004','cf200000-0000-4000-8000-000000000001',
  'Sibling','Contact','sibling','contact','curated@local.test');
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000003',
    'cf100000-0000-4000-8000-000000000007','curated@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Curated Contact',
    encode(extensions.digest(convert_to('Curated Contact','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','an address shared with another active record goes to an officer');
-- Clear the shared address rather than retiring the record: `record_status`
-- only admits 'active' or 'merged', and merging would need a whole merge
-- state. Dropping the contact is the narrower change and is what an officer
-- correcting a mistyped sibling address would actually do.
UPDATE plugin_data.csf_profiles SET reported_application_personal_email=NULL
  WHERE id='cf400000-0000-4000-8000-000000000004';
-- The blocked attempt left a needs_review request; clear it so the retry is a
-- fresh decision rather than the replay branch.
DELETE FROM plugin_data.csf_profile_link_requests
  WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000007';
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000003',
    'cf100000-0000-4000-8000-000000000007','curated@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Curated Contact',
    encode(extensions.digest(convert_to('Curated Contact','UTF8'),'sha256'),'hex'))->>'connected',
  'true','a verified address matching one curated contact connects');
SELECT extensions.is(
  (SELECT connection_basis FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND profile_id='cf400000-0000-4000-8000-000000000003'),
  'verified_email','the only surviving automatic basis is the verified email');

-- 4b. The settled-request replay guard, exercised through the public wrapper.
--     Revoking the link leaves the request saying 'auto_linked', so the
--     confirmation body's replay branch answers "connected" from that alone.
--     Only csf_revalidate_class_code_connection_replay, which the wrapper runs
--     after the body, notices the link is gone. This is that path -- the
--     student's own settled request, not an unrelated record that happens to
--     carry a revoked account.
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000007'),
  'auto_linked','the connection settled its request');
UPDATE plugin_data.csf_profile_accounts SET status='revoked'
  WHERE organization_id='cf200000-0000-4000-8000-000000000001'
    AND profile_id='cf400000-0000-4000-8000-000000000003'
    AND user_id='cf100000-0000-4000-8000-000000000007';
CREATE TEMP TABLE revoked_settled_replay AS
SELECT plugin_data.csf_confirm_class_code_typed_name_match(
  'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000003',
  'cf100000-0000-4000-8000-000000000007','curated@local.test',
  (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
  'Curated Contact',
  encode(extensions.digest(convert_to('Curated Contact','UTF8'),'sha256'),'hex')) AS payload;
SELECT extensions.is(
  (SELECT payload->>'connected' FROM revoked_settled_replay),
  'false','a revoked link cannot replay as a connection');
SELECT extensions.is(
  (SELECT payload->>'connectionBasis' FROM revoked_settled_replay),
  NULL,'and the receipt claims no basis');
SELECT extensions.is(
  (SELECT match_status FROM plugin_data.csf_profile_link_requests
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000007'),
  'needs_review','the settled request is reopened for an officer');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001'
     AND profile_id='cf400000-0000-4000-8000-000000000003'
     AND status='verified'),
  0::bigint,'and the revoked link is not quietly restored');

-- 4c. A curated contact is necessary, not sufficient. Any account history on
--     the record means an officer has already had reason to look at it, so a
--     pending or revoked link keeps the record out of reach.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, school_email, normalized_school_email
) VALUES
  ('cf400000-0000-4000-8000-000000000006','cf200000-0000-4000-8000-000000000001',
   'Pending','Hold','pending','hold','pending-hold@local.test','pending-hold@local.test'),
  ('cf400000-0000-4000-8000-000000000007','cf200000-0000-4000-8000-000000000001',
   'Revoked','Hold','revoked','hold','revoked-hold@local.test','revoked-hold@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000006','cf300000-0000-4000-8000-000000000001','active'),
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000007','cf300000-0000-4000-8000-000000000001','active');
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('cf100000-0000-4000-8000-000000000008','authenticated','authenticated','pending-hold@local.test',now(),'{}','{}',now(),now()),
  ('cf100000-0000-4000-8000-000000000009','authenticated','authenticated','revoked-hold@local.test',now(),'{}','{}',now(),now());
-- Somebody else's unsettled claim, and somebody else's withdrawn one.
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary, connection_basis)
VALUES
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000006','cf100000-0000-4000-8000-000000000002','pending',false,'unknown'),
  ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000007','cf100000-0000-4000-8000-000000000003','revoked',false,'unknown');
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000006',
    'cf100000-0000-4000-8000-000000000008','pending-hold@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Pending Hold',
    encode(extensions.digest(convert_to('Pending Hold','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','a record with a pending claim is not handed to a matching address');
SELECT extensions.is(
  plugin_data.csf_confirm_class_code_typed_name_match(
    'cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000007',
    'cf100000-0000-4000-8000-000000000009','revoked-hold@local.test',
    (SELECT id FROM review_only_code_id),'cf300000-0000-4000-8000-000000000001',
    'Revoked Hold',
    encode(extensions.digest(convert_to('Revoked Hold','UTF8'),'sha256'),'hex'))->>'needsReview',
  'true','a revoked link is history an officer must read, not a clean slate');
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001'
     AND user_id IN ('cf100000-0000-4000-8000-000000000008','cf100000-0000-4000-8000-000000000009')),
  0::bigint,'neither held record gains an account row');

-- 5. An officer-authorized link is untouched by any of this.
INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'cf400000-0000-4000-8000-000000000005','cf200000-0000-4000-8000-000000000001',
  'Officer','Linked','officer','linked');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id, profile_id, cohort_id, status)
VALUES ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000005','cf300000-0000-4000-8000-000000000001','active');
-- Staff connected this account, so it already carries organization access. The
-- join guard treats an account row without one as removed access.
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000005','member','active');
INSERT INTO plugin_data.csf_profile_accounts (organization_id, profile_id, user_id, status, is_primary, connection_basis)
VALUES ('cf200000-0000-4000-8000-000000000001','cf400000-0000-4000-8000-000000000005','cf100000-0000-4000-8000-000000000005','verified',true,'officer_decision');
SELECT extensions.is(
  (SELECT connection_basis FROM plugin_data.csf_profile_accounts
   WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND profile_id='cf400000-0000-4000-8000-000000000005'),
  'officer_decision','an officer-authorized connection is left exactly as staff made it');
SELECT extensions.is(
  plugin_data.csf_join_class_by_code(
    'cf200000-0000-4000-8000-000000000001',(SELECT code FROM review_only_code),
    'cf100000-0000-4000-8000-000000000005','other@local.test','Officer','Linked',NULL)->>'connected',
  'true','the officer-authorized account still returns through its class code');

SELECT * FROM extensions.finish();
ROLLBACK;
