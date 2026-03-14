import { describe, expect, it } from "vitest";

import {
  getAccountAccessErrorCode,
  isAccountBlockedStatus,
  readAccountAccessFromMetadata,
} from "./account-access";

describe("account-access", () => {
  it("returns active defaults when metadata is missing", () => {
    expect(readAccountAccessFromMetadata(null)).toEqual({
      status: "active",
      reason: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("parses nested account_access metadata", () => {
    expect(
      readAccountAccessFromMetadata({
        account_access: {
          status: "restricted",
          reason: "Repeated policy violations",
          updated_at: "2026-02-28T00:00:00.000Z",
          updated_by: "admin-1",
        },
      }),
    ).toEqual({
      status: "restricted",
      reason: "Repeated policy violations",
      updatedAt: "2026-02-28T00:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("supports legacy boolean metadata flags", () => {
    expect(
      readAccountAccessFromMetadata({
        is_banned: true,
        ban_reason: "Fraudulent activity",
      }),
    ).toEqual({
      status: "banned",
      reason: "Fraudulent activity",
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("maps blocked statuses to login error codes", () => {
    expect(isAccountBlockedStatus("active")).toBe(false);
    expect(isAccountBlockedStatus("restricted")).toBe(true);
    expect(isAccountBlockedStatus("banned")).toBe(true);

    expect(getAccountAccessErrorCode("active")).toBeNull();
    expect(getAccountAccessErrorCode("restricted")).toBe("account-restricted");
    expect(getAccountAccessErrorCode("banned")).toBe("account-banned");
  });
});
