import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type Settings = {
  email_notifications: boolean;
  project_updates: boolean;
  general: boolean;
};
let settings: Settings | null;
let queryError: { code: string } | null;
let unavailable = false;
const maybeSingle = mock(async () => ({ data: settings, error: queryError }));
const eq = mock(() => ({ maybeSingle }));
const select = mock(() => ({ eq }));
const from = mock(() => ({ select }));
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    if (unavailable) throw new Error("synthetic setup failure");
    return { from };
  },
}));
const { getRecipientEmailPolicy } = await import("./email-preferences");

beforeEach(() => {
  settings = {
    email_notifications: true,
    project_updates: true,
    general: true,
  };
  queryError = null;
  unavailable = false;
  from.mockClear();
  select.mockClear();
  eq.mockClear();
});
afterAll(() => mock.restore());

describe("recipient consent without a sender session", () => {
  test("reads only the intended recipient's consent fields", async () => {
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toEqual({ allowed: true });
    expect(from).toHaveBeenCalledWith("notification_settings");
    expect(select).toHaveBeenCalledWith(
      "email_notifications, project_updates, general",
    );
    expect(eq).toHaveBeenCalledWith("user_id", "synthetic-recipient");
  });
  test("distinguishes absent settings from a failed read", async () => {
    settings = null;
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toEqual({ allowed: true });
    queryError = { code: "42501" };
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toMatchObject({ allowed: false, retryable: true });
  });
  test("fails closed on client setup failure", async () => {
    unavailable = true;
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toEqual({
      allowed: false,
      retryable: true,
      code: "preferences_unavailable",
    });
  });
  test("honors global and topic choices independently", async () => {
    settings!.email_notifications = false;
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toMatchObject({
      allowed: false,
      retryable: false,
      code: "global_email_disabled",
    });
    settings!.email_notifications = true;
    settings!.general = false;
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "general"),
    ).toMatchObject({
      allowed: false,
      retryable: false,
      code: "general_notifications_disabled",
    });
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "project_updates"),
    ).toEqual({ allowed: true });
    settings!.project_updates = false;
    expect(
      await getRecipientEmailPolicy("synthetic-recipient", "project_updates"),
    ).toMatchObject({
      allowed: false,
      retryable: false,
      code: "project_updates_disabled",
    });
  });
});
