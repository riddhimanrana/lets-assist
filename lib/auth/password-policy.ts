import { z } from "zod";

/** Mirrors the local Supabase `letters_digits` password policy. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/u, "Password must include at least one letter")
  .regex(/\d/u, "Password must include at least one number");
