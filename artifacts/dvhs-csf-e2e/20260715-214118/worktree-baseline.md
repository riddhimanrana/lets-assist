# Dirty worktree baseline

Captured before task-specific implementation on 2026-07-15 for run `20260715-214118`.

## Branches

```
root: codex/supabase-mcp-hardening
private: development
```

## Root worktree

```
M SPEC.md
 M app/organization/[id]/page.tsx
 M components/organization/OrganizationHeader.tsx
 M components/organization/OrganizationTabs.tsx
 m lib/plugins/private
 M package.json
 M scripts/local-dev/seed-platform.mjs
 M scripts/local-dev/test-dvhs-csf-workflows.mjs
 M services/google-sheets.ts
 M supabase/tests/database/csf_atomic_point_workflows.test.sql
 M supabase/tests/database/csf_class_history_import.test.sql
 M types/plugin.ts
?? DVHS_CSF_PRODUCT_SPEC.md
?? artifacts/
?? scripts/local-dev/test-dvhs-csf-scale.mjs
?? supabase/migrations/20260714235236_dvhs_csf_application_operations_foundation.sql
?? supabase/migrations/20260715001830_dvhs_csf_semester_service_lifecycle.sql
?? supabase/migrations/20260715003820_csf_import_numeric_credits.sql
?? supabase/migrations/20260715005340_csf_term_deadline_operations.sql
?? supabase/migrations/20260715005407_harden_csf_term_closure.sql
?? supabase/migrations/20260715010232_csf_member_correction_operations.sql
?? supabase/migrations/20260715010505_csf_application_import.sql
?? supabase/migrations/20260715013000_require_csf_point_policy.sql
?? supabase/migrations/20260715013410_csf_member_point_submission_withdrawal.sql
?? supabase/migrations/20260716032057_dvhs_csf_close_term_permission.sql
?? supabase/migrations/20260716044050_dvhs_csf_staff_access_rbac.sql
?? supabase/migrations/20260716044620_dvhs_csf_import_reconciliation.sql
?? supabase/tests/database/csf_application_import.test.sql
?? supabase/tests/database/csf_application_operations_foundation.test.sql
?? supabase/tests/database/csf_member_correction_operations.test.sql
?? supabase/tests/database/csf_member_point_submission_withdrawal.test.sql
?? supabase/tests/database/csf_semester_service_lifecycle.test.sql
?? supabase/tests/database/csf_staff_access_rbac.test.sql
?? supabase/tests/database/csf_term_closure_readiness.test.sql
?? supabase/tests/database/csf_term_deadline_operations.test.sql
```

## Private plugin worktree

```
M plugins/dv-speech-debate/actions.ts
 M plugins/dv-speech-debate/ai-features.ts
 M plugins/dv-speech-debate/communications.ts
 M plugins/dv-speech-debate/components/DvJudgesTab.tsx
 M plugins/dv-speech-debate/components/DvMembersTab.tsx
 M plugins/dv-speech-debate/forms.ts
 M plugins/dv-speech-debate/judge-allocation.ts
 M plugins/dv-speech-debate/leadership.ts
 M plugins/dv-speech-debate/lifecycle.ts
 M plugins/dv-speech-debate/meetings.ts
 M plugins/dv-speech-debate/membership-flow.ts
 M plugins/dv-speech-debate/plugin.tsx
 M plugins/dv-speech-debate/services/access.ts
 M plugins/dv-speech-debate/services/allocation-service.test.ts
 M plugins/dv-speech-debate/services/allocation-service.ts
 M plugins/dv-speech-debate/services/audit-service.ts
 M plugins/dv-speech-debate/services/communication-service.ts
 M plugins/dv-speech-debate/services/guardian-token-service.ts
 M plugins/dv-speech-debate/services/household-service.ts
 M plugins/dv-speech-debate/services/judge-service.ts
 M plugins/dv-speech-debate/services/membership-service.ts
 M plugins/dv-speech-debate/services/tabroom-provider.test.ts
 M plugins/dv-speech-debate/services/tabroom-provider.ts
 M plugins/dv-speech-debate/services/tournament-service.ts
 M plugins/dv-speech-debate/tabroom.ts
 M plugins/dv-speech-debate/tournament-manager.ts
 M plugins/dv-speech-debate/workflow-actions.ts
 M plugins/dvhs-csf/actions.ts
 D plugins/dvhs-csf/components/CsfAnnouncementDialog.tsx
 M plugins/dvhs-csf/components/CsfApplicationReviewDialog.tsx
 M plugins/dvhs-csf/components/CsfClassTermActionsMenu.tsx
 M plugins/dvhs-csf/components/CsfClassTerms.tsx
 M plugins/dvhs-csf/components/CsfCloseTermDialog.tsx
 M plugins/dvhs-csf/components/CsfDashboard.tsx
 M plugins/dvhs-csf/components/CsfDashboardPrimitives.tsx
 M plugins/dvhs-csf/components/CsfDashboardTypes.ts
 M plugins/dvhs-csf/components/CsfFormControls.tsx
 M plugins/dvhs-csf/components/CsfMeetings.tsx
 D plugins/dvhs-csf/components/CsfPointProcessingWorkspace.tsx
 M plugins/dvhs-csf/components/CsfPostComponents.tsx
 M plugins/dvhs-csf/components/CsfProfileActionsMenu.tsx
 M plugins/dvhs-csf/components/CsfProfileDetailView.tsx
 M plugins/dvhs-csf/components/CsfProfileDialogs.tsx
 M plugins/dvhs-csf/components/CsfProfileTermWorkspace.tsx
 M plugins/dvhs-csf/components/CsfProfilesRoster.tsx
 M plugins/dvhs-csf/components/CsfSubmissionReviewDialog.tsx
 M plugins/dvhs-csf/components/CsfWorkspaceShell.tsx
 M plugins/dvhs-csf/components/PartnerClubsWorkflow.tsx
 M plugins/dvhs-csf/constants.ts
 M plugins/dvhs-csf/domain.test.ts
 M plugins/dvhs-csf/domain.ts
 M plugins/dvhs-csf/lifecycle.ts
 M plugins/dvhs-csf/plugin.tsx
 M plugins/dvhs-csf/services/dashboard.ts
 M plugins/dvhs-csf/services/meeting-attendance.test.ts
 M plugins/dvhs-csf/services/meeting-attendance.ts
 M plugins/dvhs-csf/services/roles.ts
 M plugins/dvhs-csf/services/sheet-import.test.ts
 M plugins/dvhs-csf/services/sheet-import.ts
 M registry.ts
?? plugin-action-security-boundaries.test.ts
?? plugins/dv-speech-debate/access.ts
?? plugins/dv-speech-debate/activity.ts
?? plugins/dv-speech-debate/member-server-boundaries.test.ts
?? plugins/dv-speech-debate/services/admin-cutover.test.ts
?? plugins/dv-speech-debate/services/reliability.test.ts
?? plugins/dvhs-csf/components/CsfAccountConnectionsPanel.tsx
?? plugins/dvhs-csf/components/CsfActivityStatusMenu.tsx
?? plugins/dvhs-csf/components/CsfApplicationOperations.tsx
?? plugins/dvhs-csf/components/CsfApplicationsWorkspace.tsx
?? plugins/dvhs-csf/components/CsfCopyActivitySummaryButton.tsx
?? plugins/dvhs-csf/components/CsfDeadlineControls.tsx
?? plugins/dvhs-csf/components/CsfGoogleSheetPickerField.tsx
?? plugins/dvhs-csf/components/CsfMemberCorrectionDialogs.tsx
?? plugins/dvhs-csf/components/CsfMemberWorkspace.tsx
?? plugins/dvhs-csf/components/CsfOfficerHome.tsx
?? plugins/dvhs-csf/components/CsfReportsWorkspace.tsx
?? plugins/dvhs-csf/components/CsfSemesterWorkspace.tsx
?? plugins/dvhs-csf/components/CsfServiceWorkspace.tsx
?? plugins/dvhs-csf/components/CsfSheetImportWorkspace.tsx
?? plugins/dvhs-csf/components/CsfStaffAccessWorkspace.tsx
?? plugins/dvhs-csf/components/CsfWithdrawPointSubmissionDialog.tsx
?? plugins/dvhs-csf/components/csf-application-check-policy.test.ts
?? plugins/dvhs-csf/components/csf-application-check-policy.ts
?? plugins/dvhs-csf/components/csf-applications-workspace.test.ts
?? plugins/dvhs-csf/navigation.test.ts
?? plugins/dvhs-csf/navigation.ts
?? plugins/dvhs-csf/services/activity-summary.test.ts
?? plugins/dvhs-csf/services/activity-summary.ts
?? plugins/dvhs-csf/services/point-submission-authorization.test.ts
?? plugins/dvhs-csf/services/point-submission-authorization.ts
?? plugins/dvhs-csf/services/queue-results.test.ts
?? plugins/dvhs-csf/services/queue-results.ts
?? plugins/dvhs-csf/services/report-export.test.ts
?? plugins/dvhs-csf/services/report-export.ts
?? plugins/dvhs-csf/services/roles.test.ts
?? plugins/dvhs-csf/services/security-boundaries.test.ts
?? plugins/dvhs-csf/services/staff-position-authorization.ts
```

This baseline is evidence only. Unrelated changes are preserved and excluded from the task-specific touched-file list.

