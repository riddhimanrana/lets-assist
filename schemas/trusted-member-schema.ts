import { z } from "zod";

export const trustedMemberSchema = z.object({
  name: z.string()
    .min(1, "Full name is required")
    .max(50, "Name must be 50 characters or less"),
  email: z.string()
    .email("Please enter a valid email address")
    .max(100, "Email must be 100 characters or less"),
  reason: z.string()
    .min(1, "Reason is required")
    .max(500, "Reason must be 500 characters or less"),
});

export type TrustedMemberFormData = z.infer<typeof trustedMemberSchema>;