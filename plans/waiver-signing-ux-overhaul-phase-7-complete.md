# Phase 7 Complete: Organizer Access & Download UX

Implemented organizer/signer/anonymous waiver access parity for preview/download routes and added explicit print/download actions in the waiver preview dialog, while keeping on-demand PDF generation and offline-upload serving behavior intact.

**Files created/changed:**

- `app/api/waivers/[signatureId]/preview/route.ts`
- `app/api/waivers/[signatureId]/download/route.ts`
- `components/projects/WaiverPreviewDialog.tsx`
- `lib/waiver/preview-auth-helpers.ts`
- `tests/integration/waiver-preview-auth.test.ts`

**Functions created/changed:**

- `GET` in `app/api/waivers/[signatureId]/preview/route.ts`
- `GET` in `app/api/waivers/[signatureId]/download/route.ts`
- `checkWaiverAccess` in `lib/waiver/preview-auth-helpers.ts`
- `getContentDisposition` in `lib/waiver/preview-auth-helpers.ts`
- `WaiverPreviewDialog` print handler and iframe loading reset in `components/projects/WaiverPreviewDialog.tsx`

**Tests created/changed:**

- `tests/integration/waiver-preview-auth.test.ts`
  - organizer authorization cases
  - signer self-access cases
  - anonymous `anonymousSignupId` validation cases
  - content-disposition helper coverage
- Existing preview/download regression suite re-run:
  - `tests/integration/waiver-preview-download.test.ts`

**Review Status:** APPROVED

**Git Commit Message:**
feat: improve waiver preview access and print UX

- unify preview/download authorization for organizer, signer, and anonymous flows
- use service-role reads in waiver routes to avoid RLS blocking anonymous auth checks
- add print action and iframe loading reset in waiver preview dialog
- add focused authorization tests and keep preview/download regressions green
