-- Waiver records are written and read exclusively through authenticated server
-- actions using the service-role client. Keeping client table privileges here
-- would let callers bypass those authorization and validation boundaries.
REVOKE ALL PRIVILEGES ON TABLE public.waiver_signatures FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.waiver_definitions FROM anon, authenticated;

DROP POLICY IF EXISTS waiver_signatures_insert_policy ON public.waiver_signatures;
DROP POLICY IF EXISTS waiver_signatures_read_policy ON public.waiver_signatures;
DROP POLICY IF EXISTS waiver_signatures_update_policy ON public.waiver_signatures;

DROP POLICY IF EXISTS waiver_definitions_read_policy ON public.waiver_definitions;
DROP POLICY IF EXISTS waiver_definitions_write_policy ON public.waiver_definitions;
DROP POLICY IF EXISTS waiver_definitions_insert_policy ON public.waiver_definitions;
DROP POLICY IF EXISTS waiver_definitions_delete_policy ON public.waiver_definitions;

-- The application performs this lookup only in a server action. Do not expose
-- the SECURITY DEFINER auth.users lookup as a public account-enumeration RPC.
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO service_role;

-- Signed evidence is append-only. Account linking is intentionally allowed to
-- change user_id/anonymous_id, and retention tooling may adjust expires_at.
CREATE OR REPLACE FUNCTION private.prevent_waiver_signature_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.signup_id IS DISTINCT FROM OLD.signup_id
    OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
    OR NEW.signer_email IS DISTINCT FROM OLD.signer_email
    OR NEW.signature_type IS DISTINCT FROM OLD.signature_type
    OR NEW.signature_text IS DISTINCT FROM OLD.signature_text
    OR NEW.signature_storage_path IS DISTINCT FROM OLD.signature_storage_path
    OR NEW.upload_storage_path IS DISTINCT FROM OLD.upload_storage_path
    OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
    OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.form_data IS DISTINCT FROM OLD.form_data
    OR NEW.waiver_pdf_url IS DISTINCT FROM OLD.waiver_pdf_url
    OR NEW.waiver_definition_id IS DISTINCT FROM OLD.waiver_definition_id
    OR NEW.signature_payload IS DISTINCT FROM OLD.signature_payload
  THEN
    RAISE EXCEPTION 'signed waiver evidence is immutable'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_waiver_signature_evidence_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prevent_waiver_signature_evidence_mutation()
  TO service_role;

CREATE TRIGGER prevent_waiver_signature_evidence_mutation
BEFORE UPDATE ON public.waiver_signatures
FOR EACH ROW
EXECUTE FUNCTION private.prevent_waiver_signature_evidence_mutation();
