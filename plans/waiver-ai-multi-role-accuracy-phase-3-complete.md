# Phase 3 Complete: Refine candidate and label detection

Fixed the core coordinate-scaling bug and improved structural detection for complex forms (inline underscores, contact labels, parent/guardian context mapping). Candidate geometry is now bounded and realistic, and label/candidate quality on the provided waiver improved substantially.

**Files created/changed:**

- `lib/waiver/pdf-text-extract.ts`
- `lib/waiver/label-detection.ts`
- `lib/waiver/candidate-detection.ts`
- `tests/lib/waiver/label-detection.test.ts`

**Functions created/changed:**

- `extractPdfTextWithPositions` (normalized transform + clamped geometry)
- `detectLabelType` / `isLikelyLabelText` / `isDateLabelLike`
- `detectUnderscoreCandidates` / `expandLineItemsForUnderscoreDetection` / `extractUnderscoreSegments`
- `createRightOfLabelCandidate` / `inferTypeFromLabels` / `estimatePageWidth`
- `deduplicateCandidates` overlap rules

**Tests created/changed:**

- Added regression: `avoids parent/guardian false positives in sentence text`
- Re-validated candidate detection, label detection, and route pipeline tests

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
fix: improve waiver candidate geometry and labels

- fix pdf text bbox double-scaling and clamp to page bounds
- improve inline underscore and parent-guardian contact field inference
- reduce false-positive label classification in sentence text
