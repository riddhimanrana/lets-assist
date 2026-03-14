# Plan: Waiver UX Template & Dashboard Fixes

Improve waiver signing UX consistency (shadcn Calendar), make global waiver template fallback reliable, render filled field/signature values on the PDF overlay in realtime (desktop), fix organizer signups table showing false “waiver missing”, and ensure users (including anonymous profiles) can view their submitted waiver.


## Phases

1. **Phase 1: Shadcn date picker in waiver fields**
    - **Objective:** Replace waiver field `date` inputs with a shadcn Calendar-based date picker while preserving stored value format (`YYYY-MM-DD`) and min/max constraints.
    - **Files/Functions to Modify/Create:**
        - `components/waiver/WaiverFieldForm.tsx` (date field renderer)
        - (Optional) `components/ui/date-picker.tsx` (date-only picker wrapper)
    - **Tests to Write:**
        - Unit/component test ensuring selecting a date writes `YYYY-MM-DD` into the change handler for a `date` waiver field.
    - **Steps:**
        1. Add failing test for date field value format and change propagation.
        2. Implement shadcn `Popover` + `Calendar` date picker.
        3. Preserve `minDate`/`maxDate` behavior via disabled days.
        4. Make tests pass.

2. **Phase 2: Global waiver template fallback reliability**
    - **Objective:** Ensure projects without a project-specific waiver reliably fall back to the active global `waiver_definition` (scope `global`) and that signing persists correctly.
    - **Files/Functions to Modify/Create:**
        - `app/admin/waivers/actions.ts` (global template selection query)
        - `app/projects/[id]/actions.ts` (`getProjectWaiver`, `persistWaiverSignature`)
    - **Tests to Write:**
        - Server-action tests covering `getProjectWaiver` fallback order and multiple active globals returning deterministically.
    - **Steps:**
        1. Add failing tests for global fallback behavior.
        2. Change global template query to tolerate multiple active rows (order + maybeSingle).
        3. Ensure persistence path respects `waiver_definitions` (not only legacy templates).
        4. Make tests pass.

3. **Phase 3: Realtime PDF overlay of entered values (desktop)**
    - **Objective:** On desktop, show entered field values and signatures over the PDF in realtime while the user types/signs (DOM overlay; stamp PDF only on final submit).
    - **Files/Functions to Modify/Create:**
        - `components/waiver/PdfViewerWithOverlay.tsx` (render value layer)
        - `components/waiver/WaiverSigningDialog.tsx` (pass `fieldValues` and `signatures`; provide placements for all fields)
    - **Tests to Write:**
        - Component test verifying the overlay renders a value for a placement when `fieldValues`/`signatures` are provided.
    - **Steps:**
        1. Add failing test for overlay value rendering.
        2. Extend viewer props to accept values/signatures.
        3. Render text/checkmarks/signature images using existing coordinate transforms.
        4. Wire state down from signing dialog.
        5. Make tests pass.

4. **Phase 4: Fix organizer signups “waiver missing” false negatives**
    - **Objective:** Ensure organizer signups table displays correct waiver status even under restrictive RLS by fetching waiver signature presence via server-authorized code.
    - **Files/Functions to Modify/Create:**
        - `app/projects/[id]/signups/SignupsClient.tsx` (stop relying on client-side embed of `waiver_signatures`)
        - Add a server action to fetch signups + waiver signature presence using `getAdminClient()` with explicit organizer authorization.
    - **Tests to Write:**
        - Server-action test: authorized organizer receives waiver status for signups.
    - **Steps:**
        1. Add failing test for waiver status mapping.
        2. Implement server action (admin client + permission checks).
        3. Update UI to use server action results.
        4. Make tests pass.

5. **Phase 5: View submitted waivers (logged-in + anonymous)**
    - **Objective:** Ensure a volunteer can view their submitted waiver after signup, including from anonymous profiles.
    - **Files/Functions to Modify/Create:**
        - `app/projects/[id]/UserDashboard.tsx` (ensure signed waiver entry links to preview/download)
        - `app/anonymous/**` (ensure anonymous profile includes waiver preview/download for its signup)
        - If needed, server actions/utilities reusing existing `checkWaiverAccess` logic.
    - **Tests to Write:**
        - Integration/E2E test verifying waiver preview/download accessible for signed user and anonymous profile.
    - **Steps:**
        1. Add failing test for “view submitted waiver” in both contexts.
        2. Add UI links/actions to open preview/download routes.
        3. Ensure authorization works via existing server routes.
        4. Make tests pass.


## Open Questions

1. None (value format confirmed: `YYYY-MM-DD`; realtime overlay should include all fields; dashboard issue confirmed as organizer signups table).
