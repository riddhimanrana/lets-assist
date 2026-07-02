-- Add leading indexes for remaining foreign-key columns flagged by the
-- architecture audit. These keep tenant/plugin joins predictable as DV and
-- future organization plugins add more operational data.
create index if not exists idx_dv_sd_allocation_drafts_approved_by
  on plugin_data.dv_sd_allocation_drafts(approved_by);
create index if not exists idx_dv_sd_allocation_drafts_created_by
  on plugin_data.dv_sd_allocation_drafts(created_by);
create index if not exists idx_dv_sd_allocation_drafts_tournament_id
  on plugin_data.dv_sd_allocation_drafts(tournament_id);
create index if not exists idx_dv_sd_audit_events_actor_user_id
  on plugin_data.dv_sd_audit_events(actor_user_id);
create index if not exists idx_dv_sd_audit_events_season_id
  on plugin_data.dv_sd_audit_events(season_id);
create index if not exists idx_dv_sd_communication_jobs_created_by
  on plugin_data.dv_sd_communication_jobs(created_by);
create index if not exists idx_dv_sd_communication_jobs_season_id
  on plugin_data.dv_sd_communication_jobs(season_id);
create index if not exists idx_dv_sd_family_service_accounts_household_id
  on plugin_data.dv_sd_family_service_accounts(household_id);
create index if not exists idx_dv_sd_family_service_accounts_season_id
  on plugin_data.dv_sd_family_service_accounts(season_id);
create index if not exists idx_dv_sd_family_service_ledger_created_by
  on plugin_data.dv_sd_family_service_ledger(created_by);
create index if not exists idx_dv_sd_guardian_action_tokens_created_by
  on plugin_data.dv_sd_guardian_action_tokens(created_by);
create index if not exists idx_dv_sd_guardian_action_tokens_guardian_id
  on plugin_data.dv_sd_guardian_action_tokens(guardian_id);
create index if not exists idx_dv_sd_guardians_merged_into_id
  on plugin_data.dv_sd_guardians(merged_into_id);
create index if not exists idx_dv_sd_household_guardians_guardian_id
  on plugin_data.dv_sd_household_guardians(guardian_id);
create index if not exists idx_dv_sd_household_students_student_id
  on plugin_data.dv_sd_household_students(student_id);
create index if not exists idx_dv_sd_households_merged_into_id
  on plugin_data.dv_sd_households(merged_into_id);
create index if not exists idx_dv_sd_judge_assignments_v2_allocation_draft_id
  on plugin_data.dv_sd_judge_assignments_v2(allocation_draft_id);
create index if not exists idx_dv_sd_judge_assignments_v2_created_by
  on plugin_data.dv_sd_judge_assignments_v2(created_by);
create index if not exists idx_dv_sd_judge_assignments_v2_judge_id
  on plugin_data.dv_sd_judge_assignments_v2(judge_id);
create index if not exists idx_dv_sd_judge_availability_judge_id
  on plugin_data.dv_sd_judge_availability(judge_id);
create index if not exists idx_dv_sd_judge_conflicts_judge_id
  on plugin_data.dv_sd_judge_conflicts(judge_id);
create index if not exists idx_dv_sd_judge_conflicts_tournament_id
  on plugin_data.dv_sd_judge_conflicts(tournament_id);
create index if not exists idx_dv_sd_judges_guardian_id
  on plugin_data.dv_sd_judges(guardian_id);
create index if not exists idx_dv_sd_meetings_season_id
  on plugin_data.dv_sd_meetings(season_id);
create index if not exists idx_dv_sd_membership_requirements_verified_by
  on plugin_data.dv_sd_membership_requirements(verified_by);
create index if not exists idx_dv_sd_registration_entries_partner_student_id
  on plugin_data.dv_sd_registration_entries(partner_student_id);
create index if not exists idx_dv_sd_seasonal_memberships_household_id
  on plugin_data.dv_sd_seasonal_memberships(household_id);
create index if not exists idx_dv_sd_seasonal_memberships_reviewed_by
  on plugin_data.dv_sd_seasonal_memberships(reviewed_by);
create index if not exists idx_dv_sd_seasonal_memberships_season_id
  on plugin_data.dv_sd_seasonal_memberships(season_id);
create index if not exists idx_dv_sd_seasonal_memberships_student_id
  on plugin_data.dv_sd_seasonal_memberships(student_id);
create index if not exists idx_dv_sd_students_user_id
  on plugin_data.dv_sd_students(user_id);
create index if not exists idx_dv_sd_tabroom_sync_runs_created_by
  on plugin_data.dv_sd_tabroom_sync_runs(created_by);
create index if not exists idx_dv_sd_teachers_user_id
  on plugin_data.dv_sd_teachers(user_id);
create index if not exists idx_dv_sd_tournament_registrations_membership_id
  on plugin_data.dv_sd_tournament_registrations(membership_id);
create index if not exists idx_dv_sd_tournament_registrations_reviewed_by
  on plugin_data.dv_sd_tournament_registrations(reviewed_by);
create index if not exists idx_org_data_isolation_profiles_updated_by
  on public.organization_data_isolation_profiles(updated_by);
create index if not exists idx_org_plugin_data_boundaries_updated_by
  on public.organization_plugin_data_boundaries(updated_by);
create index if not exists idx_org_plugin_routes_created_by
  on public.organization_plugin_routes(created_by);

-- These plugin isolation control tables are internal control-plane state.
-- Current app access goes through server/admin code, so do not expose them as
-- direct authenticated Data API tables.
revoke select, insert, update, delete on public.organization_data_isolation_profiles
  from authenticated;
revoke select, insert, update, delete on public.organization_plugin_data_boundaries
  from authenticated;
revoke references, trigger, truncate on public.organization_data_isolation_profiles
  from authenticated;
revoke references, trigger, truncate on public.organization_plugin_data_boundaries
  from authenticated;

-- External calendar/sheet sync configuration includes account identifiers,
-- sheet URLs, calendar IDs, and integration ownership. Server actions verify
-- organization access first and then use the service client for CRUD.
revoke select, insert, update, delete on public.organization_calendar_syncs
  from authenticated;
revoke select, insert, update, delete on public.organization_sheet_syncs
  from authenticated;
revoke references, trigger, truncate on public.organization_calendar_syncs
  from authenticated;
revoke references, trigger, truncate on public.organization_sheet_syncs
  from authenticated;
