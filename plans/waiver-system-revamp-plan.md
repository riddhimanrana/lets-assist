# Plan: Waiver System Revamp (PDF Builder + Multi‑Signer + Signed Artifacts)

**Created:** 2026-02-11
**Status:** Ready for Atlas Execution

## Summary

Upgrade the waiver system so organizers can upload a waiver PDF and immediately get a “waiver builder” dialog that (1) detects existing e-signature (AcroForm) fields, (2) visually highlights them on the PDF, and (3) lets the organizer add fully-custom signature placements and signer roles (e.g., Student + Parent/Guardian) even when the PDF has no form fields. Then, update volunteer signup (anonymous + logged-in) to use a dedicated waiver signing dialog (mobile-friendly) that supports draw/type/upload and produces an auditable waiver record, optionally including a generated/flattened “signed PDF” artifact.

## Context & Analysis

### Relevant Files (current behavior)

- `app/projects/_components/WaiverSignatureSection.tsx`
  - Current waiver signing UI (draw/type/upload) and **client-side** PDF form-field detection using `pdf-lib` (field types only; no coordinates; no overlay on the PDF). Displays PDF via `<iframe>`.
- `app/projects/_components/SignupConfirmationModal.tsx`
  - Logged-in signup confirmation modal embeds `WaiverSignatureSection` when `waiverRequired`.
- `app/projects/[id]/ProjectForm.tsx`
  - Anonymous signup dialog form embeds `WaiverSignatureSection` when `waiverRequired`.
- `app/projects/[id]/ProjectDetails.tsx`
  - Wires anonymous + logged-in flows; passes `waiverTemplate` and `waiverPdfUrl` into signup UI.
- `app/projects/[id]/actions.ts`
  - Server actions:
    - `getProjectWaiver()` chooses project-specific PDF if present, else falls back to global `waiver_templates`.
    - `uploadProjectWaiverPdf()` / `removeProjectWaiverPdf()` manage project waiver PDFs in Storage.
    - `persistWaiverSignature()` stores waiver signature metadata + uploaded assets into `waiver_signatures`.
    - `signUpForProject()` enforces waiver requirements and calls `persistWaiverSignature()`.
- `app/projects/create/VerificationSettings.tsx`
  - Project creation waiver upload uses a **naive** byte-string heuristic to detect signature fields (`/Sig`, `/AcroForm`, etc.). No builder dialog.
- `app/projects/[id]/edit/EditProjectClient.tsx`
  - Project edit UI validates waiver PDF with the same naive heuristic and calls `uploadProjectWaiverPdf()`.
- `types/waiver.ts`
  - Types exist for `WaiverTemplate`, `WaiverSignature`, `WaiverSignatureInput`, and project waiver config.
- `docs/AUTH_PATTERNS.md`
  - Requires server actions to use `getAuthUser()` / `requireAuth()` (avoid direct `supabase.auth.getUser()` except sensitive ops).

### Key Gaps vs Requested Requirements

1. **Upload-time builder dialog is missing**
   - Uploading a waiver PDF only stores `waiver_pdf_url` and shows a warning if signature fields aren’t detected.

2. **Field detection lacks geometry**
   - Current detection via `pdf-lib` (signing UI) and string scanning (upload/edit) cannot reliably provide page + rect coordinates.

3. **No customizable signature placements / roles**
   - No concept of (Student / Parent) signers, per-field requiredness, or custom signature “slots”.

4. **No generated signed artifact**
   - Waiver signatures are stored as metadata + uploaded assets; system does not stamp signatures into a PDF and flatten.

5. **Global waiver template is read-only**
   - `waiver_templates` is used as a fallback, but there is no admin UI to create/version/activate templates.

### Dependencies & Libraries

- Existing:
  - `pdf-lib` (already installed): great for server-side stamping + flattening and basic field enumeration.
- Recommended add:
  - PDF viewer + widget geometry extraction using **PDF.js**.
  - Choose one:
    - `react-pdf` (uses PDF.js) for fastest React integration, or
    - `pdfjs-dist` directly for maximal control.

**Recommendation:** Hybrid approach: PDF.js for viewing + coordinates; `pdf-lib` for stamping/flattening.

### Patterns & Conventions to Follow

- Server mutations via Server Actions (existing pattern).
- Supabase auth via `getAuthUser()` / `requireAuth()` (per `docs/AUTH_PATTERNS.md`).
- UI via Tailwind + shadcn/ui components; mobile via responsive layouts and optional bottom sheets (repo already uses `vaul`).

## Implementation Phases

### Phase 1: Data Model & Storage Design (Supabase)

**Objective:** Introduce first-class “waiver definitions” so PDFs can have saved signer roles + signature placements, while keeping current flows working.

**Files to Modify/Create:**
- **New migration(s)** (Atlas will create using Supabase migration tooling):
  - Add table `waiver_definitions`
  - Add table `waiver_definition_fields`
  - Add table `waiver_definition_signers`
  - Extend `waiver_signatures` to reference definitions and store richer payload
  - Extend `projects` to reference the active definition

**Proposed schema (v1, backward-compatible):**

- `waiver_definitions` (one per project waiver PDF; optionally one global)
  - `id uuid pk`
  - `scope text check in ('project','global')`
  - `project_id uuid null`
  - `title text`
  - `version int`
  - `active boolean`
  - `pdf_storage_path text null`
  - `pdf_public_url text null` (optional if you keep PDFs public)
  - `source text check in ('project_pdf','global_pdf')`
  - `created_by uuid null`
  - `created_at`, `updated_at`

- `waiver_definition_signers`
  - `id uuid pk`
  - `waiver_definition_id uuid fk`
  - `role_key text` (e.g., `volunteer`, `student`, `parent_guardian`)
  - `label text` (UI label)
  - `required boolean`
  - `order int`
  - `rules jsonb null` (future: age rules, conditional requirements)

- `waiver_definition_fields`
  - `id uuid pk`
  - `waiver_definition_id uuid fk`
  - `field_key text` (stable ID for mapping)
  - `field_type text check in ('signature','text','checkbox','radio','dropdown','option_list')`
  - `label text`
  - `required boolean`
  - `source text check in ('pdf_widget','custom_overlay')`
  - `pdf_field_name text null` (for `pdf_widget`)
  - `page_index int`
  - `rect jsonb` (e.g., `{x,y,width,height}` in PDF points)
  - `signer_role_key text null` (for signature fields)
  - `meta jsonb null` (options list, etc.)

- `projects` additions
  - `waiver_definition_id uuid null`

- `waiver_signatures` additions (keep existing columns)
  - `waiver_definition_id uuid null`
  - `signed_pdf_storage_path text null`
  - `signed_pdf_public_url text null` (or omit if private)
  - `signature_payload jsonb null` (captures multi-signer signatures + field values)

**RLS & Policies (high level):**
- `waiver_definitions*`: readable by anyone who can view the project (waiver document must be visible to signers). Writable only by project creator/org staff.
- `waiver_signatures`: insert allowed for signers at signup time; read allowed to project creator and the signer (authenticated) and to anonymous signer only via a tokenized download endpoint.
- Storage:
  - Keep project waiver PDFs public **or** provide signed URLs. Signed waivers should be stored privately where possible.

**Acceptance Criteria:**
- [ ] DB supports saving: signer roles + signature placements + detected fields per uploaded waiver PDF.
- [ ] Existing signing flow still works if `waiver_definition_id` is null.

---

### Phase 2: Robust PDF Field Detection with Coordinates

**Objective:** Replace heuristic signature detection with deterministic extraction of widget annotations (including signature fields) and their rectangles.

**Files to Modify/Create:**
- New util: `lib/waiver/pdf-field-detect.ts`
- Update:
  - `app/projects/create/VerificationSettings.tsx`
  - `app/projects/[id]/edit/EditProjectClient.tsx`

**Steps:**
1. Implement `detectPdfWidgets(fileOrUrl)` using PDF.js:
   - Iterate pages; call `page.getAnnotations()`; filter `subtype === 'Widget'`.
   - Extract `fieldName`, `fieldType`, `rect`, `required` when available.
   - Normalize geometry to `{pageIndex, rectInPdfPoints}`.
2. Keep a fallback to the existing heuristic if PDF.js fails to load.
3. Surface results in UI as:
   - count of detected fields
   - count of detected signature widgets
   - warnings when none found

**Acceptance Criteria:**
- [ ] Upload/edit flows reliably detect existing signature widgets (not just string scanning).
- [ ] Detection returns page + rect coordinates for highlighting and mapping.

---

### Phase 3: Waiver Builder Dialog (Organizer UX)

**Objective:** On waiver PDF upload (create + edit), always open a builder dialog that shows the PDF and detected fields side-by-side, and allows adding custom signature placements and signer roles.

**Files to Modify/Create:**
- New components (suggested locations):
  - `components/waiver/WaiverBuilderDialog.tsx`
  - `components/waiver/PdfViewerWithOverlay.tsx`
  - `components/waiver/SignerRolesEditor.tsx`
  - `components/waiver/FieldListPanel.tsx`
- Update:
  - `app/projects/create/VerificationSettings.tsx` (after file validation)
  - `app/projects/[id]/edit/EditProjectClient.tsx` (after file validation)
- New server action:
  - `app/projects/[id]/actions.ts`: `saveProjectWaiverDefinition(...)` and `getProjectWaiverDefinition(...)`

**Builder UX Requirements (matches request):**
- Always show the dialog after selecting/uploading a PDF, even if no signature fields exist.
- Left: PDF viewer with page navigation/zoom.
- Overlay: highlight detected widgets (including existing signature fields).
- Right: panels:
  - “Detected PDF Fields” list (assign/match to roles; mark required/optional)
  - “Signer Roles” editor (add/edit/reorder; defaults to a single required signer)
  - “Signature Placements” editor (add new signature slot; click to place; drag/resize; assign to role)

**Implementation detail:**
- Replace iframe-based PDF preview with a PDF.js-driven renderer so overlay placement is possible.
- Store placements in PDF points; reproject to screen pixels each render.

**Acceptance Criteria:**
- [ ] Organizer can upload a waiver PDF and immediately configure signature placements.
- [ ] Organizer can configure multiple signer roles (Student/Parent/etc.) and assign placements to each.
- [ ] Definition is saved and loaded for the project.

---

### Phase 4: Waiver Signing Dialog (Volunteer UX, mobile-first)

**Objective:** Update volunteer signup to use a dedicated signing dialog launched by a button (“Review & Sign Waiver”), supporting draw/type/upload and multiple required signers.

**Files to Modify/Create:**
- New components:
  - `components/waiver/WaiverSigningDialog.tsx`
  - `components/waiver/SignatureCapture.tsx` (extract from existing `WaiverSignatureSection` logic)
- Update:
  - `app/projects/_components/SignupConfirmationModal.tsx`
  - `app/projects/[id]/ProjectForm.tsx`
  - `app/anonymous/[id]/AnonymousSignupClient.tsx` (if it supports any waiver step/preview/download)
  - Potentially deprecate or wrap `app/projects/_components/WaiverSignatureSection.tsx`

**Signing UX:**
- Button shows dialog/full-screen sheet on mobile.
- Stepper on mobile:
  1) Review PDF
  2) Signer 1 signature
  3) (Optional) Signer 2 signature
  4) Confirm consent + submit
- Support three signature methods (already required): draw, typed, upload.
- For PDFs with defined signature placements:
  - Tap a placement to sign that slot.
  - Show completion status per required slot/signer.

**Payload:**
- Replace single `WaiverSignatureInput` with a backward-compatible superset:
  - `signature_payload` includes:
    - `definitionId`
    - per-signer signature method + data
    - per-field values (text/checkbox/etc.)

**Acceptance Criteria:**
- [ ] Anonymous + logged-in signup flows both can open a waiver dialog and complete signing.
- [ ] Multiple signer roles are enforced when required by the waiver definition.
- [ ] Existing single-signer projects continue to work.

---

### Phase 5: Server-Side Validation + Optional Signed PDF Generation

**Objective:** Ensure the server validates waiver completion against the definition and optionally generates a flattened signed PDF artifact.

**Files to Modify/Create:**
- Update `app/projects/[id]/actions.ts`:
  - Validate payload in `signUpForProject()` before creating signup or before persisting signature.
  - Extend `persistWaiverSignature()` to:
    - store `waiver_definition_id`
    - store `signature_payload`
    - if signature method is draw/typed and placements exist: stamp signatures into the PDF, fill fields, flatten, upload `signed.pdf`, store storage path.
- New server utilities:
  - `lib/waiver/validate-waiver-payload.ts`
  - `lib/waiver/generate-signed-waiver-pdf.ts`

**Notes:**
- `pdf-lib` can stamp images/text and flatten AcroForm fields.
- This is **visual stamping**, not cryptographic digital signatures; store audit metadata (IP/UA already captured).

**Acceptance Criteria:**
- [ ] Server rejects signups if required waiver signers/fields are incomplete.
- [ ] Signed artifact is generated for draw/typed signatures when placements exist.
- [ ] Upload-based signing continues to store the uploaded file as-is.

---

### Phase 6: Global Waiver Template Management (Admin)

**Objective:** Provide a “global waiver template” that is editable/versioned and can be used when projects don’t upload a custom PDF.

**Files to Modify/Create:**
- New admin route:
  - `app/admin/waivers/page.tsx`
  - `app/admin/waivers/actions.ts` (server actions)
- Reuse existing `waiver_templates` table for rich text templates, and/or allow a global `waiver_definition` with a PDF.

**Admin features (v1):**
- Create new version (increments `version`, sets `active=false` by default)
- Activate a version (set previous active=false)
- Edit title/content
- Optional: upload a global waiver PDF and define its placements (reuse builder)

**Acceptance Criteria:**
- [ ] Admin can manage the active global waiver.
- [ ] Projects without a custom waiver PDF correctly fall back to the active global waiver.

---

### Phase 7: Backward Compatibility + Migration Strategy

**Objective:** Ensure older projects and stored signatures continue to function.

**Strategy:**
- If a project has `waiver_pdf_url` but no `waiver_definition_id`, create an implicit “legacy” definition on first edit/save (or lazily on first builder open).
- If `waiver_signatures` rows lack `waiver_definition_id`, treat them as legacy and keep displaying downloadable assets.

**Acceptance Criteria:**
- [ ] No breaking changes to existing signups.
- [ ] Legacy projects can be upgraded to definitions via the builder.

---

### Phase 8: Testing + QA Checklist

**Objective:** Add confidence and prevent regressions in critical signing paths.

**Suggested tests (choose a minimal viable set):**
- Unit tests for `validate-waiver-payload` (pure TS).
- Unit tests for coordinate normalization/reprojection helpers.
- (Optional) Integration-style test for `generate-signed-waiver-pdf` using a fixture PDF.

**Manual QA checklist:**
- Project create: upload PDF with existing signature widgets → builder highlights them.
- Project create: upload PDF with no fields → builder still opens; can place custom signature slots.
- Configure Student + Parent/Guardian → signing requires both.
- Anonymous signup: completes waiver, confirmation email works, signature is persisted.
- Logged-in signup: completes waiver in confirmation modal and persists signature.
- Mobile: signing dialog is usable (stepper + bottom sheet; no tiny controls).

## Open Questions

1. **Do you require cryptographic (“true”) PDF digital signatures?**
   - **Option A:** Visual stamping + audit record (recommended v1; implementable with `pdf-lib`).
   - **Option B:** PKCS#7 signing (requires additional infra/library/service).
   - **Recommendation:** Start with Option A; add Option B only if a legal requirement emerges.

2. **Should signed waiver PDFs be public or private?**
   - **Option A:** Public with unguessable paths (simpler, but sensitive).
   - **Option B:** Private bucket + server-generated signed URLs (more secure; requires token flow for anonymous signers).
   - **Recommendation:** Private for signed artifacts; add a download endpoint that authorizes via (user id) or (anonymous confirmation token).

3. **How should “Parent signature required” be determined?**
   - **Option A:** Organizer config only (builder defines required roles).
   - **Option B:** Dynamic rule (e.g., based on DOB / under-13 logic in `schemas/signup-schema.ts`).
   - **Recommendation:** v1: organizer config only; v2: optional conditional rules in `waiver_definition_signers.rules`.

## Risks & Mitigation

- **Risk:** PDF rendering + overlay placement is complex on mobile (zoom/pan gesture conflicts).
  - **Mitigation:** Use a stepper and prefer tap-to-place with nudge buttons; implement drag/resize only after MVP.

- **Risk:** PDF field coordinate extraction differs across PDFs.
  - **Mitigation:** Prefer PDF.js `getAnnotations()` geometry; keep fallback detection and allow custom placements.

- **Risk:** Backward compatibility with existing `WaiverSignatureSection`.
  - **Mitigation:** Implement new dialogs behind a feature flag or progressively adopt; keep legacy path if definition absent.

## Success Criteria

- [ ] Uploading a waiver PDF always opens a builder dialog that shows the PDF side-by-side with detected fields.
- [ ] Organizers can add custom signature placements and define multiple signer roles.
- [ ] Signup (anonymous + logged-in) uses a waiver signing dialog with draw/type/upload and enforces required signers.
- [ ] Waiver signatures are persisted with audit metadata; signed artifact generation works when configured.
- [ ] Global waiver template is manageable (versioned + active) and used as fallback.

## Notes for Atlas

- Prefer `getAuthUser()` / `requireAuth()` for server actions per `docs/AUTH_PATTERNS.md`.
- Keep changes incremental: introduce definitions first, then builder, then signing dialog, then PDF stamping.
- Avoid replacing `WaiverSignatureSection` immediately; consider wrapping it inside the new dialog as a transitional step.
- Use dynamic imports for PDF.js/react-pdf to minimize bundle impact.
