BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(35);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.get_plugin_application_runtime_admin_status(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.set_plugin_application_runtime(uuid,text,text,text,boolean,uuid,uuid,boolean,text)',
    'EXECUTE'
  ),
  'browser roles cannot call application runtime administration functions'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.get_plugin_application_runtime_admin_status(uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.set_plugin_application_runtime(uuid,text,text,text,boolean,uuid,uuid,boolean,text)',
    'EXECUTE'
  ),
  'service_role owns the server-only application runtime paths'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'application-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'application-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'Application runtime admin contract',
  'application-runtime-admin',
  'school',
  '974201'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO public.plugins (
  key, name, visibility, is_active, latest_version
) VALUES (
  'application-admin-fixture',
  'Application Admin Fixture',
  'private',
  false,
  '1.0.0'
);

INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES
  (
    'application-admin-fixture', '1.0.0', 'published', 'Embedded fixture.',
    repeat('a', 40), repeat('a', 64),
    '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
    repeat('a', 40), repeat('a', 64),
    '["plugins/application-admin-fixture"]'::jsonb, NULL, repeat('a', 64),
    '{"identity":"fixture","issuer":"fixture","attestationRef":"fixture"}'::jsonb,
    '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb, 1,
    '20260821005258',
    '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb, 'embedded'
  ),
  (
    'application-admin-fixture', '1.1.0', 'published', 'Application fixture.',
    repeat('b', 40), repeat('b', 64),
    '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
    repeat('b', 40), repeat('b', 64),
    '["plugins/application-admin-fixture","apps/application-admin-fixture"]'::jsonb,
    repeat('b', 64), repeat('b', 64),
    '{"identity":"fixture","issuer":"fixture","attestationRef":"fixture"}'::jsonb,
    '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb, 1,
    '20260821005258',
    '{"minimum":"1.0.0","maximum":"1.1.0"}'::jsonb, 'application'
  );

UPDATE public.plugins
SET is_active = true
WHERE key = 'application-admin-fixture';

INSERT INTO public.organization_plugin_entitlements (
  organization_id, plugin_key, status, is_forced
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'application-admin-fixture',
  'active',
  false
);
INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, enabled, installed_version
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'application-admin-fixture',
  true,
  '1.0.0'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'applicationPublished',
  'true',
  'status finds the latest signed application release'
);
SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'canEnable',
  'false',
  'a published release without healthy deployment cannot be enabled'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.1.0', 'development', true,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001', false, NULL
    )
  $$,
  '55000',
  'the newest requested application deployment is not healthy',
  'activation fails closed before hosted health exists'
);

SELECT public.observe_plugin_deployment(
  'application-admin-fixture', '1.1.0', 'development', 'application',
  'dpl_application_admin_001', repeat('c', 40),
  '{"releaseTag":"application-admin-fixture/v1.1.0"}'::jsonb
);
SELECT public.report_plugin_deployment_health(
  'application-admin-fixture', 'development', 'dpl_application_admin_001',
  'healthy', 'deployed',
  '{"deploymentUrl":"https://application-admin.example.test","healthRoute":"/api/health"}'::jsonb
);

SELECT public.observe_plugin_deployment(
  'application-admin-fixture', '1.1.0', 'development', 'application',
  'dpl_application_admin_002', repeat('d', 40),
  '{"releaseTag":"application-admin-fixture/v1.1.0"}'::jsonb
);
RESET ROLE;
UPDATE private.plugin_deployments
SET last_seen_at = last_seen_at + interval '1 second'
WHERE plugin_key = 'application-admin-fixture'
  AND environment = 'development'
  AND deployment_id = 'dpl_application_admin_002';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'deploymentId',
  'dpl_application_admin_002',
  'status selects the newest observed deployment'
);
SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'canEnable',
  'false',
  'a newer pending deployment masks an older healthy deployment'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.1.0', 'development', true,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000007', false, NULL
    )
  $$,
  '55000',
  'the newest requested application deployment is not healthy',
  'activation refuses a newer deployment until it reports healthy'
);
SELECT public.report_plugin_deployment_health(
  'application-admin-fixture', 'development', 'dpl_application_admin_002',
  'healthy', 'deployed',
  '{"deploymentUrl":"https://application-admin-new.example.test","healthRoute":"/api/health"}'::jsonb
);

SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'canEnable',
  'true',
  'a healthy deployment makes the application choice available'
);
SELECT extensions.is(
  public.set_plugin_application_runtime(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture', '1.1.0', 'development', true,
    'fa000000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002', false, NULL
  ) ->> 'applicationEnabled',
  'true',
  'an active organization admin can select the healthy application runtime'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT desired_version
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  ),
  '1.1.0',
  'activation records the desired application version'
);
SELECT extensions.ok(
  (
    SELECT enabled
      AND metadata ->> 'runtimeVersion' = '1.1.0'
      AND metadata ->> 'environment' = 'development'
    FROM public.organization_plugin_feature_flags
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
      AND flag_key = 'application-runtime'
  ),
  'activation enables the exact organization route metadata'
);
SELECT extensions.is(
  (
    SELECT installed_version
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  ),
  '1.0.0',
  'activation leaves the embedded install contract unchanged'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.plugin_audit_logs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
      AND details ->> 'requestId' = 'fa200000-0000-4000-8000-000000000002'
  ),
  1,
  'activation writes one audit record without release credentials'
);
SELECT extensions.ok(
  (
    SELECT completed_at IS NOT NULL
      AND outcome ->> 'applicationEnabled' = 'true'
    FROM private.plugin_application_runtime_transitions
    WHERE request_id = 'fa200000-0000-4000-8000-000000000002'
  ),
  'activation stores a completed request receipt and its outcome'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', NULL, 'development', false,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000002', true, '1.1.0'
    )
  $$,
  '22023',
  'application runtime request ID was reused with different inputs',
  'a request ID cannot be rebound to a different transition'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.1.0', 'development', true,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-00000000000a', false, NULL
    )
  $$,
  '40001',
  'application runtime changed since this request was prepared',
  'a newly submitted stale transition cannot overwrite newer state'
);

SELECT extensions.is(
  public.set_plugin_application_runtime(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture', '1.1.0', 'development', true,
    'fa000000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000003', true, '1.1.0'
  ) ->> 'changed',
  'false',
  'replaying the selected runtime is idempotent'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.plugin_audit_logs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  ),
  1,
  'an idempotent replay does not duplicate audit history'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.set_plugin_application_runtime(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture', NULL, 'development', false,
    'fa000000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000004', true, '1.1.0'
  ) ->> 'changed',
  'true',
  'the admin can return to the embedded runtime'
);
SELECT extensions.is(
  public.set_plugin_application_runtime(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture', '1.1.0', 'development', true,
    'fa000000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002', false, NULL
  ) ->> 'applicationEnabled',
  'true',
  'a delayed retry returns the original completed outcome'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT desired_version IS NULL
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  )
  AND NOT (
    SELECT enabled
    FROM public.organization_plugin_feature_flags
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
      AND flag_key = 'application-runtime'
  ),
  'rollback clears the desired version and disables application routing'
);
SELECT extensions.ok(
  (
    SELECT desired_version IS NULL
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  )
  AND NOT (
    SELECT enabled
    FROM public.organization_plugin_feature_flags
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
      AND flag_key = 'application-runtime'
  ),
  'a delayed retry cannot restore obsolete routing state'
);
SELECT extensions.is(
  (
    SELECT installed_version
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  ),
  '1.0.0',
  'rollback still preserves the embedded install contract'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.plugin_audit_logs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  ),
  2,
  'rollback adds one separate audit record'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT public.set_plugin_application_runtime(
  'fa100000-0000-4000-8000-000000000001',
  'application-admin-fixture', '1.1.0', 'development', true,
  'fa000000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000008', false, NULL
);
INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-admin-fixture', '1.1.1', 'published',
  'Newer application candidate.', repeat('1', 40), repeat('1', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('1', 40), repeat('1', 64),
  '["plugins/application-admin-fixture","apps/application-admin-fixture"]'::jsonb,
  repeat('1', 64), repeat('1', 64),
  '{"identity":"fixture","issuer":"fixture","attestationRef":"fixture"}'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb, 1,
  '20260821005258',
  '{"minimum":"1.0.0","maximum":"1.1.0"}'::jsonb, 'application'
);
SELECT public.observe_plugin_deployment(
  'application-admin-fixture', '1.1.1', 'development', 'application',
  'dpl_application_admin_candidate', repeat('1', 40),
  '{"releaseTag":"application-admin-fixture/v1.1.1"}'::jsonb
);
SELECT public.report_plugin_deployment_health(
  'application-admin-fixture', 'development',
  'dpl_application_admin_candidate', 'healthy', 'deployed',
  '{"deploymentUrl":"https://application-admin-candidate.example.test","healthRoute":"/api/health"}'::jsonb
);
SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'applicationVersion',
  '1.1.1',
  'status exposes the newest application candidate separately'
);
SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'selectedApplicationVersion',
  '1.1.0',
  'status preserves the selected application version'
);
SELECT extensions.ok(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'selectedDeploymentUrl' IN (
    'https://application-admin.example.test',
    'https://application-admin-new.example.test'
  )
  AND public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'selectedDeploymentUrl'
    <> 'https://application-admin-candidate.example.test',
  'status keeps selected version health separate from the newest candidate'
);
RESET ROLE;
DELETE FROM private.plugin_deployments
WHERE plugin_key = 'application-admin-fixture'
  AND version = '1.1.1';
DELETE FROM public.plugin_versions
WHERE plugin_key = 'application-admin-fixture'
  AND version = '1.1.1';

INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-admin-fixture', '2.0.0', 'published',
  'Embedded fixture outside the selected application install contract.',
  repeat('0', 40), repeat('0', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('0', 40), repeat('0', 64),
  '["plugins/application-admin-fixture"]'::jsonb,
  NULL, repeat('0', 64),
  '{"identity":"fixture","issuer":"fixture","attestationRef":"fixture"}'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb, 1,
  '20260821005258',
  '{"minimum":"2.0.0","maximum":"2.0.0"}'::jsonb, 'embedded'
);
UPDATE public.organization_plugin_installs
SET installed_version = '2.0.0'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-admin-fixture';
SELECT extensions.ok(
  (
    SELECT desired_version IS NULL
    FROM public.organization_plugin_installs
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
  )
  AND NOT (
    SELECT enabled
    FROM public.organization_plugin_feature_flags
    WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
      AND plugin_key = 'application-admin-fixture'
      AND flag_key = 'application-runtime'
  ),
  'an incompatible embedded update clears application routing'
);
UPDATE public.organization_plugin_installs
SET installed_version = '1.0.0'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-admin-fixture';

INSERT INTO public.plugin_versions (
  plugin_key, version, status, changelog, commit_sha, manifest_hash,
  compatibility_contract, rollout_percentage, published_at, source_tree,
  content_digest, release_inputs, build_digest, sbom_digest,
  signer_identity, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'application-admin-fixture', '1.2.0', 'published',
  'Application fixture requiring a future host API.',
  repeat('e', 40), repeat('e', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb, 0, now(),
  repeat('e', 40), repeat('e', 64),
  '["plugins/application-admin-fixture","apps/application-admin-fixture"]'::jsonb,
  repeat('e', 64), repeat('e', 64),
  '{"identity":"fixture","issuer":"fixture","attestationRef":"fixture"}'::jsonb,
  '{"minimum":"2.0.0","maximum":"2.0.0"}'::jsonb, 1,
  '20260821005258',
  '{"minimum":"1.0.0","maximum":"1.1.0"}'::jsonb, 'application'
);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SELECT public.observe_plugin_deployment(
  'application-admin-fixture', '1.2.0', 'development', 'application',
  'dpl_application_admin_003', repeat('f', 40),
  '{"releaseTag":"application-admin-fixture/v1.2.0"}'::jsonb
);
SELECT public.report_plugin_deployment_health(
  'application-admin-fixture', 'development', 'dpl_application_admin_003',
  'healthy', 'deployed',
  '{"deploymentUrl":"https://application-admin-future.example.test","healthRoute":"/api/health"}'::jsonb
);
SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'hostApiSupported',
  'false',
  'status hides an application release requiring an unsupported host API'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.2.0', 'development', true,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000009', false, NULL
    )
  $$,
  '55000',
  'the requested application release does not support the current host API',
  'activation rejects a release requiring an unsupported host API'
);
RESET ROLE;

UPDATE public.organization_plugin_entitlements
SET status = 'inactive'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND plugin_key = 'application-admin-fixture';

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT extensions.is(
  public.get_plugin_application_runtime_admin_status(
    'fa100000-0000-4000-8000-000000000001',
    'application-admin-fixture',
    'development'
  ) ->> 'canEnable',
  'false',
  'inactive plugin access hides the application runtime choice'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.1.0', 'development', true,
      'fa000000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000006', false, NULL
    )
  $$,
  '55000',
  'active plugin access is required',
  'activation fails closed after entitlement access ends'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.set_plugin_application_runtime(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture', '1.1.0', 'development', true,
      'fa000000-0000-4000-8000-000000000002',
      'fa200000-0000-4000-8000-000000000005', false, NULL
    )
  $$,
  '42501',
  'active organization admin is required',
  'a non-admin actor cannot change the runtime'
);
SELECT extensions.throws_ok(
  $$
    SELECT public.get_plugin_application_runtime_admin_status(
      'fa100000-0000-4000-8000-000000000001',
      'application-admin-fixture',
      'preview'
    )
  $$,
  '22023',
  'valid application runtime coordinates are required',
  'the admin status path refuses unsupported environments'
);

RESET ROLE;
SELECT extensions.finish();
ROLLBACK;
