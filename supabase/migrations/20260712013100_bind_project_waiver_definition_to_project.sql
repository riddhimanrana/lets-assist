-- A project may only point at the waiver definition owned by that same
-- project. The referenced composite unique constraint was added in
-- 20260712011157_add_waiver_project_consistency_constraints.sql.
ALTER TABLE public.projects
  DROP CONSTRAINT projects_waiver_definition_id_fkey,
  ADD CONSTRAINT projects_waiver_definition_project_fkey
    FOREIGN KEY (waiver_definition_id, id)
    REFERENCES public.waiver_definitions (id, project_id)
    ON DELETE SET NULL (waiver_definition_id)
    NOT VALID;

ALTER TABLE public.projects
  VALIDATE CONSTRAINT projects_waiver_definition_project_fkey;
