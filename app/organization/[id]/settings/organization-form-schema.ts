import * as z from "zod";

import {
  ORGANIZATION_USERNAME_MAX_LENGTH,
  organizationUsernameSchema,
} from "@/lib/organization/username";
import type { Organization } from "@/types";

export const USERNAME_MAX_LENGTH = ORGANIZATION_USERNAME_MAX_LENGTH;
export const NAME_MAX_LENGTH = 64;
export const WEBSITE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 650;

export const ORG_TYPE_LABELS: Record<string, string> = {
  nonprofit: "Nonprofit organization",
  school: "Educational institution",
  company: "Company/business",
  government: "Government agency",
  other: "Other",
};

export const ORG_TYPE_OPTIONS = [
  "nonprofit",
  "school",
  "company",
  "government",
  "other",
] as const;
export type OrganizationTypeOption = (typeof ORG_TYPE_OPTIONS)[number];

export const orgUpdateSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(NAME_MAX_LENGTH, `Name cannot exceed ${NAME_MAX_LENGTH} characters`),

  username: organizationUsernameSchema,

  description: z
    .string()
    .max(
      DESCRIPTION_MAX_LENGTH,
      `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`,
    )
    .optional(),

  website: z
    .string()
    .max(
      WEBSITE_MAX_LENGTH,
      `Website URL cannot exceed ${WEBSITE_MAX_LENGTH} characters`,
    )
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),

  type: z.enum(["nonprofit", "school", "company", "government", "other"]),

  logoUrl: z.string().optional().nullable(),

  showMembersPublicly: z.boolean().optional(),
});

export type OrganizationFormValues = z.infer<typeof orgUpdateSchema>;

export type OrganizationWithSettings = Organization & {
  website?: string | null;
  auto_join_domain?: string | null;
  type?: string | null;
  logo_url?: string | null;
  show_members_publicly?: boolean | null;
};
