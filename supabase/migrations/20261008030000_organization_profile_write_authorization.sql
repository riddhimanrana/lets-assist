-- Serialize organization profile writes with membership revocation.
BEGIN;

ALTER POLICY "Allow admins to update organizations" ON public.organizations
  USING (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organizations.id
    AND m.user_id=(SELECT auth.uid()) AND m.role='admin' AND m.status='active'))
  WITH CHECK (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organizations.id
    AND m.user_id=(SELECT auth.uid()) AND m.role='admin' AND m.status='active'));
ALTER POLICY "Admins can delete orgs" ON public.organizations
  USING (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organizations.id
    AND m.user_id=(SELECT auth.uid()) AND m.role='admin' AND m.status='active'));

CREATE FUNCTION private.guard_organization_profile_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF current_setting('role',true)='authenticated' OR session_user='authenticated' THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-org-membership:' || OLD.id::text,0)) THEN
      RAISE EXCEPTION 'Organization membership is changing. Retry the operation.' USING ERRCODE='55P03';
    END IF;
    IF actor IS NULL OR NOT app_private.account_deletion_actor_is_active(actor)
      OR NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=OLD.id
        AND m.user_id=actor AND m.role='admin' AND m.status='active') THEN
      RAISE EXCEPTION 'Only active admins can change this organization.' USING ERRCODE='42501';
    END IF;
    IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Organization identity cannot be changed.' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_organization_profile_write() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.guard_organization_profile_write() TO postgres;
CREATE TRIGGER guard_organization_profile_write BEFORE UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.guard_organization_profile_write();

CREATE FUNCTION public.manage_organization_staff_invite(
  p_actor uuid,p_organization uuid,p_operation text,p_expires_days integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE organization public.organizations; token uuid; expires timestamptz; expired boolean;
BEGIN
  IF p_actor IS NULL OR p_organization IS NULL OR p_operation IS NULL
    OR p_operation NOT IN ('get','generate','revoke') THEN
    RAISE EXCEPTION 'Invalid staff invitation operation.' USING ERRCODE='22023';
  END IF;
  IF p_operation='generate' AND (p_expires_days IS NULL OR p_expires_days<1 OR p_expires_days>365) THEN
    RAISE EXCEPTION 'Staff invitation expiry must be between 1 and 365 days.' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('lets-assist-account-write:' || p_actor::text,0)) THEN
    RAISE EXCEPTION 'Account writes are temporarily unavailable. Retry the transaction.' USING ERRCODE='55P03';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-org-membership:' || p_organization::text,0));
  IF NOT app_private.account_deletion_actor_is_active(p_actor)
    OR NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_organization
      AND m.user_id=p_actor AND m.role='admin' AND m.status='active') THEN
    RAISE EXCEPTION 'Only active admins can manage staff invitations.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO organization FROM public.organizations WHERE id=p_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization is unavailable.' USING ERRCODE='42501'; END IF;
  IF p_operation='generate' THEN
    token:=gen_random_uuid(); expires:=clock_timestamp()+make_interval(days=>p_expires_days);
    UPDATE public.organizations SET staff_join_token=token,staff_join_token_created_at=clock_timestamp(),
      staff_join_token_expires_at=expires,staff_join_token_issued_by=p_actor WHERE id=p_organization;
    RETURN jsonb_build_object('success',true,'token',token,'expiresAt',expires);
  ELSIF p_operation='revoke' THEN
    UPDATE public.organizations SET staff_join_token=NULL,staff_join_token_created_at=NULL,
      staff_join_token_expires_at=NULL,staff_join_token_issued_by=NULL WHERE id=p_organization;
    RETURN jsonb_build_object('success',true);
  END IF;
  expired:=organization.staff_join_token_expires_at IS NOT NULL AND organization.staff_join_token_expires_at<clock_timestamp();
  RETURN jsonb_build_object('hasToken',organization.staff_join_token IS NOT NULL AND NOT expired,
    'token',CASE WHEN expired THEN NULL ELSE organization.staff_join_token END,
    'createdAt',organization.staff_join_token_created_at,'expiresAt',organization.staff_join_token_expires_at,'isExpired',expired);
END;
$$;
REVOKE ALL ON FUNCTION public.manage_organization_staff_invite(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manage_organization_staff_invite(uuid,uuid,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
