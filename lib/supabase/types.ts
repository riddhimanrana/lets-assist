/**
 * Shared auth types for the application
 *
 * These types represent the user authentication claims
 * extracted from JWT tokens via getClaims() or getUser()
 */

export type AuthClaims = {
  id: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  user_metadata: Record<string, any> | null;
  app_metadata: Record<string, any> | null;
  expires_at?: number;
};

/**
 * Type for user object returned by auth helpers
 */
export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  user_metadata: Record<string, any> | null;
  app_metadata: Record<string, any> | null;
};
