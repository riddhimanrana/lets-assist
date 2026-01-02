// Email domain detection and validation helpers

/**
 * Extract domain from email address
 */
export function getEmailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || "";
}

/**
 * Get default profile visibility
 */
export function getDefaultProfileVisibility(): "public" | "private" {
  // Default to public for all users
  return "public";
}
