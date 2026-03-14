# Phase 1 Complete: Route query hardening

Implemented schema-tolerant waiver signature lookups for preview/download routes so missing `signature_file_url` no longer breaks requests. Legacy Priority 4 redirect remains supported when the column exists, and route-level tests now validate retry/no-retry behavior and priority ordering.

**Files created/changed:**

- app/api/waivers/[signatureId]/preview/route.ts
- app/api/waivers/[signatureId]/download/route.ts
- tests/integration/waiver-routes-schema-tolerance.test.ts

**Functions created/changed:**

- GET (preview route) in app/api/waivers/[signatureId]/preview/route.ts
- GET (download route) in app/api/waivers/[signatureId]/download/route.ts

**Tests created/changed:**

- tests/integration/waiver-routes-schema-tolerance.test.ts
  - retry without `signature_file_url` on postgres 42703
  - no-retry path when column exists
  - signup fallback behavior in missing-column vs column-exists worlds
  - priority ordering guard (upload path beats legacy redirect)

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
fix: harden waiver preview/download schema queries

- retry waiver signature lookup without deprecated column on 42703
- preserve legacy signature_file_url redirect when column exists
- add route-level schema tolerance tests for retry and priority behavior
