-- Record the reviewed execution boundary for the feedback immutability
-- trigger. Trigger functions are invoked by PostgreSQL through the trigger;
-- callers must not be able to execute this function directly.

REVOKE ALL ON FUNCTION app_private.project_feedback_guard_update()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION app_private.project_feedback_guard_update()
  TO postgres;
