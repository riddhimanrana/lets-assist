CREATE INDEX CONCURRENTLY IF NOT EXISTS waiver_signatures_signup_project_idx
  ON public.waiver_signatures (signup_id, project_id);
