# Phase 4 Complete: Coordinate Standardization

Phase 4 standardized the waiver AI/stamping pipeline to a single coordinate contract: PDF points with bottom-left origin. Ambiguous conversion/inference behavior was removed, and stamping now uses coordinates directly without y-axis flipping.

**Files created/changed:**

- `app/api/ai/analyze-waiver/route.ts`
- `lib/waiver/generate-signed-waiver-pdf.ts`
- `lib/waiver/generate-signed-waiver-pdf.test.ts`
- `lib/waiver/generate-signed-waiver-pdf-phase3.test.ts`

**Functions created/changed:**

- `normalizeFieldsForOverlay(fields, pageDimensions, pageCount)`
  - Enforced points-based `boundingBox` input only
  - Removed coordinate-system ambiguity and y-flip paths
- `generateSignedWaiverPdf(options)`
  - Removed y inversion for signature and non-signature stamping
  - Uses bottom-left coordinates directly for drawImage/drawText

**Tests created/changed:**

- Added assertion test for signature image stamping y-coordinate (no flip)
- Added assertion coverage for non-signature text/checkbox stamping y-coordinate (no flip)
- Existing normalization tests continue to verify bottom-left behavior and no flipping

**Review Status:** APPROVED

**Git Commit Message:**

```text
refactor: standardize waiver coordinates to bottom-left

- Enforce single coordinate contract in AI normalization (PDF points)
- Remove coordinate ambiguity and y-flip logic from route normalization
- Update PDF stamping to use bottom-left coordinates directly
- Add tests asserting no y-axis flipping for signature and field stamping
- Preserve backward-compatible waiver analysis response shape
```
