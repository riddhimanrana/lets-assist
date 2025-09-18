import { z } from "zod";

// Schema for trusted member application form
export const trustedMemberSchema = z.object({
  fullName: z
    .string()
    .min(1, "Full name is required")
    .max(50, "Full name cannot exceed 50 characters")
    .trim(),
  email: z
    .string()
    .email("Please enter a valid email address")
    .max(100, "Email cannot exceed 100 characters")
    .trim(),
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(500, "Reason cannot exceed 500 characters")
    .trim(),
});

export type TrustedMemberValues = z.infer<typeof trustedMemberSchema>;

// Status type for trusted member applications
export type TrustedMemberStatus = "pending" | "accepted" | "denied";

// Interface for trusted member application data
export interface TrustedMemberApplication {
  id: string;
  created_at: string;
  name: string;
  email: string;
  reason?: string;
  status: boolean | null; // null = pending, true = accepted, false = denied
}