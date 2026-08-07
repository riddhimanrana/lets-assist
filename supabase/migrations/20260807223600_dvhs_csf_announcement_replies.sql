-- DVHS CSF: officer follow-up replies on published member posts.
--
-- Product contract Amendment 2 (v1.2): officers holding `manage_posts` may
-- append follow-up replies to their chapter's published posts. Member comments
-- remain excluded; a reply inherits the parent post's audience, is never
-- emailed, carries no pin and no audience of its own.
--
-- Shape decisions:
--
-- 1. `announcement_id` cascades with its post: a reply is a follow-up on one
--    announcement and has no life of its own once the post is deleted.
-- 2. `body` is bounded 1..4000 after btrim at the database, matching the
--    contract's "short follow-up" intent — the table refuses a blank or
--    unbounded reply even if an application bug lets one through.
-- 3. `created_by` follows the announcements convention (`ON DELETE SET NULL`):
--    a departed officer's reply survives as chapter history without a byline.
-- 4. Service-role-only grants + RLS, exactly like every sibling plugin_data
--    table: the browser never queries this table; authorized server entry
--    points are the only readers and writers.

BEGIN;

CREATE TABLE IF NOT EXISTS plugin_data.csf_announcement_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES plugin_data.csf_announcements(id) ON DELETE CASCADE,
  body text NOT NULL
    CONSTRAINT csf_announcement_replies_body_bounds_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_announcement_replies_feed_idx
  ON plugin_data.csf_announcement_replies (organization_id, announcement_id, created_at);

CREATE INDEX IF NOT EXISTS csf_announcement_replies_created_by_idx
  ON plugin_data.csf_announcement_replies (created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE plugin_data.csf_announcement_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_announcement_replies FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_announcement_replies TO service_role;

COMMENT ON TABLE plugin_data.csf_announcement_replies IS
  'Officer-authored follow-up replies on published CSF member posts (contract Amendment 2). Replies inherit the parent post''s audience, are never emailed, and are readable by anyone who can see the parent post. Members cannot author replies; writes require the tenant-scoped manage_posts capability at the authorized server entry points.';

COMMENT ON COLUMN plugin_data.csf_announcement_replies.body IS
  'Plain-text follow-up body, 1..4000 characters after btrim.';

COMMENT ON COLUMN plugin_data.csf_announcement_replies.created_by IS
  'The officer account that authored the reply. Nulled if the account is deleted; the reply survives as chapter history without a byline.';

COMMIT;
