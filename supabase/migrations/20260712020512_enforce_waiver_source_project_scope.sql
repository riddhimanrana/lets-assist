-- Service-role rendering bypasses Storage RLS, so object paths themselves must
-- be tenant-bound. These checks prevent a manager from pointing one project at
-- another project's source PDF.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_waiver_pdf_storage_path_project_scope_check
  CHECK (
    waiver_pdf_storage_path IS NULL
    OR (
      left(
        waiver_pdf_storage_path,
        length('project_waivers/' || id::text || '/')
      ) = 'project_waivers/' || id::text || '/'
      AND length(waiver_pdf_storage_path) > length('project_waivers/' || id::text || '/')
    )
  )
  NOT VALID;

ALTER TABLE public.waiver_definitions
  ADD CONSTRAINT waiver_definitions_pdf_storage_path_project_scope_check
  CHECK (
    pdf_storage_path IS NULL
    OR (
      left(
        pdf_storage_path,
        length('project_waivers/' || project_id::text || '/')
      ) = 'project_waivers/' || project_id::text || '/'
      AND length(pdf_storage_path) > length('project_waivers/' || project_id::text || '/')
    )
  )
  NOT VALID;

ALTER TABLE public.waiver_signatures
  ADD CONSTRAINT waiver_signatures_pdf_storage_path_project_scope_check
  CHECK (
    waiver_pdf_storage_path IS NULL
    OR (
      left(
        waiver_pdf_storage_path,
        length('project_waivers/' || project_id::text || '/')
      ) = 'project_waivers/' || project_id::text || '/'
      AND length(waiver_pdf_storage_path) > length('project_waivers/' || project_id::text || '/')
    )
  )
  NOT VALID;

ALTER TABLE public.projects
  VALIDATE CONSTRAINT projects_waiver_pdf_storage_path_project_scope_check;

ALTER TABLE public.waiver_definitions
  VALIDATE CONSTRAINT waiver_definitions_pdf_storage_path_project_scope_check;

ALTER TABLE public.waiver_signatures
  VALIDATE CONSTRAINT waiver_signatures_pdf_storage_path_project_scope_check;
