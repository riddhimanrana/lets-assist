import { z } from "zod";

// Constants for character limits
const USERNAME_MAX_LENGTH = 32;
const USERNAME_MIN_LENGTH = 3;

// Regex for username: letters, numbers, underscore, period, hyphen
export const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

export const initialOnboardingSchema = z.object({
  username: z
    .string()
    .min(USERNAME_MIN_LENGTH, "Username must be at least 3 characters")
    .max(USERNAME_MAX_LENGTH, `Username cannot exceed ${USERNAME_MAX_LENGTH} characters`)
    .regex(USERNAME_REGEX, "Username can only contain letters, numbers, underscores, hyphens, and periods")
    .transform((val) => val.toLowerCase()) // <-- force lowercase
    .refine(value => value.trim().length > 0, {
      message: "Username cannot be empty or just whitespace",
    }),
  phoneNumber: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string()
      .refine(
        (val) => !val || /^\d{3}-\d{3}-\d{4}$/.test(val),
        "Phone number must be in format XXX-XXX-XXXX"
      )
      .transform((val) => {
        if (!val) return undefined;
        // Remove all non-digit characters before storing
        return val.replace(/\D/g, "");
      })
      .optional()
  ),
});

export type InitialOnboardingValues = z.infer<typeof initialOnboardingSchema>;
