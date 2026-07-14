CREATE UNIQUE INDEX CONCURRENTLY project_signups_id_project_id_key
  ON public.project_signups (id, project_id);
