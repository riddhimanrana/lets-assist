# Phase 1 Complete: Baseline with provided PDF

Established a reproducible baseline using `Volunteer Waiver 2025.pdf` and captured objective extraction/label/candidate metrics. This exposed the core geometry issue (oversized boxes) and created a reusable local harness for future regression checks.

**Files created/changed:**

- `tests/manual/waiver-ai-baseline.ts`

**Functions created/changed:**

- `main` in `tests/manual/waiver-ai-baseline.ts`

**Tests created/changed:**

- Manual baseline harness execution with `Volunteer Waiver 2025.pdf`

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
chore: add waiver ai baseline harness

- add manual baseline script for complex waiver diagnostics
- capture labels/candidates geometry and coverage metrics
- enable repeatable local baseline for future ai tuning
