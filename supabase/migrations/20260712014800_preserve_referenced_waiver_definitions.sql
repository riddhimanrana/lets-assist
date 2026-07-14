-- Definition rows used by signatures are historical evidence. Freeze their
-- rendering inputs and version every subsequent project edit into a new row.
CREATE OR REPLACE FUNCTION private.prevent_referenced_waiver_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.waiver_signatures AS signatures
    WHERE signatures.waiver_definition_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'referenced waiver definitions are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path
    OR NEW.pdf_public_url IS DISTINCT FROM OLD.pdf_public_url
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.signers IS DISTINCT FROM OLD.signers
    OR NEW.fields IS DISTINCT FROM OLD.fields
  THEN
    RAISE EXCEPTION 'referenced waiver definitions are immutable'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_referenced_waiver_definition_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prevent_referenced_waiver_definition_mutation()
  TO service_role;

DROP TRIGGER IF EXISTS prevent_referenced_waiver_definition_mutation
  ON public.waiver_definitions;
CREATE TRIGGER prevent_referenced_waiver_definition_mutation
BEFORE UPDATE OR DELETE ON public.waiver_definitions
FOR EACH ROW
EXECUTE FUNCTION private.prevent_referenced_waiver_definition_mutation();

CREATE OR REPLACE FUNCTION public.save_project_waiver_definition_version(
  p_project_id uuid,
  p_actor_id uuid,
  p_title text,
  p_signers jsonb,
  p_fields jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_record public.projects%ROWTYPE;
  current_definition public.waiver_definitions%ROWTYPE;
  next_version integer;
  new_definition_id uuid;
BEGIN
  IF p_actor_id IS NULL
    OR NULLIF(btrim(p_title), '') IS NULL
    OR length(p_title) > 160
    OR jsonb_typeof(p_signers) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'invalid waiver definition payload'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_signers) NOT BETWEEN 1 AND 16
    OR jsonb_array_length(p_fields) > 500
    OR octet_length(p_signers::text) + octet_length(p_fields::text) > 262144
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_signers) AS signer
      WHERE jsonb_typeof(signer) IS DISTINCT FROM 'object'
        OR COALESCE(signer->>'role_key', '') !~ '^[A-Za-z0-9_.:-]{1,128}$'
        OR length(COALESCE(signer->>'label', '')) NOT BETWEEN 1 AND 120
        OR COALESCE(signer->>'order_index', '') !~ '^[0-9]{1,2}$'
    )
    OR (
      SELECT count(*)
      FROM jsonb_array_elements(p_signers) AS signer
    ) IS DISTINCT FROM (
      SELECT count(DISTINCT signer->>'role_key')
      FROM jsonb_array_elements(p_signers) AS signer
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_fields) AS field
      WHERE jsonb_typeof(field) IS DISTINCT FROM 'object'
        OR length(COALESCE(field->>'field_key', '')) NOT BETWEEN 1 AND 200
        OR COALESCE(field->>'field_type', '') NOT IN (
          'signature', 'initial', 'name', 'date', 'email', 'phone',
          'address', 'text', 'checkbox', 'radio', 'dropdown', 'button', 'unknown'
        )
        OR COALESCE(field->>'page_index', '') !~ '^[0-9]{1,3}$'
        OR jsonb_typeof(field->'rect') IS DISTINCT FROM 'object'
        OR CASE
          WHEN COALESCE(field->'rect'->>'x', '') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (field->'rect'->>'x')::numeric > 100000
          ELSE true
        END
        OR CASE
          WHEN COALESCE(field->'rect'->>'y', '') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (field->'rect'->>'y')::numeric > 100000
          ELSE true
        END
        OR CASE
          WHEN COALESCE(field->'rect'->>'width', '') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (field->'rect'->>'width')::numeric NOT BETWEEN 0.000001 AND 100000
          ELSE true
        END
        OR CASE
          WHEN COALESCE(field->'rect'->>'height', '') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (field->'rect'->>'height')::numeric NOT BETWEEN 0.000001 AND 100000
          ELSE true
        END
    )
    OR (
      SELECT count(*)
      FROM jsonb_array_elements(p_fields) AS field
    ) IS DISTINCT FROM (
      SELECT count(DISTINCT field->>'field_key')
      FROM jsonb_array_elements(p_fields) AS field
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_fields) AS field
      WHERE NULLIF(field->>'signer_role_key', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_signers) AS signer
          WHERE signer->>'role_key' = field->>'signer_role_key'
        )
    )
  THEN
    RAISE EXCEPTION 'invalid waiver definition payload'
      USING ERRCODE = '22023';
  END IF;

  -- Serializes version allocation and project-pointer replacement.
  SELECT *
  INTO project_record
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF project_record.waiver_definition_id IS NOT NULL THEN
    SELECT *
    INTO current_definition
    FROM public.waiver_definitions
    WHERE id = project_record.waiver_definition_id
      AND project_id = p_project_id;
  END IF;

  SELECT COALESCE(max(version), 0) + 1
  INTO next_version
  FROM public.waiver_definitions
  WHERE project_id = p_project_id;

  UPDATE public.waiver_definitions
  SET active = false,
      updated_at = now()
  WHERE project_id = p_project_id
    AND active = true;

  INSERT INTO public.waiver_definitions (
    scope,
    project_id,
    title,
    version,
    active,
    pdf_storage_path,
    pdf_public_url,
    source,
    created_by,
    signers,
    fields
  )
  VALUES (
    'project',
    p_project_id,
    btrim(p_title),
    next_version,
    true,
    COALESCE(project_record.waiver_pdf_storage_path, current_definition.pdf_storage_path),
    COALESCE(project_record.waiver_pdf_url, current_definition.pdf_public_url),
    COALESCE(current_definition.source, 'project_pdf'),
    p_actor_id,
    p_signers,
    p_fields
  )
  RETURNING id INTO new_definition_id;

  UPDATE public.projects
  SET waiver_definition_id = new_definition_id
  WHERE id = p_project_id;

  RETURN new_definition_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_project_waiver_definition_version(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_waiver_definition_version(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb
) TO service_role;

COMMENT ON FUNCTION public.save_project_waiver_definition_version(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb
) IS 'Service-only atomic version-on-write transition for project waiver definitions.';
