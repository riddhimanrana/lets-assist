"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAdminClient } from "@/lib/supabase/admin";
import type { SystemBanner } from "@/types/system-banner";
import { checkSuperAdmin } from "../actions";

type BannerActionState = {
  success: boolean;
  error?: string;
  message?: string;
};

const EMPTY_ACTION_STATE: BannerActionState = {
  success: false,
};

const parseOptionalString = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const parseBoolean = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") return false;
  return ["on", "true", "1", "yes"].includes(value.toLowerCase());
};

const parseOptionalDateTime = (value: string | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "invalid" as const;
  }
  return date.toISOString();
};

const bannerScopeSchema = z.enum(["sitewide", "landing"]);

const bannerTypeSchema = z.enum(["info", "success", "warning", "outage"]);
const bannerTextAlignSchema = z.enum(["left", "center", "right"]);

const bannerFormSchema = z
  .object({
    bannerId: z.string().uuid().optional(),
    targetScope: bannerScopeSchema,
    bannerType: bannerTypeSchema,
    title: z.string().max(120).optional(),
    message: z.string().min(1).max(1000),
    ctaLabel: z.string().max(40).optional(),
    ctaUrl: z
      .string()
      .max(255)
      .optional()
      .refine(
        (url) =>
          !url ||
          url.startsWith("/") ||
          /^https?:\/\//i.test(url),
        "CTA URL must start with /, http://, or https://",
      ),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    isActive: z.boolean().default(false),
    dismissible: z.boolean().default(false),
    showIcon: z.boolean().default(true),
    textAlign: bannerTextAlignSchema.default("center"),
  })
  .superRefine((data, ctx) => {
    const startsAt = parseOptionalDateTime(data.startsAt);
    const endsAt = parseOptionalDateTime(data.endsAt);

    if (startsAt === "invalid") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsAt"],
        message: "Start date is invalid",
      });
    }

    if (endsAt === "invalid") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date is invalid",
      });
    }

    if (startsAt && endsAt && startsAt !== "invalid" && endsAt !== "invalid") {
      if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endsAt"],
          message: "End date must be after the start date",
        });
      }
    }
  });

const SELECT_COLUMNS =
  "id, title, message, banner_type, target_scope, is_active, starts_at, ends_at, cta_label, cta_url, dismissible, show_icon, text_align, created_at, updated_at";

export async function getSystemBannersForAdmin(): Promise<{
  data: SystemBanner[];
  error?: string;
}> {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { data: [], error: "Unauthorized" };
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("system_banners")
    .select(SELECT_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []) as SystemBanner[] };
}

export async function saveSystemBanner(
  _prevState: BannerActionState = EMPTY_ACTION_STATE,
  formData: FormData,
): Promise<BannerActionState> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const rawInput = {
    bannerId: parseOptionalString(formData.get("bannerId")),
    targetScope: parseOptionalString(formData.get("targetScope")),
    bannerType: parseOptionalString(formData.get("bannerType")),
    title: parseOptionalString(formData.get("title")),
    message: parseOptionalString(formData.get("message")),
    ctaLabel: parseOptionalString(formData.get("ctaLabel")),
    ctaUrl: parseOptionalString(formData.get("ctaUrl")),
    startsAt: parseOptionalString(formData.get("startsAt")),
    endsAt: parseOptionalString(formData.get("endsAt")),
    isActive: parseBoolean(formData.get("isActive")),
    dismissible: parseBoolean(formData.get("dismissible")),
    showIcon: parseBoolean(formData.get("showIcon")),
    textAlign: parseOptionalString(formData.get("textAlign")),
  };

  const parsed = bannerFormSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ||
        "Unable to save banner. Please verify all fields.",
    };
  }

  const startsAtIso = parseOptionalDateTime(parsed.data.startsAt);
  const endsAtIso = parseOptionalDateTime(parsed.data.endsAt);

  if (startsAtIso === "invalid" || endsAtIso === "invalid") {
    return { success: false, error: "Invalid banner schedule." };
  }

  const supabase = getAdminClient();

  if (parsed.data.isActive) {
    let disableOthers = supabase
      .from("system_banners")
      .update({ is_active: false, updated_by: userId })
      .eq("target_scope", parsed.data.targetScope)
      .eq("is_active", true);

    if (parsed.data.bannerId) {
      disableOthers = disableOthers.neq("id", parsed.data.bannerId);
    }

    const { error: disableError } = await disableOthers;
    if (disableError) {
      return { success: false, error: disableError.message };
    }
  }

  const payload = {
    title: parsed.data.title ?? null,
    message: parsed.data.message,
    banner_type: parsed.data.bannerType,
    target_scope: parsed.data.targetScope,
    is_active: parsed.data.isActive,
    starts_at: startsAtIso,
    ends_at: endsAtIso,
    cta_label: parsed.data.ctaLabel ?? null,
    cta_url: parsed.data.ctaUrl ?? null,
    dismissible: parsed.data.dismissible,
    show_icon: parsed.data.showIcon,
    text_align: parsed.data.textAlign,
    updated_by: userId,
  };

  if (parsed.data.bannerId) {
    const { error } = await supabase
      .from("system_banners")
      .update(payload)
      .eq("id", parsed.data.bannerId);

    if (error) {
      return { success: false, error: error.message };
    }
  } else {
    const { error } = await supabase
      .from("system_banners")
      .insert({
        ...payload,
        created_by: userId,
      });

    if (error) {
      return { success: false, error: error.message };
    }
  }

  revalidatePath("/");
  revalidatePath("/admin/system-banner");

  return {
    success: true,
    message: "System banner saved successfully.",
  };
}

export async function deactivateSystemBannerScope(
  _prevState: BannerActionState = EMPTY_ACTION_STATE,
  formData: FormData,
): Promise<BannerActionState> {
  const { isAdmin, userId } = await checkSuperAdmin();
  if (!isAdmin || !userId) {
    return { success: false, error: "Unauthorized" };
  }

  const scopeResult = bannerScopeSchema.safeParse(
    parseOptionalString(formData.get("targetScope")),
  );

  if (!scopeResult.success) {
    return { success: false, error: "Invalid banner scope." };
  }

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("system_banners")
    .update({
      is_active: false,
      updated_by: userId,
    })
    .eq("target_scope", scopeResult.data)
    .eq("is_active", true);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/admin/system-banner");

  return {
    success: true,
    message: `${scopeResult.data === "landing" ? "Landing" : "Sitewide"} banner deactivated.`,
  };
}
