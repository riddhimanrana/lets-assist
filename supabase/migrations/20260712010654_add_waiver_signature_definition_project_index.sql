CREATE INDEX CONCURRENTLY IF NOT EXISTS waiver_signatures_definition_project_idx
  ON public.waiver_signatures (waiver_definition_id, project_id);
