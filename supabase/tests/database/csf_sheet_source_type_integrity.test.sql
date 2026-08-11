BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(6);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_sheet_sources'::regclass
      AND conname = 'csf_sheet_sources_source_kind_agreement_check'
      AND contype = 'c'
  ),
  'Sheet sources enforce agreement between the typed source and legacy settings discriminator'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  'CSF Sheet Source Type Integrity',
  'csf-sheet-source-type-integrity',
  'school',
  '996101'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_sources (
      id, organization_id, source_type, title, settings
    ) VALUES (
      'de200000-0000-4000-8000-000000000001',
      'de100000-0000-4000-8000-000000000001',
      'meeting_attendance', 'Meeting attendance source',
      '{"sourceKind":"meeting_attendance","meetingId":"fixture-meeting"}'::jsonb
    )
  $$,
  'a meeting source can persist matching typed and JSON discriminators'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_sources (
      id, organization_id, source_type, title, settings
    ) VALUES (
      'de200000-0000-4000-8000-000000000002',
      'de100000-0000-4000-8000-000000000001',
      'partner_club_audit', 'Partner club source',
      '{"sourceKind":"partner_club_audit","partnerClubId":"fixture-club"}'::jsonb
    )
  $$,
  'a partner-club source can persist matching typed and JSON discriminators'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_sheet_sources
    WHERE organization_id = 'de100000-0000-4000-8000-000000000001'
      AND source_type IN ('meeting_attendance', 'partner_club_audit')
  ),
  2,
  'contextual sources remain queryable by their typed source discriminator'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_sheet_sources (
      organization_id, source_type, title, settings
    ) VALUES (
      'de100000-0000-4000-8000-000000000001',
      'class_history', 'Mislabeled meeting source',
      '{"sourceKind":"meeting_attendance"}'::jsonb
    )
  $$,
  '23514',
  'new row for relation "csf_sheet_sources" violates check constraint "csf_sheet_sources_source_kind_agreement_check"',
  'a meeting source cannot silently fall back to class history'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_sources
    SET source_type = 'class_history'
    WHERE id = 'de200000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'new row for relation "csf_sheet_sources" violates check constraint "csf_sheet_sources_source_kind_agreement_check"',
  'a partner-club source cannot drift after registration'
);

SELECT * FROM extensions.finish();
ROLLBACK;
