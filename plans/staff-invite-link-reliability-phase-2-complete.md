# Phase 2 Complete: Apply staff invite in OAuth callback

Phase 2 added server-side staff-invite processing in the OAuth callback so Google signups from invite links are correctly granted staff membership. The implementation is resilient: invalid, expired, and mismatched tokens do not break login redirects, and duplicate membership scenarios are handled safely.

**Files created/changed:**

- `app/auth/callback/route.ts`
- `tests/app/auth/callback.staff-invite.test.ts`

**Functions created/changed:**

- `GET` (`app/auth/callback/route.ts`)
- `handleStaffInvite` (`app/auth/callback/route.ts`)

**Tests created/changed:**

- `OAuth callback staff invite handling > should grant staff membership for valid token during OAuth`
- `OAuth callback staff invite handling > should skip membership for expired token without breaking OAuth flow`
- `OAuth callback staff invite handling > should skip membership for token mismatch (org exists, token differs) without breaking OAuth flow`
- `OAuth callback staff invite handling > should skip membership for invalid token without breaking OAuth flow`
- `OAuth callback staff invite handling > should handle duplicate membership (23505) by upgrading role from member to staff`
- `OAuth callback staff invite handling > should NOT downgrade admin to staff on duplicate membership (23505)`
- `OAuth callback staff invite handling > should proceed normally when no staff invite params present`

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
feat: apply staff invites during OAuth callback

- process staffToken and orgUsername in auth callback
- grant or upgrade staff membership for valid invite tokens
- add callback tests for invalid, expired, mismatch, and duplicate cases
