import { z } from "zod";

export const ORGANIZATION_USERNAME_MIN_LENGTH = 3;
export const ORGANIZATION_USERNAME_MAX_LENGTH = 32;

export const organizationUsernameSchema = z
  .string()
  .min(
    ORGANIZATION_USERNAME_MIN_LENGTH,
    `Username must be at least ${ORGANIZATION_USERNAME_MIN_LENGTH} characters`,
  )
  .max(
    ORGANIZATION_USERNAME_MAX_LENGTH,
    `Username cannot exceed ${ORGANIZATION_USERNAME_MAX_LENGTH} characters`,
  )
  .regex(/^[a-z0-9_.-]+$/u, {
    message:
      "Username can only contain lowercase letters, numbers, underscores, dots and hyphens",
  })
  .refine((value) => !value.includes(".."), {
    message: "Username cannot contain consecutive dots",
  })
  .refine((value) => !value.startsWith(".") && !value.endsWith("."), {
    message: "Username cannot start or end with a dot",
  });

export function validateOrganizationUsername(
  value: string,
): { ok: true } | { ok: false; error: string } {
  const parsed = organizationUsernameSchema.safeParse(value);
  if (parsed.success) return { ok: true };
  return {
    ok: false,
    error: parsed.error.issues[0]?.message ?? "Enter a valid username",
  };
}
