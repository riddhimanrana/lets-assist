import { getAdminClient } from "@/lib/supabase/admin";

export type AnonymousSignupAccessRecord = {
  id: string;
  project_id: string | null;
  token: string | null;
  email: string;
  name: string;
  phone_number: string | null;
  confirmed_at: string | null;
  created_at: string;
  linked_user_id: string | null;
};

export function normalizeAnonymousSignupToken(token?: string | null) {
  const normalized = token?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export async function getAnonymousSignupAccessRecord<T extends object = AnonymousSignupAccessRecord>(params: {
  anonymousSignupId: string;
  token?: string | null;
  columns?: string;
}) {
  const normalizedToken = normalizeAnonymousSignupToken(params.token);

  if (!normalizedToken) {
    return {
      data: null as T | null,
      error: "Missing or invalid anonymous access token",
    };
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("anonymous_signups")
    .select(
      params.columns ??
        "id, project_id, token, email, name, phone_number, confirmed_at, created_at, linked_user_id",
    )
    .eq("id", params.anonymousSignupId)
    .eq("token", normalizedToken)
    .maybeSingle<T>();

  if (error) {
    console.error("Error validating anonymous signup token access:", error);
    return { data: null as T | null, error: "Failed to validate anonymous access" };
  }

  if (!data) {
    return { data: null as T | null, error: "Anonymous signup access denied" };
  }

  return { data, error: null as string | null };
}
