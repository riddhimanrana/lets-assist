/**
 * COPPA Compliance - Minor Restrictions
 * 
 * Defines what features are restricted for users under 13
 * to comply with the Children's Online Privacy Protection Act
 */

export const MINOR_RESTRICTIONS = {
  // Profile visibility
  publicProfile: false,
  showEmail: false,
  showPhone: false,
  showSocialMedia: false,
  
  // Communication
  directMessaging: false,
  publicComments: false,
  
  // Social features
  socialSharing: false,
  followUsers: false,
  
  // Analytics and tracking
  analytics: false,
  behavioralAds: false,
  thirdPartyTracking: false,
  
  // Data collection
  locationTracking: false,
  photoUpload: true, // Allowed but parent must consent
  
  // Organization features
  requireParentalApprovalForOrgs: true,
  canCreateOrganization: false,
} as const;

export type MinorRestriction = keyof typeof MINOR_RESTRICTIONS;

/**
 * Check if a minor can access a specific feature
 */
export function canAccessFeature(
  feature: MinorRestriction,
  isMinor: boolean,
  hasParentalConsent: boolean = false
): boolean {
  // Non-minors have full access
  if (!isMinor) return true;
  
  // Minors without parental consent have no access
  if (!hasParentalConsent) return false;
  
  // With parental consent, check specific restriction
  return MINOR_RESTRICTIONS[feature];
}

/**
 * Get list of restricted features for display
 */
export function getRestrictedFeatures(isMinor: boolean): string[] {
  if (!isMinor) return [];
  
  return Object.entries(MINOR_RESTRICTIONS)
    .filter(([_, isRestricted]) => !isRestricted)
    .map(([feature]) => formatFeatureName(feature));
}

/**
 * Format feature name for display
 */
function formatFeatureName(feature: string): string {
  return feature
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Check if user profile can be viewed publicly
 */
export function canViewProfile(
  viewerIsMinor: boolean,
  profileOwnerIsMinor: boolean,
  hasParentalConsent: boolean
): boolean {
  // Minors' profiles are never public
  if (profileOwnerIsMinor) {
    return false;
  }
  
  // Non-minor profiles can be viewed by anyone
  return true;
}

/**
 * Get PostHog configuration for user
 */
export function getAnalyticsConfig(
  isMinor: boolean,
  hasParentalConsent: boolean
) {
  // Disable all analytics for minors per COPPA
  if (isMinor) {
    return {
      enabled: false,
      capture_pageview: false,
      disable_session_recording: true,
      disable_surveys: true,
    };
  }
  
  // Full analytics for adults
  return {
    enabled: true,
    capture_pageview: true,
    disable_session_recording: false,
    disable_surveys: false,
  };
}

/**
 * Check if cookies can be set for user
 */
export function canSetCookies(
  cookieType: "essential" | "analytics" | "marketing",
  isMinor: boolean,
  hasParentalConsent: boolean
): boolean {
  // Essential cookies always allowed
  if (cookieType === "essential") return true;
  
  // No non-essential cookies for minors
  if (isMinor) return false;
  
  // Full cookie access for adults
  return true;
}
