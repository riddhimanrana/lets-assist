import { z } from "zod";

// Constants for phone validation
export const PHONE_LENGTH = 10; // For raw digits
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // Format XXX-XXX-XXXX
export const ANON_PROFILE_STORAGE_KEY =
  "letsassist.anonymous-signup-profile.v2";
export const LEGACY_ANON_PROFILE_STORAGE_KEYS = [
  "letsassist.anonymous-signup-profile.v1",
] as const;
export const ANON_PROFILE_AUTO_APPLY_KEY =
  "letsassist.anonymous-signup-auto-apply.v1";
export const ANON_WAIVER_CACHE_KEY =
  "letsassist.anonymous-signup-waiver-cache.v1";

// Helper function to format phone number input
export const formatPhoneNumber = (value: string): string => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, ""); // Allow only digits
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
  }
  return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};

// Helper function to format relative time
export const formatRelativeTime = (isoString: string): string => {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export interface SavedAnonymousProfile {
  name: string;
  email: string;
  updatedAt: string;
}

type LegacySavedAnonymousProfile = SavedAnonymousProfile & {
  phone?: string;
};

const sanitizeSavedAnonymousProfile = (
  value: unknown,
): SavedAnonymousProfile | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<LegacySavedAnonymousProfile>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const email =
    typeof candidate.email === "string"
      ? candidate.email.trim().toLowerCase()
      : "";
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
      ? candidate.updatedAt
      : new Date().toISOString();

  if (name.length < 2 || !email.includes("@")) {
    return null;
  }

  return {
    name,
    email,
    updatedAt,
  };
};

export const loadSavedAnonymousProfile = (): SavedAnonymousProfile | null => {
  if (typeof window === "undefined") return null;

  const storageKeys = [
    ANON_PROFILE_STORAGE_KEY,
    ...LEGACY_ANON_PROFILE_STORAGE_KEYS,
  ];

  for (const storageKey of storageKeys) {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) continue;

    try {
      const sanitizedProfile = sanitizeSavedAnonymousProfile(JSON.parse(raw));
      if (!sanitizedProfile) {
        window.localStorage.removeItem(storageKey);
        continue;
      }

      const serializedProfile = JSON.stringify(sanitizedProfile);
      if (
        storageKey !== ANON_PROFILE_STORAGE_KEY ||
        raw !== serializedProfile
      ) {
        window.localStorage.setItem(
          ANON_PROFILE_STORAGE_KEY,
          serializedProfile,
        );
      }

      if (storageKey !== ANON_PROFILE_STORAGE_KEY) {
        window.localStorage.removeItem(storageKey);
      }

      return sanitizedProfile;
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }

  return null;
};

export const formSchema = z.object({
  name: z.string().min(2, { message: "Name is required" }),
  email: z.string().email({ message: "Invalid email address" }),
  phone: z
    .string()
    .refine(
      // Validate against the XXX-XXX-XXXX format if a value exists
      (val) => !val || val === "" || PHONE_REGEX.test(val),
      "Phone number must be in format XXX-XXX-XXXX",
    )
    .transform((val) => {
      // Store only digits if validation passes
      if (!val || val === "") return undefined;
      return val.replace(/\D/g, ""); // Remove non-digit characters
    })
    .refine(
      // Ensure exactly 10 digits if a value exists
      (val) => !val || val.length === PHONE_LENGTH,
      `Phone number must contain exactly ${PHONE_LENGTH} digits.`,
    )
    .optional() // Make the entire refined/transformed field optional
    .or(z.literal("").transform(() => undefined)),
  comment: z
    .string()
    .max(100, { message: "Comment must be 100 characters or less" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type FormValues = z.infer<typeof formSchema>;
