# Plan: Waiver Signing UX Overhaul (Responsive + Field-Driven + Print/Upload)

**Created:** 2026-02-12
**Status:** Ready for Atlas Execution

## Summary

Upgrade the waiver system’s configuration and signing flows to match best-practice e-sign UX: **desktop split-view (PDF + fields/sign panel)**, **mobile step-based full-screen flow**, **field-driven completion (not only “I reviewed”)**, and **first-class print/download + offline upload**. The plan aligns the UI with the current multi-signer waiver definitions model and fixes backend inconsistencies around signature asset storage and on-demand PDF generation.

## Context & Analysis

### Relevant Files

**Waiver configuration (upload + builder):**
- `app/projects/create/VerificationSettings.tsx`: project creation waiver upload + builder launcher.
- `components/waiver/WaiverBuilderDialog.tsx`: organizer builder for signers + detected fields + custom placements.
- `components/waiver/PdfViewerWithOverlay.tsx`: pdf.js renderer + overlays (drag/resize custom placements; highlight detected).
- `lib/waiver/pdf-field-detect.ts`: `detectPdfWidgets()` returns `DetectedPdfField` including `pageIndex` + `rect`.
- `app/admin/waivers/actions.ts`: global waiver definition CRUD (currently uses user supabase client).

**Waiver signing (review + sign):**
- `components/waiver/WaiverSigningDialog.tsx`: multi-signer review/sign wizard (currently signatures only).
- `components/waiver/WaiverReviewPanel.tsx`: iframe PDF review + “I reviewed” checkbox (no overlay/highlighting).
- `components/waiver/SignatureCapture.tsx`: draw/type/upload per signer.
- `app/projects/_components/WaiverSignatureSection.tsx`: legacy, field-driven signing UI (pdf-lib AcroForm detection + download actions).

**Persistence / validation / stamping:**
- `app/projects/[id]/actions.ts`: `signUpForProject()` validates payload via `validateWaiverPayload`; `persistWaiverSignature()` stores `waiver_signatures` + uploads assets.
- `lib/waiver/validate-waiver-payload.ts`: requires required signers + required non-signature fields in `payload.fields`.
- `lib/waiver/generate-signed-waiver-pdf.ts`: stamps signature images/text, **does not stamp non-signature fields**, expects image `data:` URLs.
- `app/api/waivers/[signatureId]/preview/route.ts` and `app/api/waivers/[signatureId]/download/route.ts`: organizer-only preview/download; generate on demand when `requiresPdfGeneration(payload)`.

**DB / migrations:**
- `supabase/migrations/20260210120000_waiver_definitions_schema.sql`: waiver definitions schema; RLS enabled for new tables.

### Key Problems To Solve

1. **Signing UI doesn’t match requirements:** modal sizing is cramped; desktop split exists but is not robust; mobile flow is partially hacked (checkbox overlay). No overlay-driven field completion.
2. **Multi-signer flow is not field-driven:** `WaiverSigningDialog` submits `payload.fields = {}` which can fail validation when required fields exist.
3. **Upload semantics are inconsistent:**
   - `SignatureCapture` allows per-signer upload of PDFs, but preview/download routes treat uploaded files as whole-waiver uploads via `waiver_signatures.upload_storage_path`.
   - `requiresPdfGeneration()` and `generateSignedWaiverPdf()` currently skip `method: 'upload'`.
4. **Signature asset storage mismatch:** `persistWaiverSignature()` converts drawn/uploaded signer `data` to **storage paths**, but `generateSignedWaiverPdf()` expects **data URLs**.
5. **Global waiver admin actions likely fail under current RLS:** `app/admin/waivers/actions.ts` uses user client, but new-table write policies don’t support identifying “super admin” via RLS.

### Patterns & Conventions (Codebase)

- Next.js App Router + TypeScript.
- Supabase auth best practices: `getAuthUser()` and `requireAuth()`; avoid `getSession()`.
- Server mutations via Server Actions.
- shadcn/ui components; don’t modify `components/ui/*` directly.
- “Sensitive ops” should use service-role carefully; admin actions should verify super admin via `checkSuperAdmin()`.

## Implementation Phases

### Phase 1: Decide & Normalize Signature/Upload Semantics (P0)

**Objective:** Clarify the meaning of “upload” in the new system so UI + storage + preview/download are consistent.

**Decisions (recommended):**
- **Top-level upload (offline path):** `WaiverSignatureInput.signatureType === 'upload'` = user uploads a fully signed PDF/image of the *entire waiver* (print → sign → scan/upload). Stored in `waiver_signatures.upload_storage_path`. Preview/download routes should use this.
- **Per-signer upload inside multi-signer payload:** keep but restrict to **image upload** (PNG/JPG), meaning “upload a signature image,” not a full PDF.

**Files to Modify:**
- `components/waiver/SignatureCapture.tsx`: restrict upload types for multi-signer to images only (or split UI into `SignatureCapture` vs `OfflineWaiverUpload`).
- `components/waiver/WaiverSigningDialog.tsx`: add explicit “Print & Upload Signed Waiver” mode only when `waiverAllowUpload` is true.
- `app/projects/[id]/actions.ts`: enforce `waiver_allow_upload` for both legacy and multi-signer modes.

**Tests to Write/Update:**
- Unit tests for enforcement logic (where test harness exists).

**Acceptance Criteria:**
- [ ] Multi-signer signature capture no longer permits uploading a PDF per signer.
- [ ] Offline “upload signed waiver” is available only when `projects.waiver_allow_upload = true`.
- [ ] Server rejects any offline upload attempt when not allowed.

---

### Phase 2: Fix Signature Asset Storage vs On-Demand PDF Generation (P0)

**Objective:** Ensure multi-signer signature assets can be stamped into PDFs consistently.

**Approach (recommended):**
Update `generateSignedWaiverPdf()` to resolve signer assets from **either**:
- `data:` URL (legacy / small payload), or
- Supabase Storage path string (current multi-signer persistence behavior).

**Files to Modify/Create:**
- `lib/waiver/generate-signed-waiver-pdf.ts`:
  - Support storage-path signatures for `method: 'draw'` and `method: 'upload'`.
  - Decide a detection rule: `data.startsWith('data:')` => data URL else treat as storage path.
  - Fetch bytes using service-role storage access (likely via a helper injected from calling route), OR pass a resolver callback.
- `app/api/waivers/[signatureId]/preview/route.ts`
- `app/api/waivers/[signatureId]/download/route.ts`
  - Provide the resolver context (bucket name + storage client) to generation.

**Tests to Write/Update:**
- `lib/waiver/generate-signed-waiver-pdf.test.ts`:
  - Add cases for storage-path-based signature resolution (mock fetch / mock resolver).
  - Add coverage for `method: 'upload'` signature image stamping.

**Acceptance Criteria:**
- [ ] On-demand PDF generation works for multi-signer signatures stored as storage paths.
- [ ] Preview/download routes work for multi-signer signatures where a signer uploaded an image signature.

---

### Phase 3: Stamp Non-Signature Fields Into the Generated PDF (P0)

**Objective:** Make the new system truly field-driven and produce a complete signed artifact.

**Files to Modify:**
- `lib/waiver/generate-signed-waiver-pdf.ts`:
  - Iterate `definition.fields` excluding `field_type === 'signature'`.
  - Read values from `signaturePayload.fields[field_key]`.
  - Stamp:
    - `text`/`date`: drawText within rect.
    - `checkbox`: draw checkmark/X.
    - `radio`/`dropdown`: draw selected option text.
  - Keep coordinate transforms consistent (PDF points; invert y for pdf-lib).

**Tests to Write/Update:**
- Extend `generate-signed-waiver-pdf.test.ts` to validate field stamping doesn’t throw and produces bytes; optionally use text extraction heuristics if present.
- Extend `lib/waiver/validate-waiver-payload.test.ts` for required fields mapping.

**Acceptance Criteria:**
- [ ] Required non-signature fields appear in generated PDFs at configured rects.
- [ ] `validateWaiverPayload()` passes for definitions with required fields when UI supplies `payload.fields`.

---

### Phase 4: Redesign `WaiverSigningDialog` for Responsive, Field-Driven Signing (P0)

**Objective:** Implement the researched UX blueprint:
- **Desktop:** split view (PDF + overlay) and right-side panel for required fields/signing.
- **Mobile:** full-screen sequential flow (review → fill → sign → confirm), no side-by-side.

**Key UX Behaviors:**
- Replace iframe-based review with pdf.js-based viewing to enable overlays/highlighting.
- “I reviewed” becomes part of a broader **consent + intent** step, with clear legal text.
- Provide persistent actions: **Download** and **Print** (and **Upload signed waiver** when allowed).
- Field-driven progression: show required fields, block completion until required fields for current signer are complete.

**Implementation Option A (recommended): Reuse/extend `PdfViewerWithOverlay` for signing**
- Extract a shared PDF viewer core and add a “signing” mode:
  - Overlays become interactive (click a placement to fill).
  - Highlight current required field.
  - On desktop, keep the right panel as the canonical form editor; overlay mirrors highlighting.

**Files to Modify/Create:**
- `components/waiver/WaiverSigningDialog.tsx`:
  - Update dialog sizing: use full-screen-ish patterns on mobile and large max width on desktop (`w-[min(100vw-1rem,1200px)]`, etc).
  - Add `waiverAllowUpload` prop and enforce in UI.
  - Collect `payload.fields` (per definition fields and per-signer role).
  - Add explicit “Download PDF” + “Print” actions.
  - On completion, optionally show “Download your signed copy” (calls `/api/waivers/[signatureId]/download` after insert) before closing.
- `components/waiver/WaiverReviewPanel.tsx`:
  - Deprecate iframe-only note; move to shared pdf.js view.
  - Keep open-in-new-tab as a fallback action.
- New component(s) (names are suggestions):
  - `components/waiver/WaiverSigningPdfPane.tsx`: pdf.js pane with field highlights.
  - `components/waiver/WaiverFieldForm.tsx`: renders inputs for `WaiverDefinitionField[]` and binds to `payload.fields`.
  - `components/waiver/WaiverConsentStep.tsx`: consent text + affirmation; supports WCAG “review/confirm/correct”.

**Tests to Write/Update:**
- Component tests (Vitest + RTL if used):
  - Desktop vs mobile rendering branches (mock `useMediaQuery`).
  - Required field blocking logic.

**Acceptance Criteria:**
- [ ] Desktop signing shows PDF + form panel side-by-side and uses available width.
- [ ] Mobile signing uses a step-based flow; no side-by-side; actions are reachable.
- [ ] Required fields and required signatures are enforced client-side before submit.
- [ ] Print/download options are available.

---

### Phase 5: Apply Same UX Principles to Waiver Configuration (Builder + Upload) (P1)

**Objective:** Make configuring waivers match the signing experience, reduce confusion, and ensure saved definitions contain enough data for accurate stamping.

**Key Improvements:**
- “Fields” tab should clearly distinguish:
  - **Detected PDF widgets** (AcroForm fields) vs
  - **Overlay fields** (custom placements)
- Persist enough data for detected fields:
  - `page_index`, `rect`, `pdf_field_name`, `field_type`, `label`, `required`, `signer_role_key`.
- Support editing an existing definition even when `pdfFile` is not present:
  - Fetch the PDF from `pdf_public_url` and run detection client-side, or
  - Use existing `definition.fields` as the source of truth for detected widgets.

**Files to Modify:**
- `components/waiver/WaiverBuilderDialog.tsx`:
  - Improve responsiveness (it’s close already): ensure `max-w-*` classes are valid and actually widen on desktop.
  - Ensure mapping of detected fields includes `pageIndex`/`rect` on save (derive from `detectedFields` list).
  - Add preview: “Preview signer experience” launches `WaiverSigningDialog` in a non-persist mode.
- `components/waiver/FieldListPanel.tsx`:
  - Expand mapping model to carry the minimum needed for persistence OR ensure the server action re-derives from `detectedFields`.
- `app/projects/create/VerificationSettings.tsx`:
  - Update copy to match the new flow: “Configure required fields & signatures”.
  - Don’t auto-open builder on upload on mobile; instead show a “Configure waiver” CTA (mobile-friendly).

**Tests to Write/Update:**
- Integration test update: ensure saving definition persists proper rect/page for detected fields.

**Acceptance Criteria:**
- [ ] Saving builder results in complete, accurate `waiver_definition_fields` records for both detected and custom fields.
- [ ] Builder supports editing without requiring re-upload.
- [ ] Builder is usable on tablet; mobile warns and provides minimal path.

---

### Phase 6: Signup Flow Integration (P1)

**Objective:** Ensure volunteers can complete signing smoothly, and that signups enforce waiver completion correctly.

**Files to Modify:**
- `app/projects/[id]/ProjectForm.tsx`
- `app/projects/_components/SignupConfirmationModal.tsx`
- `app/anonymous/[id]/AnonymousSignupClient.tsx`
- `app/projects/[id]/ProjectDetails.tsx` (waiver config fetch, ensure `waiverAllowUpload` is passed into signing dialog)

**Behavior Changes:**
- “Sign Waiver” triggers the improved `WaiverSigningDialog`.
- After successful completion, show immediate “Download your signed copy” and “Continue signup”.

**Acceptance Criteria:**
- [ ] Signup cannot complete if waiver is required and not completed.
- [ ] Offline upload path works end-to-end (when allowed) and stores `upload_storage_path`.

---

### Phase 7: Organizer Access & Download UX (P1)

**Objective:** Organizers can reliably preview/download waivers from manage signups; avoid storing stamped PDFs repeatedly.

**Files to Modify:**
- `app/projects/[id]/signups/SignupsClient.tsx`: ensure download/preview handles multi-signer stamping + offline uploads.
- `components/projects/WaiverPreviewDialog.tsx`: add explicit “Print” and “Download” actions.
- API routes: `app/api/waivers/[signatureId]/preview/route.ts`, `download/route.ts`:
  - Consider extending authorization to include the signer themselves (optional), in addition to organizers.

**Acceptance Criteria:**
- [ ] Organizer can preview/download both multi-signer generated PDFs and offline uploaded PDFs.
- [ ] No redundant storage of stamped PDFs is introduced (continue on-demand generation).

---

### Phase 8: Supabase/RLS Alignment + Admin Global Template Reliability (P1)

**Objective:** Ensure admin global waiver CRUD works and RLS doesn’t accidentally block app routes.

**Recommended Strategy:**
- Keep app-layer authorization (`checkSuperAdmin()` / organizer checks).
- Use `getAdminClient()` for admin writes to waiver definition tables (avoid trying to represent super-admin in RLS).

**Files to Modify:**
- `app/admin/waivers/actions.ts`:
  - Use service-role for inserts/updates/deletes (and for storage upload if bucket is private).
  - Keep `checkSuperAdmin()` gate.

**DB Follow-up (optional defense-in-depth):**
- Add a follow-up migration to tighten overly-broad SELECT policies on waiver definition tables.

**Supabase MCP Steps (Atlas should do during execution):**
- Apply the follow-up migration(s) to development and production.
- Re-run Supabase advisors and ensure no new RLS-related regressions.

**Acceptance Criteria:**
- [ ] Global template admin screens work without relying on RLS “admin” columns.
- [ ] Preview/download endpoints remain functional under RLS.

---

### Phase 9: AI Waiver Analysis Route + Builder Integration Hardening (P2)

**Objective:** Keep the “AI Scan” workflow reliable and aligned with the new field-driven signing model.

**Context:** The builder’s AI scan is used to suggest signer roles and field placements. This is part of the waiver configuration experience and should output:

- signer roles (role keys + labels + required)
- fields with stable `field_key`, `field_type`, `page_index`, and `rect` coordinates

**Files to Modify:**

- `app/api/ai/analyze-waiver/route.ts`
  - Remove any usage/import of deprecated/incorrect AI SDK exports.
  - Ensure response schema is stable and validated (e.g., Zod) so UI can safely render results.
  - Return both `pageCount` and a normalized field list.
- `components/waiver/WaiverBuilderDialog.tsx`
  - Confirm AI scan results map cleanly into `CustomPlacement[]` and/or detected field mappings.
  - Improve user feedback: “what we detected”, “what needs review”, and “how to fix”.

**Supabase MCP Verification (Atlas):**

- Verify the `waiver_signatures` columns referenced by API routes exist (`signature_payload`, `upload_storage_path`, and any `signature_file_url` used in selects).
- Verify storage buckets exist and have expected public/private policies (`waivers`, `waiver-uploads`, signature bucket).

**Tests to Write/Update:**

- Route-level unit tests (if present in repo patterns) for schema validation and error paths.

**Acceptance Criteria:**

- [ ] AI scan returns validated, predictable JSON.
- [ ] Builder can apply AI scan output without breaking field alignment.
- [ ] No TypeScript/lint errors remain in the AI route.

---

## Open Questions

1. **Signer self-access to signed waiver:** Should `/api/waivers/[signatureId]/download` be accessible to the signer (user/anonymous) as well as organizers?
   - Option A: yes (better UX), with strict auth check to match `waiver_signatures.user_id/anonymous_id`.
   - Option B: organizers only (current), signer gets a separate “receipt” link.

2. **Per-signer upload method:** Should multi-signer upload allow only signature images (recommended) or also PDFs?
   - Recommendation: images only for per-signer; full-PDF uploads only via top-level offline upload mode.

3. **Field types coverage:** Do we need radio/dropdown/options immediately in overlay UI, or can we start with text/date/checkbox + signature?

## Risks & Mitigation

- **Risk:** PDF overlay coordinate drift across zoom/device DPR.
  - **Mitigation:** Use PDF.js viewport transforms consistently; add snapshot tests around transform logic; avoid ad-hoc DOM matrix math.

- **Risk:** Large uploads or malicious files.
  - **Mitigation:** strict allowlists + size limits already present; consider adding scanning pipeline later.

- **Risk:** RLS breaks admin/global actions.
  - **Mitigation:** use service role for admin writes; keep RLS conservative for user clients.

## Success Criteria

- [ ] Waiver signing modal is fully responsive: desktop split-view, mobile step flow.
- [ ] Signing is field-driven and validates required signers + required fields.
- [ ] Print/download/upload options exist and behave predictably.
- [ ] On-demand PDF generation stamps signatures + fields correctly for multi-signer flows.
- [ ] Organizers can preview/download waivers from manage signups.
- [ ] Global template admin actions are reliable and compatible with RLS.

## Notes for Atlas

- Prefer incremental changes with tests after each phase.
- Be careful when changing payload semantics: update validator, persistence, and PDF generation together.
- Use `getAuthUser()`/`requireAuth()` patterns for authorization; keep sensitive operations behind service role when needed.
- Consider adding a small “UX contract” test matrix in `tests/MANUAL_QA_CHECKLIST.md` after implementing the new flows.
