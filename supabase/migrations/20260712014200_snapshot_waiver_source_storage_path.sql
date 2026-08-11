-- Keep the immutable source PDF object path on each signature. Public URLs are
-- retained only for legacy compatibility; server-side rendering uses this path
-- with the service-role Storage client.
ALTER TABLE public.waiver_signatures
  ADD COLUMN waiver_pdf_storage_path text;

UPDATE public.waiver_signatures AS signatures
SET waiver_pdf_storage_path = COALESCE(
  (
    SELECT definitions.pdf_storage_path
    FROM public.waiver_definitions AS definitions
    WHERE definitions.id = signatures.waiver_definition_id
      AND definitions.project_id = signatures.project_id
  ),
  (
    SELECT projects.waiver_pdf_storage_path
    FROM public.projects AS projects
    WHERE projects.id = signatures.project_id
  )
)
WHERE signatures.waiver_pdf_storage_path IS NULL;

COMMENT ON COLUMN public.waiver_signatures.waiver_pdf_storage_path IS
  'Immutable waiver source PDF object path captured when the signature is created; stored in waiver-uploads.';

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
    OR NEW.waiver_pdf_storage_path IS DISTINCT FROM OLD.waiver_pdf_storage_path
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
