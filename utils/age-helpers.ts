/**
 * Age calculation utilities for CIPA compliance
 * All age-based logic centralized here
 */

/**
 * Calculate user age from date of birth
 * Returns -1 if DOB not provided
 */
export function calculateAge(dateOfBirth: string | Date | null): number {
  if (!dateOfBirth) return -1;

  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

/**
 * Check if user is under 13 (COPPA threshold)
 */
export const isUnder13 = (dob: string | Date | null): boolean => {
  return calculateAge(dob) < 13;
};

/**
 * Check if user is a minor (under 18)
 */
export const isMinor = (dob: string | Date | null): boolean => {
  return calculateAge(dob) < 18;
};

/**
 * Check if user is a teenager (13-17)
 */
export const isTeenager = (dob: string | Date | null): boolean => {
  const age = calculateAge(dob);
  return age >= 13 && age < 18;
};
