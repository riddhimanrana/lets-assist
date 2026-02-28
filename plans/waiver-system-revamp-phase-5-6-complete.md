# Phases 5-6 Complete: Builder UX & Signup Integration

Completed builder refactor for unified field management, detected/custom field mapping, signup integration with strict validation, download support for all signature types, and security enhancements.

**Files created/changed:**

- lib/waiver/map-definition-input.ts (created - field mapping helpers)
- components/organization/waiver/WaiverBuilderDialog.tsx
- components/organization/waiver/WaiverFieldListPanel.tsx
- app/projects/[id]/actions.ts (saveWaiverDefinition, getWaiverDownloadUrl)
- app/api/waivers/[signatureId]/preview/route.ts
- app/api/waivers/[signatureId]/download/route.ts
- app/home/UserDashboard.tsx
- app/anonymous/[id]/AnonymousSignupClient.tsx
- tests/waiver-critical-fixes.test.ts (created - comprehensive tests)

**Functions created/changed:**

- mapDetectedFieldsForDb (new helper)
- mapCustomPlacementsForDb (new helper)
- saveWaiverDefinition (refactored to use helpers, persist all DB columns)
- getWaiverDownloadUrl (updated for all signature types)
- GET /api/waivers/:id/preview (anonymous + signer support)
- GET /api/waivers/:id/download (anonymous + signer support + security)
- handleDownloadSignedWaiver (dashboard download logic)
- handleDownload (anonymous download logic)

**Tests created/changed:**

- Detected field persistence tests (all required columns)
- Custom placement persistence tests (all required columns)
- Anonymous download security tests (anonymousSignupId validation)
- Dashboard download logic tests
- Field type preservation tests (text, checkbox, signature)
- Default value tests (label, required, signerRoleKey)

**Review Status:** APPROVED

**Key Features Delivered:**

- ✅ Unified field management (detected + custom)
- ✅ Field mapping includes all DB columns (label, source, page_index, rect, fieldType, pdfFieldName, signerRoleKey)
- ✅ Preview tab for both detected and custom fields
- ✅ AI field detection integrated
- ✅ Tablet support (768px cutoff)
- ✅ State reset on dialog close
- ✅ Error handling (AI failures, persistence)
- ✅ Signup validation against waiver fields
- ✅ Dashboard "My Signed Waivers" with downloads
- ✅ Download route supports organizer/signer/anonymous
- ✅ Anonymous download requires anonymousSignupId validation
- ✅ Tests exercise real production logic
- ✅ Global fetch properly restored in tests
- ✅ All 86 tests passing

**Git Commit Message:**

```text
feat: builder UX refactor and signup integration for waiver system

- Extract field mapping to testable helpers (mapDetectedFieldsForDb, mapCustomPlacementsForDb)
- Fix detected field persistence to include all required DB columns (label, source, page_index, rect, pdf_field_name, signer_role_key)
- Add tablet support (768px cutoff) for builder
- Implement unified field management (detected + custom)
- Add preview tab for detected and custom fields
- Integrate AI field detection
- Add state reset on dialog close
- Implement signup validation against waiver fields
- Add "My Signed Waivers" section to dashboard
- Extend download/preview routes for signer/anonymous access
- Add anonymous download security (anonymousSignupId validation)
- Add comprehensive tests for field persistence and download security
- Fix global fetch mutation in tests
```
