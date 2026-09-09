export const workbookLinkMergePosture = `AND (
  SELECT count(*)=4 AND coalesce(bool_and(
    p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile::text=expected.volatility
    AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proleakproof
    AND NOT p.proretset AND p.pronargdefaults=0
    AND p.proconfig=ARRAY['search_path=""'] AND p.proargnames=expected.arguments
    AND md5(p.prosrc)=expected.digest
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='postgres'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
  ),false) FROM (VALUES
    ('plugin_data.csf_profile_merge_reference_plan_workbook_links_base(uuid,uuid)',
      'd00f5e6decafd649e5c4008ccce355c6','s',
      ARRAY['p_organization_id','p_source_profile_id']),
    ('plugin_data.csf_profile_merge_reference_plan(uuid,uuid)',
      '2f521e9b85f90793c1c0c7197ce3f241','s',
      ARRAY['p_organization_id','p_source_profile_id']),
    ('plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid)',
      '96ddc5b4c828f22d2f98fb3e5655e3ed','v',
      ARRAY['p_organization_id','p_source_profile_id','p_target_profile_id','p_reason','p_actor_user_id']),
    ('plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)',
      '0124ee53995263c7a2e839d20d5e8efe','v',
      ARRAY['p_organization_id','p_source_profile_id','p_target_profile_id','p_reason','p_actor_user_id'])
  ) expected(signature,digest,volatility,arguments)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
  LEFT JOIN pg_language l ON l.oid=p.prolang
)`;
