import "server-only";

import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";

type OrganizationPluginContextError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type OrganizationPluginContextResult<T> = {
  data: T | null;
  error: OrganizationPluginContextError | null;
};

export class OrganizationPluginContextUnavailableError extends Error {
  constructor(readName: string, cause?: unknown) {
    super(`Organization plugin ${readName} is temporarily unavailable.`, {
      cause,
    });
    this.name = "OrganizationPluginContextUnavailableError";
  }
}

/**
 * Reads one organization-plugin routing dependency without conflating a
 * legitimate absent row with transport or database uncertainty.
 */
export async function readOrganizationPluginContext<T>(
  readName: string,
  query: () =>
    | PromiseLike<OrganizationPluginContextResult<T>>
    | OrganizationPluginContextResult<T>,
): Promise<T | null> {
  let result: OrganizationPluginContextResult<T>;
  try {
    result = await withRetryableSupabaseQuery(query, {
      maxAttempts: 2,
      initialDelayMs: 75,
      maxDelayMs: 75,
    });
  } catch (error) {
    throw new OrganizationPluginContextUnavailableError(readName, error);
  }

  if (result.error) {
    throw new OrganizationPluginContextUnavailableError(readName, result.error);
  }

  return result.data;
}
