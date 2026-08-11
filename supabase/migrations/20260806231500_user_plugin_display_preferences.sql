-- Per-user control over plugin-contributed content on core platform surfaces.
--
-- Plugins contribute sanitized DTOs to the signed-in /home feed and the
-- volunteer /dashboard. This table lets a person turn that content off — all
-- of it, or one plugin at a time — without leaving the organization.
--
-- Shape: exactly one row per user. `show_plugin_content` is the platform-wide
-- switch and defaults to TRUE, so the absence of a row means "show everything"
-- and no backfill or signup trigger is required. `hidden_plugin_keys` holds the
-- per-plugin opt-outs. Because the preference is opt-out, a plugin is either
-- listed (hidden) or absent (shown) — a two-state fact needs no map, and an
-- array cannot encode the same state twice the way a jsonb map of booleans
-- could. One row also keeps the resolver's read to a single primary-key lookup
-- on the hot /home and /dashboard paths.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_plugin_display_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  show_plugin_content boolean NOT NULL DEFAULT true,
  hidden_plugin_keys text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_plugin_display_preferences_hidden_keys_bounded CHECK (
    cardinality(hidden_plugin_keys) <= 200
    AND array_position(hidden_plugin_keys, NULL) IS NULL
    AND NOT ('' = ANY (hidden_plugin_keys))
  )
);

COMMENT ON TABLE public.user_plugin_display_preferences IS
  'Per-user visibility of plugin-contributed content on platform surfaces (/home feed, /dashboard cards). Missing row means every eligible plugin is shown.';
COMMENT ON COLUMN public.user_plugin_display_preferences.show_plugin_content IS
  'Platform-wide switch. FALSE hides every plugin contribution on every core surface.';
COMMENT ON COLUMN public.user_plugin_display_preferences.hidden_plugin_keys IS
  'Plugin keys this user has hidden individually. Absent key means shown; the platform never requires an entry to display a plugin.';

CREATE TRIGGER user_plugin_display_preferences_set_updated_at
  BEFORE UPDATE ON public.user_plugin_display_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Row level security: a user owns exactly their own row and nothing else.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_plugin_display_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_plugin_display_preferences_select_own
  ON public.user_plugin_display_preferences
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_plugin_display_preferences_insert_own
  ON public.user_plugin_display_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_plugin_display_preferences_update_own
  ON public.user_plugin_display_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_plugin_display_preferences_delete_own
  ON public.user_plugin_display_preferences
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- The schema's default privileges hand every new public table to `anon`; a
-- signed-out visitor has no preferences, so take that grant back explicitly.
REVOKE ALL ON TABLE public.user_plugin_display_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.user_plugin_display_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.user_plugin_display_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.user_plugin_display_preferences TO service_role;

COMMIT;
