import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .single();

  return data?.role === "admin";
}

function normalizeImportedProfileData(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, rawValue]) => {
      if (typeof rawValue !== "string") {
        return acc;
      }

      const trimmed = rawValue.trim();
      if (!trimmed) {
        return acc;
      }

      acc[key] = trimmed;
      return acc;
    },
    {},
  );
}

export async function applyImportedProfileData(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  invitation: {
    email: string;
    import_job_id?: string | null;
    invited_full_name?: string | null;
    invited_phone?: string | null;
    invited_profile_data?: Record<string, unknown> | null;
  };
}) {
  const { supabase, userId, invitation } = params;

  const invitedEmail = invitation.email.trim().toLowerCase();
  const importJobId = invitation.import_job_id || null;

  let importedProfileData = normalizeImportedProfileData(
    invitation.invited_profile_data,
  );
  let importedFullName = (
    invitation.invited_full_name ||
    importedProfileData.full_name ||
    ""
  ).trim();
  let importedPhone = (
    invitation.invited_phone ||
    importedProfileData.phone ||
    ""
  ).trim();

  if (importJobId) {
    const { data: importRow } = await supabase
      .from("organization_contact_import_rows")
      .select("full_name, profile_data")
      .eq("job_id", importJobId)
      .eq("email", invitedEmail)
      .maybeSingle();

    const importRowProfileData = normalizeImportedProfileData(
      importRow?.profile_data,
    );

    importedProfileData = {
      ...importRowProfileData,
      ...importedProfileData,
    };

    importedFullName = (
      invitation.invited_full_name ||
      importRow?.full_name ||
      importRowProfileData.full_name ||
      importedProfileData.full_name ||
      ""
    ).trim();

    importedPhone = (
      invitation.invited_phone ||
      importRowProfileData.phone ||
      importedProfileData.phone ||
      ""
    ).trim();
  }

  if (
    !importedFullName &&
    !importedPhone &&
    Object.keys(importedProfileData).length === 0
  ) {
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, profile_metadata")
    .eq("id", userId)
    .single();

  if (!profile) {
    return;
  }

  const updates: Record<string, unknown> = {};
  const currentName = (profile.full_name || "").trim();
  const currentPhone = (profile.phone || "").trim();
  const currentMetadata =
    profile.profile_metadata &&
    typeof profile.profile_metadata === "object" &&
    !Array.isArray(profile.profile_metadata)
      ? (profile.profile_metadata as Record<string, unknown>)
      : {};

  if (
    importedFullName &&
    (!currentName ||
      currentName === "Unknown User" ||
      currentName.startsWith("user_"))
  ) {
    updates.full_name = importedFullName;
  }

  if (importedPhone && !currentPhone) {
    updates.phone = importedPhone;
  }

  updates.profile_metadata = {
    ...currentMetadata,
    ...importedProfileData,
  };

  if (Object.keys(updates).length === 0) {
    return;
  }

  await supabase.from("profiles").update(updates).eq("id", userId);
}
