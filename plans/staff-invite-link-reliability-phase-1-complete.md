# Phase 1 Complete: Preserve invite context in OAuth start

Phase 1 implemented and verified staff invite context propagation into Google OAuth initiation so callback can consume invite metadata in the next phase. The implementation is backward compatible for non-invite signups and includes focused regression tests.

**Files created/changed:**

- `app/signup/actions.ts`
- `app/signup/SignupClient.tsx`
- `tests/app/signup/actions.staff-invite.test.ts`

**Functions created/changed:**

- `signInWithGoogle` (`app/signup/actions.ts`)
- `getSiteUrl` (`app/signup/actions.ts`)
- `handleGoogleSignIn` (`app/signup/SignupClient.tsx`)

**Tests created/changed:**

- `signInWithGoogle - Staff Invite Flow > should include staff invite params in redirectTo when provided`
- `signInWithGoogle - Staff Invite Flow > should omit invite params when not provided`
- `signInWithGoogle - Staff Invite Flow > should handle null redirectAfterAuth with staff invite`
- `signInWithGoogle - Staff Invite Flow > should preserve backward compatibility for simple invocation`

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
feat: preserve staff invite OAuth context

- pass staff invite context from signup client to OAuth start
- include invite params in auth callback redirect URL
- add focused tests for invite + backward-compatible paths
