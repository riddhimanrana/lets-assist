import type { MfaAssuranceLike, MfaListFactorsLike } from "@/lib/auth/mfa";
import { shouldPromptForMfaChallenge } from "@/lib/auth/mfa";
import { isStaleSupabaseAuthUserError } from "@/lib/supabase/auth-errors";

export type MfaLookupErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

export type MfaSessionState = {
  requiresMfa: boolean;
  invalidUser: boolean;
  lookupError: MfaLookupErrorLike | null;
};

export function resolveMfaSessionState(input: {
  assurance: MfaAssuranceLike | null | undefined;
  factors: MfaListFactorsLike | null | undefined;
  assuranceError?: MfaLookupErrorLike | null;
  factorsError?: MfaLookupErrorLike | null;
}): MfaSessionState {
  if (
    isStaleSupabaseAuthUserError(input.assuranceError) ||
    isStaleSupabaseAuthUserError(input.factorsError)
  ) {
    return {
      requiresMfa: false,
      invalidUser: true,
      lookupError: null,
    };
  }

  const lookupError = input.assuranceError ?? input.factorsError ?? null;
  if (lookupError) {
    return {
      requiresMfa: false,
      invalidUser: false,
      lookupError,
    };
  }

  return {
    requiresMfa: shouldPromptForMfaChallenge(input.assurance, input.factors),
    invalidUser: false,
    lookupError: null,
  };
}
