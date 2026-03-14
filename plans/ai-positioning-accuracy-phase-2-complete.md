# Phase 2 Complete: Label and Candidate Detection

Implemented robust label detection and candidate writable-area detection utilities to support high-accuracy AI field placement. The phase now produces structured, scored candidates in PDF bottom-left coordinates, including strong handling for split underscore/date-token patterns.

**Files created/changed:**

- `lib/waiver/label-detection.ts`
- `lib/waiver/candidate-detection.ts`
- `tests/lib/waiver/label-detection.test.ts`
- `tests/lib/waiver/candidate-detection.test.ts`

**Functions created/changed:**

- `findLabels(textItems)`
- `detectCandidateAreas(textItems, labels)`
- Internal helpers for line grouping, underscore-run merging, scoring, and deterministic deduplication

**Tests created/changed:**

- Label detection coverage for signature/date/printed name/parent-guardian/initials/witness
- Case-insensitive + false-positive suppression tests
- Multi-token underscore pattern detection tests (including date-like split tokens)
- Right-of-label candidate generation tests
- Candidate metadata/scoring tests
- Overlap deduplication determinism tests
- Multi-page and empty-input behavior tests

**Review Status:** APPROVED

**Git Commit Message:**
feat: add waiver label and candidate detection

- Add robust label detection with context-aware matching
- Add candidate area detection from underscores and right-of-label gaps
- Merge split underscore/date token runs into single field candidates
- Add deterministic deduplication with stable tie-breaks
- Expand tests for multi-page, scoring, dedupe, and false positives
