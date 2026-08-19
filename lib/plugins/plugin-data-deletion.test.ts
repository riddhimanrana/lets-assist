import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const ORGANIZATION_ID = "a1000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "a1000000-0000-4000-8000-000000000002";
const ACTOR_ID = "a2000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "a3000000-0000-4000-8000-000000000001";
const REQUEST_ID = "a4000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "a5000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

const tables = new Map<string, Row[]>();
const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
const completeCalls: Record<string, unknown>[] = [];
const auditResultCalls: Record<string, unknown>[] = [];
const operationEvents: string[] = [];

let beginDecision = "execute";
let beginStatus = "processing";
let hookResult: { success: boolean; error?: string } = { success: true };
let hookCalls = 0;
let strictAuditError: Error | null = null;
let completeSucceeds = true;
let revokeActorAfterClaim = false;
let installPluginAfterClaim = false;
let forceEntitlementAfterClaim = false;

class Query {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() {
    const rows = (tables.get(this.table) ?? []).filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );
    return Promise.resolve({
      data: rows[0] ?? null,
      error: rows.length > 1 ? { message: "multiple rows" } : null,
    });
  }
}

const adminClient = {
  from(table: string) {
    return new Query(table);
  },
  async rpc(name: string, payload: Record<string, unknown>) {
    rpcCalls.push({ name, payload });
    switch (name) {
      case "acquire_plugin_control_plane_transition_lock":
      case "release_plugin_control_plane_transition_lock":
        return { data: true, error: null };
      case "begin_plugin_data_deletion_request":
        if (revokeActorAfterClaim) {
          const actorMembership = (
            tables.get("organization_members") ?? []
          ).find(
            (row) =>
              row.organization_id === ORGANIZATION_ID &&
              row.user_id === ACTOR_ID,
          );
          if (actorMembership) actorMembership.status = "inactive";
        }
        if (installPluginAfterClaim) {
          tables.set("organization_plugin_installs", [
            {
              id: "a7000000-0000-4000-8000-000000000099",
              organization_id: ORGANIZATION_ID,
              plugin_key: "test-plugin",
            },
          ]);
        }
        if (forceEntitlementAfterClaim) {
          tables.set("organization_plugin_entitlements", [
            {
              organization_id: ORGANIZATION_ID,
              plugin_key: "test-plugin",
              status: "active",
              starts_at: null,
              ends_at: null,
              is_forced: true,
            },
          ]);
        }
        return {
          data: [
            {
              request_id: REQUEST_ID,
              decision: beginDecision,
              status: beginStatus,
              claim_token: beginDecision === "execute" ? CLAIM_TOKEN : null,
              attempt_count: 1,
              safe_error_code: null,
              audit_status: "pending",
              error_message: null,
            },
          ],
          error: null,
        };
      case "complete_plugin_data_deletion_request":
        completeCalls.push(payload);
        operationEvents.push(`complete:${String(payload.p_status)}`);
        return {
          data: completeSucceeds,
          error: completeSucceeds
            ? null
            : { message: "completion unavailable" },
        };
      case "record_plugin_data_deletion_audit_result":
        auditResultCalls.push(payload);
        operationEvents.push(`audit-result:${String(payload.p_audit_status)}`);
        return { data: true, error: null };
      default:
        throw new Error(`Unexpected RPC: ${name}`);
    }
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

mock.module("@/lib/plugins/registry", () => ({
  getRegisteredPlugin: (pluginKey: string) =>
    pluginKey === "test-plugin"
      ? {
          manifest: {
            key: "test-plugin",
            name: "Test Plugin",
            version: "1.0.0",
            visibility: "global",
          },
          lifecycle: { onDataDelete: async () => undefined },
        }
      : undefined,
}));

mock.module("@/lib/plugins/plugin-data-deletion-readiness", () => ({
  getPluginDataDeletionReadiness: () => ({
    manifestReviewed: true,
    hookPresent: true,
    contractComplete: true,
    retrySafe: true,
    allTenantDataDeleted: true,
    ready: true,
    blockers: [],
  }),
}));

mock.module("@/lib/plugins/lifecycle", () => ({
  runPluginDataDelete: async () => {
    hookCalls += 1;
    operationEvents.push("hook");
    return hookResult;
  },
}));

mock.module("@/lib/plugins/audit", () => ({
  logPluginAudit: async () => null,
  logPluginAuditStrict: async () => {
    operationEvents.push("audit:write");
    if (strictAuditError) throw strictAuditError;
    return "a6000000-0000-4000-8000-000000000001";
  },
}));

const { runPermanentPluginDataDeletion } =
  await import("./plugin-data-deletion");

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    pluginKey: "test-plugin",
    actor: { id: ACTOR_ID, type: "user" as const },
    confirmationText: `Test Organization/${ORGANIZATION_ID}/test-plugin`,
    requestKey: REQUEST_KEY,
    ...overrides,
  };
}

beforeEach(() => {
  tables.clear();
  tables.set("organizations", [
    {
      id: ORGANIZATION_ID,
      name: "Test Organization",
      username: "test-organization",
      description: null,
      logo_url: null,
      type: "school",
      verified: true,
      allowed_email_domains: null,
      show_members_publicly: false,
    },
    {
      id: OTHER_ORGANIZATION_ID,
      name: "Other Organization",
      username: "other-organization",
      description: null,
      logo_url: null,
      type: "school",
      verified: true,
      allowed_email_domains: null,
      show_members_publicly: false,
    },
  ]);
  tables.set("organization_members", [
    {
      organization_id: ORGANIZATION_ID,
      user_id: ACTOR_ID,
      role: "admin",
      status: "active",
    },
  ]);
  tables.set("plugins", [
    {
      key: "test-plugin",
      name: "Test Plugin",
      visibility: "global",
      is_active: true,
    },
  ]);
  tables.set("organization_plugin_entitlements", []);
  tables.set("organization_plugin_installs", []);

  rpcCalls.length = 0;
  completeCalls.length = 0;
  auditResultCalls.length = 0;
  operationEvents.length = 0;
  beginDecision = "execute";
  beginStatus = "processing";
  hookResult = { success: true };
  hookCalls = 0;
  strictAuditError = null;
  completeSucceeds = true;
  revokeActorAfterClaim = false;
  installPluginAfterClaim = false;
  forceEntitlementAfterClaim = false;
});

describe("runPermanentPluginDataDeletion", () => {
  test("finalizes a successful deletion before audit and preserves success when audit logging fails", async () => {
    strictAuditError = new Error("audit unavailable");

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result.success).toBe(true);
    expect(result.auditWarning).toBe(true);
    expect(hookCalls).toBe(1);
    expect(completeCalls[0]).toMatchObject({
      p_request_id: REQUEST_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "succeeded",
    });
    expect(auditResultCalls.at(-1)).toMatchObject({
      p_request_id: REQUEST_ID,
      p_audit_status: "failed",
      p_audit_error_code: "audit_write_failed",
    });
    expect(operationEvents).toEqual([
      "hook",
      "complete:succeeded",
      "audit:write",
      "audit-result:failed",
    ]);
  });

  test("replays a terminal success without executing or auditing the hook again", async () => {
    beginDecision = "succeeded";
    beginStatus = "succeeded";

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: true,
      status: "succeeded",
      idempotent: true,
    });
    expect(operationEvents).toEqual([]);
  });

  test("never reruns plugin code for an already-processing request with an unknown outcome", async () => {
    beginDecision = "in_progress";
    beginStatus = "processing";

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "in_progress",
      idempotent: true,
    });
    expect(hookCalls).toBe(0);
    expect(completeCalls).toEqual([]);
  });

  test("records a reported hook failure as retryable without claiming nothing was deleted", async () => {
    hookResult = {
      success: false,
      error: "provider failed after deleting some objects",
    };

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "retryable_failed",
      canRetry: true,
    });
    expect(completeCalls[0]).toMatchObject({
      p_request_id: REQUEST_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "retryable_failed",
      p_safe_error_code: "hook_reported_failure",
    });
    expect(JSON.stringify(completeCalls)).not.toContain("provider failed");
  });

  test("requires reconciliation and never audits success when hook completion cannot be finalized", async () => {
    completeSucceeds = false;

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "manual_reconciliation",
      canRetry: false,
    });
    expect(result.error).toMatch(/do not retry/i);
    expect(operationEvents).toEqual(["hook", "complete:succeeded"]);
  });

  test("revalidates current organization-admin membership inside the destructive service", async () => {
    tables.set("organization_members", []);

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/organization admin/i);
    expect(hookCalls).toBe(0);
  });

  test("finalizes a claimed request safely when admin access is revoked before the hook", async () => {
    revokeActorAfterClaim = true;

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "retryable_failed",
      canRetry: true,
    });
    expect(hookCalls).toBe(0);
    expect(completeCalls).toEqual([
      expect.objectContaining({
        p_request_id: REQUEST_ID,
        p_claim_token: CLAIM_TOKEN,
        p_status: "retryable_failed",
        p_safe_error_code: "authorization_revoked",
      }),
    ]);
  });

  test("stops before the hook when an install appears after the durable claim", async () => {
    installPluginAfterClaim = true;

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "retryable_failed",
      canRetry: true,
    });
    expect(hookCalls).toBe(0);
    expect(completeCalls.at(-1)).toMatchObject({
      p_safe_error_code: "plugin_state_changed",
    });
  });

  test("stops before the hook when a forced entitlement appears after the durable claim", async () => {
    forceEntitlementAfterClaim = true;

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result).toMatchObject({
      success: false,
      status: "retryable_failed",
      canRetry: true,
    });
    expect(hookCalls).toBe(0);
    expect(completeCalls.at(-1)).toMatchObject({
      p_safe_error_code: "plugin_state_changed",
    });
  });

  test("requires ordinary uninstall to finish before permanent deletion", async () => {
    tables.set("organization_plugin_installs", [
      {
        id: "a7000000-0000-4000-8000-000000000001",
        organization_id: ORGANIZATION_ID,
        plugin_key: "test-plugin",
        enabled: false,
      },
    ]);

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/uninstall/i);
    expect(hookCalls).toBe(0);
  });

  test("never accepts an admin membership from another organization", async () => {
    tables.set("organization_members", [
      {
        organization_id: OTHER_ORGANIZATION_ID,
        user_id: ACTOR_ID,
        role: "admin",
        status: "active",
      },
    ]);

    const result = await runPermanentPluginDataDeletion(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/organization admin/i);
    expect(hookCalls).toBe(0);
  });

  test("fails closed for inactive, forced, and unentitled private plugins", async () => {
    tables.set("plugins", [
      {
        key: "test-plugin",
        name: "Test Plugin",
        visibility: "private",
        is_active: false,
      },
    ]);
    let result = await runPermanentPluginDataDeletion(validInput());
    expect(result.error).toMatch(/active in the catalog/i);
    expect(hookCalls).toBe(0);

    tables.set("plugins", [
      {
        key: "test-plugin",
        name: "Test Plugin",
        visibility: "private",
        is_active: true,
      },
    ]);
    tables.set("organization_plugin_entitlements", [
      {
        organization_id: ORGANIZATION_ID,
        plugin_key: "test-plugin",
        status: "active",
        starts_at: null,
        ends_at: null,
        is_forced: true,
      },
    ]);
    result = await runPermanentPluginDataDeletion(validInput());
    expect(result.error).toMatch(/managed by platform administrators/i);
    expect(hookCalls).toBe(0);

    tables.set("organization_plugin_entitlements", []);
    result = await runPermanentPluginDataDeletion(validInput());
    expect(result.error).toMatch(/active entitlement/i);
    expect(hookCalls).toBe(0);
  });
});
