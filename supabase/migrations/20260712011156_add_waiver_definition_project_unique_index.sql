CREATE UNIQUE INDEX CONCURRENTLY waiver_definitions_id_project_id_key
  ON public.waiver_definitions (id, project_id);
