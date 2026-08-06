export type MetadataRecord = Record<string, unknown> | null | undefined;

export type SuperAdminUserLike = {
  email?: string | null;
  app_metadata?: MetadataRecord;
  user_metadata?: MetadataRecord;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getBooleanFlag(metadata: MetadataRecord, key: string): boolean {
  if (!isRecord(metadata)) {
    return false;
  }
  return metadata[key] === true;
}

export function getRole(metadata: MetadataRecord): string | null {
  if (!isRecord(metadata)) {
    return null;
  }
  const role = metadata.role;
  if (typeof role !== "string") {
    return null;
  }
  const normalizedRole = role.trim().toLowerCase();
  return normalizedRole.length > 0 ? normalizedRole : null;
}

export function hasSuperAdminMetadata(
  user: SuperAdminUserLike | null | undefined,
): boolean {
  if (!user) {
    return false;
  }

  // Authorization claims must only come from app_metadata. Supabase users can
  // edit their own user_metadata, so accepting role flags from it would let any
  // authenticated user promote themselves into service-role admin actions.
  return (
    getBooleanFlag(user.app_metadata, "is_super_admin") ||
    getRole(user.app_metadata) === "super_admin"
  );
}

export function isSuperAdminUser(
  user: SuperAdminUserLike | null | undefined,
): boolean {
  return hasSuperAdminMetadata(user);
}

export function buildSuperAdminMetadataPatch(
  user: SuperAdminUserLike | null | undefined,
): {
  app_metadata: Record<string, unknown>;
} {
  const appMetadata = isRecord(user?.app_metadata)
    ? { ...user.app_metadata }
    : {};

  return {
    app_metadata: {
      ...appMetadata,
      role: getRole(appMetadata) ?? "super_admin",
      is_super_admin: true,
    },
  };
}
