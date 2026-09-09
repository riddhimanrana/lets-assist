export const staffAccountConnectionPosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
    AND p.proargnames=ARRAY['p_organization_id','p_profile_id','p_actor_user_id','p_account_email','p_reason','p_request_id']
    AND md5(p.prosrc)='d46af3759c34832d1b1a516d3e494de4'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=2 AND bool_and(
      a.grantee IN ('postgres'::regrole,'service_role'::regrole)
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
)`;
