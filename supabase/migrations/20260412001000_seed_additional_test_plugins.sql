-- Seed additional example plugins for tier testing in the organization plugin control plane.
-- Includes both global and private visibility tiers.

insert into public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  force_update_version,
  private_codebase,
  code_repository,
  code_reference,
  metadata,
  updated_at
)
values
  (
    'community-impact-radar',
    'Community Impact Radar',
    'Global test plugin that adds impact cards and lightweight dashboard insights for every organization.',
    'global',
    true,
    '0.1.0',
    null,
    true,
    'private://lets-assist-plugins/community-impact-radar',
    'main',
    jsonb_build_object(
      'example_plugin', true,
      'test_plugin', true,
      'tier', 'global'
    ),
    now()
  ),
  (
    'family-liaison-workbench',
    'Family Liaison Workbench',
    'Private test plugin for family intake and liaison workflows, intended for entitlement-based rollout.',
    'private',
    true,
    '0.1.0',
    null,
    true,
    'private://lets-assist-plugins/family-liaison-workbench',
    'main',
    jsonb_build_object(
      'example_plugin', true,
      'test_plugin', true,
      'tier', 'private'
    ),
    now()
  ),
  (
    'dv-speech-debate',
    'DV Speech & Debate Ops',
    'Custom signup forms, parent judge workflows, membership receipts, and tournament staffing for DV Speech & Debate.',
    'private',
    true,
    '0.3.0',
    null,
    true,
    'private://dv-speech-debate-plugin',
    'main',
    jsonb_build_object(
      'example_plugin', true,
      'tier', 'private'
    ),
    now()
  )
on conflict (key)
do update
set
  name = excluded.name,
  description = excluded.description,
  visibility = excluded.visibility,
  is_active = excluded.is_active,
  latest_version = excluded.latest_version,
  force_update_version = excluded.force_update_version,
  private_codebase = excluded.private_codebase,
  code_repository = excluded.code_repository,
  code_reference = excluded.code_reference,
  metadata = coalesce(public.plugins.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();