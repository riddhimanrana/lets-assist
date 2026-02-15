# Phase 8 Complete: Supabase/RLS Alignment + Admin Template Reliability

Phase 8 is implemented and review-approved. Global waiver template operations now run through service-role server actions with app-layer super-admin authorization, and critical reliability guardrails were added for activation/update/delete scope safety.

**Files created/changed:**

- `app/admin/waivers/actions.ts`
- `types/waiver-definitions.ts`

**Functions created/changed:**

- `getGlobalWaiverTemplates` (service-role reads + super-admin gate retained)
- `getActiveGlobalTemplate` (service-role read for RLS-resilient non-admin server flows)
- `createGlobalWaiverTemplate` (service-role storage/DB writes + detected/custom field persistence)
- `activateGlobalTemplate` (global-scope target validation + safer activation/deactivation order)
- `deleteGlobalTemplate` (global-scope target validation + guarded delete)
- `updateGlobalTemplateMetadata` (global-scope guarded update)

**Types created/changed:**

- `WaiverBuilderFieldMapping` expanded with detected-field metadata support:
  - `fieldKey?`, `label?`, `fieldType?`, `pageIndex?`, `rect?`, `pdfFieldName?`

**Tests created/changed:**

- No new test files were added in this phase.
- Validation run:
  - `bun run typecheck` ✅
  - `bun test` ✅ (102 pass, 0 fail)

**Review Status:** APPROVED

**Git Commit Message:**

```text
fix: harden global waiver admin actions for RLS

- switch global waiver template CRUD/storage operations to service-role client
- keep checkSuperAdmin app-layer authorization for privileged actions
- add global-scope guardrails for activate, delete, and metadata update flows
- persist detected and custom builder fields via shared DB mapping helpers
- extend builder field mapping type with detected field metadata fields
```
