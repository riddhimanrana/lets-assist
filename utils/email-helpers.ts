// Email domain detection and validation helpers

const SCHOOL_DOMAINS = [
  "srvusd.net",
  // Add more school domains as needed
];

/**
 * Check if an email belongs to a known school domain
 */
export function isSchoolEmail(email: string): boolean {
  const domain = getEmailDomain(email);
  return SCHOOL_DOMAINS.includes(domain);
}

/**
 * Extract domain from email address
 */
export function getEmailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || "";
}

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: string | Date): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
}

/**
 * Determine age verification status based on age
 */
export function getAgeVerificationStatus(
  age: number,
): "verified" | "parental_consent_required" {
  return age < 13 ? "parental_consent_required" : "verified";
}

/**
 * Get default profile visibility based on email and age
 */
export function getDefaultProfileVisibility(
  email: string,
  age?: number,
): "public" | "private" | "organization_only" {
  const isSchool = isSchoolEmail(email);

  // School accounts are private by default
  if (isSchool) return "private";

  // Users under 13 get private profiles
  if (age !== undefined && age < 13) return "private";

  // Everyone else is public by default
  return "public";
}
