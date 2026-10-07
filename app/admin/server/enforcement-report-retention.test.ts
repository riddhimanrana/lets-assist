import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  DeleteUserCleanupReport,
  DeleteUserWithCleanupOptions,
} from "@/lib/supabase/delete-user-with-cleanup";
import type { SendEmailResult } from "@/services/email";

// Report retention is proved in account_deletion_protocol.test.sql. This action
// must delegate cleanup to that protocol and send its notice only on completion.
mock.module("server-only", () => ({}));
const { accountDeletionFailureMessage } =
  await import("@/lib/supabase/delete-user-with-cleanup");
const formatCleanupFailure = accountDeletionFailureMessage;
const ADMIN_ID = "40000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const OPERATION_ID = "30000000-0000-4000-8000-000000000003";
const recipient = "removed-user@local.test";
const privateFailure = "synthetic-private-provider-detail";

let authorization: { isAdmin: boolean; userId: string | null };
let cleanupReport: DeleteUserCleanupReport;
let cleanupError: Error | null;
let recipientEmail: string | null;
let lookupError: Error | null;
let emailResult: SendEmailResult;
let emailError: Error | null;
let serviceCalls = 0;
const cleanupCalls: Array<{
  client: unknown;
  userId: string;
  options: DeleteUserWithCleanupOptions;
}> = [];
const failureReports: DeleteUserCleanupReport[] = [];
const lookupCalls: string[] = [];
const emails: Array<{
  to: string;
  userId: string;
  type: string;
  idempotencyKey: string;
}> = [];
const emailViews: Record<string, unknown>[] = [];
const order: string[] = [];
const manualWrites: string[] = [];

function forbidManualWrite(operation: string): never {
  manualWrites.push(operation);
  throw new Error("Account writes must use the cleanup protocol");
}
const service = {
  from: (relation: string) => forbidManualWrite(relation),
  auth: {
    admin: {
      getUserById: async (userId: string) => {
        lookupCalls.push(userId);
        order.push("lookup");
        if (lookupError) throw lookupError;
        return {
          data: { user: { id: userId, email: recipientEmail } },
          error: null,
        };
      },
      updateUserById: () => forbidManualWrite("auth.updateUserById"),
      deleteUser: () => forbidManualWrite("auth.deleteUser"),
    },
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    serviceCalls++;
    return service;
  },
}));
mock.module("@/lib/supabase/delete-user-with-cleanup", () => ({
  deleteUserWithCleanup: async (
    client: unknown,
    userId: string,
    options: DeleteUserWithCleanupOptions,
  ) => {
    cleanupCalls.push({ client, userId, options });
    order.push("cleanup");
    if (cleanupError) throw cleanupError;
    return cleanupReport;
  },
  accountDeletionFailureMessage: (report: DeleteUserCleanupReport) => {
    failureReports.push(report);
    return formatCleanupFailure(report);
  },
}));
mock.module("./auth", () => ({ checkSuperAdmin: async () => authorization }));
mock.module("@/services/email", () => ({
  sendEmail: async (payload: (typeof emails)[number]) => {
    emails.push(payload);
    order.push("email");
    if (emailError) throw emailError;
    return emailResult;
  },
}));
mock.module("@/emails/account-access-update", () => ({
  default: (props: Record<string, unknown>) => {
    emailViews.push(props);
    return null;
  },
}));
mock.module("./shared", () => ({
  createServerNotification: async () => {},
  readBannedUntil: () => null,
}));
const { deleteAndBlacklistUser } = await import("./enforcement");

beforeEach(() => {
  authorization = { isAdmin: true, userId: ADMIN_ID };
  cleanupReport = {
    userId: USER_ID,
    operationId: OPERATION_ID,
    phase: "completed",
    blockedBySoleAdminOrgs: [],
    blockers: {},
    deletedCounts: { profiles: 1 },
    skipped: [],
    notes: [],
    completedNow: true,
  };
  cleanupError = null;
  recipientEmail = recipient;
  lookupError = null;
  emailError = null;
  emailResult = {
    outcome: "accepted",
    success: true,
    skipped: false,
    phase: "provider_response",
    messageId: "fixture-message",
    transport: "mailpit",
    data: { id: "fixture-message" },
  };
  serviceCalls = 0;
  for (const calls of [
    cleanupCalls,
    failureReports,
    lookupCalls,
    emails,
    emailViews,
    order,
    manualWrites,
  ])
    calls.length = 0;
});
afterEach(() => {
  expect(manualWrites).toEqual([]);
});

describe("admin removal delegates to the recoverable account protocol", () => {
  test("binds the actor, target and deletion mode without a parallel destructive path", async () => {
    const reason = "  Repeated synthetic abuse  ";
    expect(
      await deleteAndBlacklistUser({
        userId: USER_ID,
        reason,
        sendEmail: false,
      }),
    ).toEqual({
      success: true,
      emailDelivery: "not_attempted",
    });
    expect(cleanupCalls).toEqual([
      {
        client: service,
        userId: USER_ID,
        options: {
          actorId: ADMIN_ID,
          mode: "admin_blacklist",
          reason,
          deleteProjects: true,
        },
      },
    ]);
    expect(serviceCalls).toBe(1);
    expect(order).toEqual(["cleanup"]);
    expect(emails).toEqual([]);
    expect(failureReports).toEqual([]);
  });

  test.each(["blocked", "external_pending"] as const)(
    "%s returns the protocol's safe refusal without email",
    async (phase) => {
      cleanupReport = { ...cleanupReport, phase, completedNow: false };
      const result = await deleteAndBlacklistUser({ userId: USER_ID });
      expect(result).toEqual({ error: formatCleanupFailure(cleanupReport) });
      expect(failureReports).toEqual([cleanupReport]);
      expect(cleanupCalls).toHaveLength(1);
      expect(lookupCalls).toEqual([]);
      expect(emails).toEqual([]);
    },
  );

  test("a thrown cleanup result remains unconfirmed and sends no notice", async () => {
    cleanupError = new Error(privateFailure);
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      error:
        "Account cleanup could not be confirmed. Retry the saved operation.",
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(order).toEqual(["cleanup"]);
    expect(emails).toEqual([]);
  });

  test("newly confirmed completion sends one notice with the durable operation key", async () => {
    expect(
      await deleteAndBlacklistUser({
        userId: USER_ID,
        reason: "  Synthetic reason  ",
      }),
    ).toEqual({
      success: true,
      emailDelivery: "accepted",
    });
    expect(order).toEqual(["cleanup", "lookup", "email"]);
    expect(lookupCalls).toEqual([USER_ID]);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: recipient,
      userId: USER_ID,
      type: "transactional",
      idempotencyKey: `account-removal/${OPERATION_ID}`,
    });
    expect(emailViews[0]).toMatchObject({
      status: "banned",
      reason: "Synthetic reason",
    });
  });

  test("replaying a completed operation never looks up the recipient or sends again", async () => {
    cleanupReport.completedNow = false;
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      success: true,
      emailDelivery: "not_attempted",
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(order).toEqual(["cleanup"]);
    expect(emails).toEqual([]);
  });

  test("a missing recipient preserves completed removal and reports no email attempt", async () => {
    recipientEmail = null;
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      success: true,
      emailDelivery: "not_attempted",
      warning:
        "Account removal completed. No email address was available for its notice.",
    });
    expect(lookupCalls).toEqual([USER_ID]);
    expect(emails).toEqual([]);
  });

  test("recipient lookup failure cannot turn confirmed removal into a retryable deletion", async () => {
    lookupError = new Error(privateFailure);
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      success: true,
      emailDelivery: "not_attempted",
      warning: "Account removal completed. Its email could not be prepared.",
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(emails).toEqual([]);
  });

  test("email rejection is separate from completed account removal", async () => {
    emailResult = {
      outcome: "definitive_failure",
      success: false,
      skipped: false,
      phase: "provider_response",
      code: "rejected",
      status: 400,
      error: privateFailure,
    };
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      success: true,
      emailDelivery: "not_accepted",
      warning: "Account change saved. The email was not accepted.",
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  test("an unexpected email exception reports uncertainty without retrying either operation", async () => {
    emailError = new Error(privateFailure);
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      success: true,
      emailDelivery: "unknown",
      warning:
        "Account change saved. Email acceptance is unknown. Check the provider record before resending.",
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });
});

describe("admin removal authorization", () => {
  test.each([
    { isAdmin: false, userId: ADMIN_ID },
    { isAdmin: true, userId: null },
  ])("refuses a caller without an authenticated superadmin", async (actor) => {
    authorization = actor;
    expect(await deleteAndBlacklistUser({ userId: USER_ID })).toEqual({
      error: "Unauthorized",
    });
    expect(serviceCalls).toBe(0);
    expect(cleanupCalls).toEqual([]);
    expect(emails).toEqual([]);
  });

  test.each([
    ["", "User ID is required"],
    [ADMIN_ID, "You cannot delete your own account via this panel."],
  ])(
    "rejects an invalid or self target before obtaining a privileged client",
    async (userId, error) => {
      expect(await deleteAndBlacklistUser({ userId })).toEqual({ error });
      expect(serviceCalls).toBe(0);
      expect(cleanupCalls).toEqual([]);
      expect(emails).toEqual([]);
    },
  );
});
