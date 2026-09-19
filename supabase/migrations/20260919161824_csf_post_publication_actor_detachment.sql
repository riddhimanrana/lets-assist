-- Publication requests are durable recovery receipts. Deleting the officer
-- account must detach the live account reference without deleting the request
-- or allowing another officer to adopt its request identifier.
BEGIN;

ALTER TABLE plugin_data.csf_post_publication_requests
  DROP CONSTRAINT csf_post_publication_requests_actor_user_id_fkey;

ALTER TABLE plugin_data.csf_post_publication_requests
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE plugin_data.csf_post_publication_requests
  ADD CONSTRAINT csf_post_publication_requests_actor_user_id_fkey
  FOREIGN KEY (actor_user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN plugin_data.csf_post_publication_requests.actor_user_id IS
  'Officer account that prepared this publication request, or NULL after account deletion. The immutable organization and request coordinates survive, and a detached request cannot be adopted by another actor.';

COMMIT;
