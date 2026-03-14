export type AccountAccessStatus = "active" | "restricted" | "banned";

export type AccountAccessErrorCode = "account-restricted" | "account-banned";

export type AccountAccessState = {
  status: AccountAccessStatus;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type MetadataObject = Record<string, unknown>;

const DEFAULT_ACCESS_STATE: AccountAccessState = {
  status: "active",
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

function asObject(value: unknown): MetadataObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as MetadataObject;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStatus(value: unknown): AccountAccessStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "restricted") return "restricted";
  if (normalized === "banned") return "banned";

  return null;
}

/**
 * Reads account access controls from auth metadata.
 *
 * Supported metadata shapes:
 * - app_metadata.account_access = { status, reason, updated_at, updated_by }
 * - legacy booleans: is_banned / is_restricted
 * - legacy status string: account_status
 */
export function readAccountAccessFromMetadata(metadata: unknown): AccountAccessState {
  const metadataObject = asObject(metadata);
  if (!metadataObject) {
    return DEFAULT_ACCESS_STATE;
  }

  const nestedAccess = asObject(metadataObject.account_access);
  if (nestedAccess) {
    const nestedStatus = parseStatus(nestedAccess.status);
    if (nestedStatus) {
      return {
        status: nestedStatus,
        reason: asString(nestedAccess.reason),
        updatedAt: asString(nestedAccess.updated_at),
        updatedBy: asString(nestedAccess.updated_by),
      };
    }
  }

  if (metadataObject.is_banned === true) {
    return {
      status: "banned",
      reason: asString(metadataObject.ban_reason),
      updatedAt: null,
      updatedBy: null,
    };
  }

  if (metadataObject.is_restricted === true) {
    return {
      status: "restricted",
      reason: asString(metadataObject.restriction_reason),
      updatedAt: null,
      updatedBy: null,
    };
  }

  const topLevelStatus = parseStatus(metadataObject.account_status);
  if (topLevelStatus) {
    return {
      status: topLevelStatus,
      reason: asString(metadataObject.account_status_reason),
      updatedAt: null,
      updatedBy: null,
    };
  }

  return DEFAULT_ACCESS_STATE;
}

export function isAccountBlockedStatus(status: AccountAccessStatus): boolean {
  return status === "restricted" || status === "banned";
}

export function getAccountAccessErrorCode(status: AccountAccessStatus): AccountAccessErrorCode | null {
  if (status === "restricted") return "account-restricted";
  if (status === "banned") return "account-banned";
  return null;
}
