-- Negative proof that 20260823211000 retired the onboarding-link system
-- completely. Every function family is asserted absent by name, so any future
-- overload with a new signature fails this suite, not just the historical
-- ones. The cohort review index and the merge plan's reference inventory are
-- the surviving replacements this teardown must leave behind.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(19);

SELECT extensions.hasnt_table(
  'plugin_data', 'csf_onboarding_links',
  'the onboarding-link table is gone'
);

SELECT extensions.hasnt_function(
  'plugin_data', 'csf_mutate_onboarding_link',
  'the reusable onboarding-link mutation is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_create_direct_invitation',
  'direct invitation creation is gone in every overload'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_create_direct_invitation_engine',
  'the direct invitation creation engine is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_update_direct_invitation',
  'direct invitation lifecycle updates are gone in every overload'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_update_direct_invitation_engine',
  'the direct invitation lifecycle engine is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_accept_direct_invitation',
  'direct invitation acceptance is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_accept_direct_invitation_base',
  'the historical acceptance engine is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_submit_profile_link_request',
  'the link-based profile-connection submission is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_submit_profile_link_request_identity_base',
  'the submission identity engine is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_profile_claim_candidate',
  'the roster claim candidate query is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_confirm_profile_claim',
  'claim confirmation is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_confirm_profile_claim_identity_base',
  'the claim confirmation identity engine is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_decline_profile_claim',
  'claim decline is gone'
);
SELECT extensions.hasnt_function(
  'plugin_data', 'csf_decline_profile_claim_identity_base',
  'the claim decline identity engine is gone'
);

SELECT extensions.hasnt_column(
  'plugin_data', 'csf_profile_link_requests', 'onboarding_link_id',
  'link requests no longer point at onboarding links'
);

SELECT extensions.has_index(
  'plugin_data', 'csf_profile_link_requests',
  'csf_profile_link_requests_cohort_review_idx',
  'the per-class review queue reads pending work through a partial cohort index'
);

-- The surviving review path still exists.
SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_resolve_profile_link_request(uuid,uuid,uuid,text,text,uuid)') IS NOT NULL,
  'officer resolution of link requests survives the teardown'
);

-- The merge reference plan no longer inventories any onboarding-link arm.
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ee100000-0000-4000-8000-000000000001',
  'CSF Teardown Plan', 'csf-teardown-plan', 'school', '984551'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      plugin_data.csf_profile_merge_reference_plan(
        'ee100000-0000-4000-8000-000000000001',
        'ee200000-0000-4000-8000-000000000001'
      ) -> 'sameTransactionRewrites'
    ) AS entry
    WHERE entry->>'reference' ILIKE '%onboarding%'
  ),
  'the merge rewrite plan carries no onboarding-link reference arm'
);

SELECT * FROM extensions.finish();
ROLLBACK;
