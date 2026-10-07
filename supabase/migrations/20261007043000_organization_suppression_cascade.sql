-- Membership suppression applies while both parents exist. Parent cascades
-- must not recreate references to the row being removed.
BEGIN;
CREATE OR REPLACE FUNCTION private.record_organization_autojoin_suppression()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.organizations WHERE id=OLD.organization_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN OLD; END IF;
 PERFORM 1 FROM auth.users WHERE id=OLD.user_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN OLD; END IF;
 INSERT INTO public.organization_autojoin_suppressions(organization_id,user_id,removed_by)
 VALUES(OLD.organization_id,OLD.user_id,auth.uid())
 ON CONFLICT(organization_id,user_id) DO NOTHING;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.record_organization_autojoin_suppression() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_organization_autojoin_suppression() TO postgres;
COMMIT;
