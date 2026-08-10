-- Close unauthenticated notification injection on public.notifications (AUD-002).
--
-- The single permissive INSERT policy listed role `anon` and ended in
-- `OR ((SELECT auth.uid()) IS NULL)`, which is unconditionally true for an
-- unauthenticated caller. Combined with the `anon` INSERT grant inherited from
-- the schema default privileges, anyone holding the public anon key -- which
-- ships in the browser bundle -- could write a notification row for any
-- user_id, with an attacker-chosen title, body, severity, and action_url,
-- rendered by the platform's own trusted notification UI.
--
-- The disjunct existed to accommodate three server-only modules that reached
-- the database through the browser Supabase client, where there is no session
-- and auth.uid() is therefore NULL. Those callers now write with the
-- service-role client (services/notifications-server.ts), so the clause has no
-- remaining consumer.
--
-- Reads were already correctly self-scoped, so this closes a write-only hole.

BEGIN;

DROP POLICY IF EXISTS "Insert own or by project owner" ON public.notifications;

CREATE POLICY "Insert own or by project owner"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR EXISTS (
      SELECT 1
      FROM public.project_signups ps
      JOIN public.projects p ON p.id = ps.project_id
      WHERE ps.user_id = notifications.user_id
        AND p.creator_id = (SELECT auth.uid())
    )
  );

-- Defence in depth: the policy above is the boundary, but an unauthenticated
-- client has no reason to hold write privileges on this table at all. Removing
-- them means a future permissive policy cannot reopen the same hole on its own.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.notifications FROM anon;

COMMIT;
