-- Close AUD-003 without a broad DDL event trigger. Only the reviewed public
-- RPC/RLS helpers below remain executable by PostgREST client roles. Trigger
-- and cron/maintenance functions keep their owner/service execution posture
-- but are no longer directly callable by anon or authenticated clients.

REVOKE ALL ON FUNCTION public.checkin_signups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkout_signups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_trusted_member_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_old_anonymous_signups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_unconfirmed_users() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gen_unique_username(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_auth_avatar_url(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_trusted_member_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_projects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_block_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_set_defaults() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_set_username() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_system_banners_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profiles_trusted_from_tm() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_tm_from_profiles_trusted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_trusted_member_to_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_user_profile_picture() FROM PUBLIC, anon, authenticated;

-- Normalize the reviewed callable catalog explicitly. A future migration must
-- update both this grant posture and the architecture/test allowlists.
REVOKE ALL ON FUNCTION public.can_insert_project(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_insert_project(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_attendees(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_project_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_trusted_member(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_attendees(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trusted_member(uuid) TO authenticated;
