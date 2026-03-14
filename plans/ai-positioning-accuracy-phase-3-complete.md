# Phase 3 Complete: Enhanced AI Schema

Phase 3 refactored waiver AI analysis from coordinate generation to candidate-selection classification, using structured document context. The route now sends pages/text/labels/candidates/widgets context to Gemini 2.5 Flash Lite and maps selected candidate IDs back into the existing `analysis.fields[].boundingBox` response contract.

**Files created/changed:**

- `app/api/ai/analyze-waiver/route.ts`
- `tests/app/api/ai/analyze-waiver-route.test.ts`

**Functions created/changed:**

- Candidate-selection schema and mapping flow in `POST` handler
- Structured payload construction (including capped text items + coordinates)
- Safe mapping behavior for invalid/missing candidate IDs

**Tests created/changed:**

- Route-level schema/mapping coverage for candidate selection
- Invalid candidate ID handling coverage
- No-candidate fallback behavior coverage
- Backward-compatible response-shape coverage

**Review Status:** APPROVED

**Git Commit Message:**

```text
feat: refactor waiver AI to candidate selection

- Switch AI contract from raw geometry output to candidate-id selection
- Send structured pages/text/labels/candidates/widgets context to model
- Map selected candidate IDs back to existing boundingBox response shape
- Handle invalid IDs and empty-candidate fallback safely
- Add route-level tests for schema, mapping, and compatibility
```
