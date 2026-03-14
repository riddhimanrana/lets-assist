## Plan: Waiver AI multi-role accuracy

Restore strong multi-role and multi-field detection for complex waivers while retaining the current UI/UX and candidate pipeline. We will baseline with the provided PDF, strengthen Gemini prompting and selection constraints, then refine structural candidate generation for complex tables and signature blocks.

**Phases 5**
1. **Phase 1: Baseline with provided PDF**
    - **Objective:** Measure current detection performance against `Volunteer Waiver 2025.pdf` and capture role/field gaps.
    - **Files/Functions to Modify/Create:** `tests/e2e/` (baseline harness), `app/api/ai/analyze-waiver/route.ts` (if instrumentation needed)
    - **Tests to Write:** Playwright baseline flow to upload PDF and collect detected roles/fields.
    - **Steps:**
        1. Run the current flow with the provided PDF.
        2. Capture detected signer roles and field counts.
        3. Identify obvious misses (tables, initials, repeated signature blocks).

2. **Phase 2: Improve AI prompt and role detection**
    - **Objective:** Make Gemini 2.5 Flash-Lite reliably enumerate all roles and map fields across repeated/complex sections.
    - **Files/Functions to Modify/Create:** `app/api/ai/analyze-waiver/route.ts`
    - **Tests to Write:** Route-level checks for multi-role role coverage and minimum candidate utilization.
    - **Steps:**
        1. Refine prompt with explicit multi-role extraction rules.
        2. Add strict instructions for repeated blocks and table rows.
        3. Keep deterministic fallback when AI misses candidate IDs.

3. **Phase 3: Refine candidate and label detection**
    - **Objective:** Improve structural candidate quality for complex layouts without removing the pipeline.
    - **Files/Functions to Modify/Create:** `lib/waiver/candidate-detection.ts`, `lib/waiver/label-detection.ts`, `lib/waiver/pdf-text-extract.ts`
    - **Tests to Write:** Unit tests for table-like blocks, initials/email sections, and denser multi-column forms.
    - **Steps:**
        1. Improve label normalization and role-context mapping.
        2. Improve candidate generation around tables and grouped rows.
        3. Ensure deterministic de-duplication and stable ranking.

4. **Phase 4: Enhance UI review feedback**
    - **Objective:** Keep existing UX, but improve confidence/coverage feedback in builder review.
    - **Files/Functions to Modify/Create:** `components/waiver/WaiverBuilderDialog.tsx`, `components/waiver/FieldListPanel.tsx`
    - **Tests to Write:** Component assertions for role/field summary display.
    - **Steps:**
        1. Surface clearer role/field totals.
        2. Flag possible under-detection conditions.
        3. Keep existing interaction model unchanged.

5. **Phase 5: End-to-end Playwright validation**
    - **Objective:** Validate real behavior by uploading the provided PDF and checking output quality.
    - **Files/Functions to Modify/Create:** `tests/e2e/waiver-ai-detection.spec.ts` and any Playwright config wiring
    - **Tests to Write:** Upload + analyze + assert role/field count thresholds.
    - **Steps:**
        1. Run Playwright test with `Volunteer Waiver 2025.pdf`.
        2. Record final role/field counts and summary output.
        3. Report measured improvements.

**Open Questions 2**
1. What exact minimum thresholds should gate success for this PDF? (e.g., roles >= 3, fields >= 10)
2. Should we keep the PDF fixture local-only or commit into `tests/fixtures/` for CI replay?