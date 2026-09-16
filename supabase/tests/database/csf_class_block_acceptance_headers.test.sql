BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

-- The officers' class block gains a column whenever a semester gains a
-- meeting. The receipt must not read that as a change the officer has to
-- accept again.
CREATE TEMP TABLE block AS
SELECT
  jsonb_build_array(
    'Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected',
    'Activity 1', 'Activity 2', 'October Meeting',
    'All Meeting Attendance', 'All Reqs Met', 'Source version'
  ) AS one_meeting,
  jsonb_build_array(
    'Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected',
    'Activity 1', 'Activity 2', 'October Meeting', 'November Meeting',
    'All Meeting Attendance', 'All Reqs Met', 'Source version'
  ) AS two_meetings,
  jsonb_build_array(
    'Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected',
    'Activity 1', 'Activity 2', 'October Meeting',
    'All Meeting Attendance', 'All Reqs Met', 'Comments', 'Source version'
  ) AS with_comments,
  jsonb_build_array(
    'Profile ID', 'Profile', 'Account connection', 'Application status',
    'Semester enrollment', 'Verified points', 'Semester completion',
    'Source version'
  ) AS legacy_block;

SELECT extensions.is(
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', one_meeting) FROM block),
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', two_meetings) FROM block),
  'a meeting added mid-semester does not change the accepted header receipt'
);
SELECT extensions.isnt(
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', one_meeting) FROM block),
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', with_comments) FROM block),
  'adding a Comments column is a change to the fixed end and needs acceptance'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', one_meeting)->'prefix' FROM block),
  jsonb_build_array('Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected'),
  'the receipt still pins the five identity columns'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', one_meeting)->'suffix' FROM block),
  jsonb_build_array('All Meeting Attendance', 'All Reqs Met', 'Source version'),
  'the receipt still pins the summary and version columns'
);

-- Fail safe: anything that is not a recognisable officers' block keeps
-- comparing on the exact array, so no older acceptance is loosened.
SELECT extensions.is(
  (SELECT plugin_data.csf_sheet_acceptance_headers('class', legacy_block) FROM block),
  (SELECT legacy_block FROM block),
  'an older eight-column class block is still pinned exactly'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_sheet_acceptance_headers('application', one_meeting) FROM block),
  (SELECT one_meeting FROM block),
  'a non-class destination is still pinned exactly'
);
SELECT extensions.is(
  plugin_data.csf_sheet_acceptance_headers(
    'class',
    jsonb_build_array('Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected', 'Activity 1')
  ),
  jsonb_build_array('Profile ID', 'Last', 'First', 'LastFirst', 'Let''s Assist Connected', 'Activity 1'),
  'a class block with no summary column is pinned exactly rather than reduced'
);

-- The guarantee end to end: a live class destination whose officer accepted a
-- copied-workbook journey keeps that acceptance when the semester gains a
-- meeting, and loses it when the fixed end of the block changes.
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES
  ('fa000000-0000-4000-8000-000000000001','authenticated','authenticated','block-admin@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code)
  VALUES('fa100000-0000-4000-8000-000000000001','Block fixtures','block-fixtures','school','739992');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
  VALUES('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
  VALUES('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','F30','Fall 2030','2030-2031','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
  VALUES('fa500000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',2033,'Class of 2033');
INSERT INTO plugin_data.csf_sheet_sync_destinations(
  id,organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by,managed_headers
) SELECT 'fa400000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fictional-class-copy',0,'class',
  'fa500000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001',false,'fa000000-0000-4000-8000-000000000001',
  one_meeting FROM block;

-- The officer's receipt, recorded exactly as csf_record_sheet_sync_acceptance
-- would record it for this destination.
INSERT INTO plugin_data.csf_sheet_sync_acceptances(
  organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason
) SELECT d.organization_id, d.id, d.organization_id, 'fa000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,
    'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,
    'headers',plugin_data.csf_sheet_acceptance_headers(d.kind,d.managed_headers),
    'scope',jsonb_build_object(
      'graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),
      'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),
      'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)))
  || plugin_data.csf_sheet_discussion_configuration(d.id),
  jsonb_build_object('test_configurations', '{}'::jsonb), 'fixture'
FROM plugin_data.csf_sheet_sync_destinations d WHERE d.id='fa400000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_set_sheet_sync_destination_state(
    'fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',true,true,'available')
$$, 'the accepted class destination enables');

UPDATE plugin_data.csf_sheet_sync_destinations
  SET managed_headers = (SELECT two_meetings FROM block), enabled = false
  WHERE id='fa400000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_set_sheet_sync_destination_state(
    'fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',true,true,'available')
$$, 'a meeting added mid-semester does not revoke the officer''s acceptance');

UPDATE plugin_data.csf_sheet_sync_destinations
  SET managed_headers = (SELECT with_comments FROM block), enabled = false
  WHERE id='fa400000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_set_sheet_sync_destination_state(
    'fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001',
    'fa400000-0000-4000-8000-000000000001',true,true,'available')
$$, 'Review a complete copied-workbook test journey before enabling live sync.',
  'changing the fixed end of the block still demands a fresh acceptance');

SELECT * FROM finish();
ROLLBACK;
