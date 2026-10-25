import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password-policy";

export const existingAccountSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const createAccountSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Enter a valid email address"),
  password: passwordSchema,
});

export type ExistingAccountValues = z.infer<typeof existingAccountSchema>;
export type CreateAccountValues = z.infer<typeof createAccountSchema>;
