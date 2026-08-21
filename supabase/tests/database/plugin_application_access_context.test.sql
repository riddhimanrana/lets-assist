BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(31);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_plugin_application_access_context(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated callers can request their own plugin application access proof'
);
SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_csf_application_role_context(uuid,text)',
    'EXECUTE'
  ),
  'authenticated callers can request their own CSF role proof'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.get_plugin_application_access_context(uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot request plugin application access facts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.get_csf_application_role_context(uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot request CSF role facts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.plugin_stable_semver_key(text)',
    'EXECUTE'
  ),
  'the stable-version helper stays internal'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.plugin_host_api_version()',
    'EXECUTE'
  ),
  'the platform host API version stays internal'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'plugin-application-access@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'f0100000-0000-4000-8000-000000000001',
    'Plugin Application Access',
    'plugin-application-access',
    'school',
    '912301'
  ),
  (
    'f0100000-0000-4000-8000-000000000002',
    'Foreign Plugin Application Access',
    'foreign-plugin-access',
    'school',
    '912302'
  );

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'staff',
  'active'
);

INSERT INTO public.plugins (
  key, name, visibility, is_active, latest_version
) VALUES (
  'application-access-fixture',
  'Application Access Fixture',
  'private',
  false,
  '1.2.0'
);

INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity,
  host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
)
SELECT
  'application-access-fixture',
  release.version,
  'published',
  'Application access fixture.',
  repeat(release.hash_character, 40),
  repeat(release.hash_character, 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
  0,
  now(),
  repeat(release.hash_character, 40),
  repeat(release.hash_character, 64),
  '["apps/application-access-fixture"]'::jsonb,
  repeat(release.hash_character, 64),
  repeat(release.hash_character, 64),
  jsonb_build_object(
    'identity', 'https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/heads/development',
    'issuer', 'https://token.actions.githubusercontent.com',
    'attestationRef', 'release.sigstore.json'
  ),
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1,
  '20260820130000',
  release.install_contract,
  'application'
FROM (
  VALUES
    ('1.0.0', '1', '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb),
    ('1.1.0', '2', '{"minimum":"1.1.0","maximum":"1.1.0"}'::jsonb),
    ('1.2.0', '3', '{"minimum":"1.1.0","maximum":"1.2.0"}'::jsonb)
) AS release(version, hash_character, install_contract);

UPDATE public.plugins
SET is_active = true
WHERE key = 'application-access-fixture';

INSERT INTO public.organization_plugin_entitlements (
  organization_id, plugin_key, status, is_forced
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'application-access-fixture',
  'active',
  false
);

INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, enabled, installed_version
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'application-access-fixture',
  true,
  '1.1.0'
);

-- Model the first independently deployed CSF child without changing the real
-- embedded publication. The transaction rolls this fixture back.
INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity,
  host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'dvhs-csf',
  '1.2.0',
  'published',
  'CSF application access fixture.',
  repeat('4', 40),
  repeat('4', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
  0,
  now(),
  repeat('4', 40),
  repeat('4', 64),
  '["plugins/dvhs-csf","apps/csf"]'::jsonb,
  repeat('4', 64),
  repeat('4', 64),
  '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/heads/development","issuer":"https://token.actions.githubusercontent.com","attestationRef":"release.sigstore.json"}'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1,
  '20260820130000',
  '{"minimum":"1.1.0","maximum":"1.2.0"}'::jsonb,
  'application'
)
ON CONFLICT (plugin_key, version) DO NOTHING;

-- The real CSF release remains the authorization source for the local proof.
INSERT INTO public.organization_plugin_entitlements (
  organization_id, plugin_key, status, is_forced
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'dvhs-csf',
  'active',
  false
);
INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, enabled, installed_version
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'dvhs-csf',
  true,
  '1.1.0'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'f0200000-0000-4000-8000-000000000001',
  'f0100000-0000-4000-8000-000000000001',
  'fall-2026',
  'Fall 2026',
  '2026-2027',
  'fall',
  true
);
INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type
) VALUES (
  'f0300000-0000-4000-8000-000000000001',
  'f0100000-0000-4000-8000-000000000001',
  'owner',
  'Chapter owner',
  'owner'
);
INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'f0300000-0000-4000-8000-000000000001',
  'manage_settings',
  true
);
INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status
) VALUES (
  'f0100000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'f0300000-0000-4000-8000-000000000001',
  '2026-2027',
  'President',
  'active'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'accessible',
  'true',
  'a current child accepts an organization on the preceding install contract'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'membershipRole',
  'staff',
  'the proof carries only the caller current organization role'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'installedVersion',
  '1.1.0',
  'the proof names the organization install contract'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'runtimeVersion',
  '1.2.0',
  'the proof binds the exact child runtime version'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'runtimeProfile',
  'application',
  'the proof carries the signed runtime profile'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'installContractSupported',
  'true',
  'the signed N and N-1 range is evaluated server-side'
);
SELECT extensions.is(
  (
    SELECT access.is_accessible::text
    FROM public.organization_plugin_access AS access
    WHERE access.organization_id = 'f0100000-0000-4000-8000-000000000001'
      AND access.plugin_key = 'application-access-fixture'
  ),
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'accessible',
  'the application proof shares the embedded host access decision'
);

SELECT extensions.is(
  public.get_csf_application_role_context(
    'f0100000-0000-4000-8000-000000000001',
    '1.2.0'
  ) ->> 'accessible',
  'true',
  'the CSF role proof repeats the generic access gate'
);
SELECT extensions.is(
  public.get_csf_application_role_context(
    'f0100000-0000-4000-8000-000000000001',
    '1.2.0'
  ) ->> 'isOwner',
  'true',
  'the CSF proof recognizes the caller current owner position'
);
SELECT extensions.ok(
  public.get_csf_application_role_context(
    'f0100000-0000-4000-8000-000000000001',
    '1.2.0'
  ) -> 'roleKeys' @> '["owner"]'::jsonb,
  'the CSF proof returns the caller role key'
);
SELECT extensions.ok(
  public.get_csf_application_role_context(
    'f0100000-0000-4000-8000-000000000001',
    '1.2.0'
  ) -> 'permissions' @> '["manage_settings"]'::jsonb,
  'the CSF proof returns the caller enabled permission only'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'dvhs-csf',
    '1.1.0'
  ) ->> 'reason',
  'runtime_profile_mismatch',
  'an embedded publication cannot authorize an application runtime'
);

RESET ROLE;
UPDATE public.organization_plugin_installs
SET enabled = false
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
UPDATE public.organization_plugin_entitlements
SET is_forced = true
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'accessible',
  'true',
  'a forced entitlement enables the application without an enabled install'
);

RESET ROLE;
UPDATE public.organization_plugin_installs
SET enabled = true
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
UPDATE public.organization_plugin_entitlements
SET is_forced = false
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
UPDATE public.plugins
SET force_update_version = '1.2.0'
WHERE key = 'application-access-fixture';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'reason',
  'forced_update_required',
  'the catalog force-update floor blocks an older organization install'
);

RESET ROLE;
UPDATE public.plugins
SET force_update_version = NULL,
    is_active = false
WHERE key = 'application-access-fixture';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'reason',
  'plugin_inactive',
  'an inactive catalog record fails closed'
);

RESET ROLE;
UPDATE public.plugins
SET is_active = true
WHERE key = 'application-access-fixture';
INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity,
  host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-access-fixture', '1.3.0', 'published',
  'Invalid install-contract fixture.', repeat('5', 40), repeat('5', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('5', 40), repeat('5', 64),
  '["apps/application-access-fixture"]'::jsonb,
  repeat('5', 64), repeat('5', 64),
  '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/heads/development","issuer":"https://token.actions.githubusercontent.com","attestationRef":"release.sigstore.json"}'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1, '20260820130000',
  '{"minimum":"invalid","maximum":"1.3.0"}'::jsonb,
  'application'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.3.0'
  ) ->> 'reason',
  'install_contract_invalid',
  'malformed signed install-contract versions fail closed'
);

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000002',
    'application-access-fixture',
    '1.2.0'
  ),
  '{"reason":"membership_required","accessible":false,"schemaVersion":1}'::jsonb,
  'a foreign organization returns no install, entitlement, or release facts'
);

RESET ROLE;
UPDATE public.organization_plugin_entitlements
SET status = 'inactive'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'reason',
  'entitlement_required',
  'an inactive private entitlement fails closed'
);

RESET ROLE;
UPDATE public.organization_members
SET role = 'member'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND user_id = 'f0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ),
  '{"reason":"plugin_access_required","accessible":false,"schemaVersion":1}'::jsonb,
  'an ordinary member cannot enumerate a denied private plugin state'
);

RESET ROLE;
UPDATE public.organization_members
SET role = 'staff'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND user_id = 'f0000000-0000-4000-8000-000000000001';
UPDATE public.organization_plugin_entitlements
SET status = 'active'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
UPDATE public.organization_plugin_installs
SET installed_version = '1.0.0'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-access-fixture';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ) ->> 'reason',
  'install_contract_unsupported',
  'an install older than the signed N-1 floor fails closed'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '9.9.9'
  ) ->> 'reason',
  'runtime_release_missing',
  'an unpublished child runtime fails closed'
);

RESET ROLE;
INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-access-fixture', '1.4.0', 'published',
  'Unsigned application fixture.', repeat('6', 40), repeat('6', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('6', 40), repeat('6', 64),
  '["apps/application-access-fixture"]'::jsonb,
  repeat('6', 64), repeat('6', 64),
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1, '20260820130000',
  '{"minimum":"1.0.0","maximum":"1.4.0"}'::jsonb,
  'application'
);
INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest, signer_identity,
  host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-access-fixture', '1.5.0', 'published',
  'Incompatible host API fixture.', repeat('7', 40), repeat('7', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('7', 40), repeat('7', 64),
  '["apps/application-access-fixture"]'::jsonb,
  repeat('7', 64), repeat('7', 64),
  '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/heads/development","issuer":"https://token.actions.githubusercontent.com","attestationRef":"release.sigstore.json"}'::jsonb,
  '{"minimum":"2.0.0","maximum":"2.0.0"}'::jsonb,
  1, '20260820130000',
  '{"minimum":"1.0.0","maximum":"1.5.0"}'::jsonb,
  'application'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.4.0'
  ) ->> 'reason',
  'runtime_release_unsigned',
  'an unsigned application release cannot authorize a child runtime'
);
SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.5.0'
  ) ->> 'reason',
  'host_api_unsupported',
  'an application release for an incompatible host API fails closed'
);

RESET ROLE;
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'f0100000-0000-4000-8000-000000000001'
  AND user_id = 'f0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  public.get_plugin_application_access_context(
    'f0100000-0000-4000-8000-000000000001',
    'application-access-fixture',
    '1.2.0'
  ),
  '{"reason":"membership_required","accessible":false,"schemaVersion":1}'::jsonb,
  'an inactive organization member receives no control-plane facts'
);
SELECT extensions.is(
  public.get_csf_application_role_context(
    'f0100000-0000-4000-8000-000000000001',
    '1.2.0'
  ) -> 'roleKeys',
  '[]'::jsonb,
  'an inactive member receives no stale CSF role facts'
);

SELECT * FROM extensions.finish();
ROLLBACK;
