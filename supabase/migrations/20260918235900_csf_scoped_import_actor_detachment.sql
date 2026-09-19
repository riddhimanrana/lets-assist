-- Keep the scoped-import receipt when its officer account is deleted. The
-- immutable request and source coordinates retain the action evidence after
-- the actor reference is detached.
BEGIN;

ALTER TABLE plugin_data.csf_scoped_application_imports
  DROP CONSTRAINT csf_scoped_application_imports_actor_user_id_fkey;

ALTER TABLE plugin_data.csf_scoped_application_imports
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE plugin_data.csf_scoped_application_imports
  ADD CONSTRAINT csf_scoped_application_imports_actor_user_id_fkey
  FOREIGN KEY (actor_user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMIT;
