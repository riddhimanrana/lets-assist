## Phase 1 Complete: Shadcn date picker in waiver fields

Replaced waiver `date` fields with a shadcn Popover + Calendar date picker while preserving the stored `YYYY-MM-DD` value format, honoring min/max constraints, and keeping stable automation hooks.

**Files created/changed:**
- `components/ui/date-picker.tsx`
- `components/waiver/WaiverFieldForm.tsx`
- `tests/lib/waiver/date-picker-utils.test.ts`
- `tests/components/waiver/WaiverFieldForm.test.tsx`

**Functions created/changed:**
- `DatePicker` (new)
- `WaiverFieldForm` date field rendering (now uses `DatePicker`)

**Tests created/changed:**
- `tests/lib/waiver/date-picker-utils.test.ts`
- `tests/components/waiver/WaiverFieldForm.test.tsx`

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
feat: use shadcn date picker for waivers

- Replace native date input with Popover + Calendar picker
- Preserve YYYY-MM-DD storage format and min/max constraints
- Add component tests for waiver date fields
