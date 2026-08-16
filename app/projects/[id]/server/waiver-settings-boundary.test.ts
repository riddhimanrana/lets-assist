import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type TableCall = { table: string; ops: Op[] };
type RpcCall = { name: string; params: Record<string, unknown> };

const tableCalls: TableCall[] = [];
const rpcCalls: RpcCall[] = [];
let rpcOutcome = "updated";
let rpcError: unknown = null;

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR = { id: "55555555-5555-4555-8555-555555555555" };

const CHAINABLE = [
  "select",
  "insert",
  "update",
  "delete",
  "eq",
  "in",
  "or",
  "order",
  "limit",
  "gte",
];

function makeClient() {
  const from = (table: string) => {
    const ops: Op[] = [];
    const builder: Record<string, unknown> = {};

    for (const method of CHAINABLE) {
      builder[method] = (...args: unknown[]) => {
        ops.push({ method, args });
        return builder;
      };
    }

    const settle = () => {
      tableCalls.push({ table, ops });

      if (table === "projects" && ops.some((op) => op.method === "update")) {
        return { data: { id: PROJECT_ID }, error: null };
      }

      if (table === "projects" && ops.some((op) => op.method === "select")) {
        return {
          data: {
            creator_id: ACTOR.id,
            organization_id: null,
            can_be_managed_by_staff: false,
            recurrence_parent_id: null,
            recurrence_rule: null,
            visibility: "unlisted",
          },
          error: null,
        };
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => settle();
    builder.single = async () => settle();
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(settle()).then(onFulfilled, onRejected);

    return builder;
  };

  return {
    from,
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return rpcError
        ? { data: null, error: rpcError }
        : {
            data: [{ outcome: rpcOutcome, workflow_status: "published" }],
            error: null,
          };
    },
    auth: {
      getUser: async () => ({ data: { user: ACTOR }, error: null }),
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => makeClient(),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: ACTOR, error: null }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async () => {},
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => new Map(),
  getRegisteredPlugin: () => null,
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectClone: async () => {},
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("./access", () => ({
  canUserManageProject: async () => true,
  getProject: async () => ({ project: null, error: null }),
}));

const { updateProject } = await import("./lifecycle");

function projectWrites() {
  return tableCalls
    .filter((call) => call.table === "projects")
    .flatMap((call) => call.ops)
    .filter((op) => op.method === "update")
    .map((op) => op.args[0] as Record<string, unknown>);
}

beforeEach(() => {
  tableCalls.length = 0;
  rpcCalls.length = 0;
  rpcOutcome = "updated";
  rpcError = null;
});

describe("updateProject waiver boundary", () => {
  test("waiver switches go through the service-role RPC, never a direct write", async () => {
    const result = await updateProject(PROJECT_ID, {
      title: "Beach cleanup",
      waiver_required: true,
      waiver_allow_upload: false,
    } as never);

    expect(result).toMatchObject({ success: true });

    const waiverRpc = rpcCalls.find(
      (call) => call.name === "apply_project_waiver_settings",
    );
    expect(waiverRpc).toBeDefined();
    expect(waiverRpc?.params).toMatchObject({
      p_project_id: PROJECT_ID,
      p_actor_id: ACTOR.id,
      p_waiver_required: true,
      p_waiver_allow_upload: false,
      p_waiver_disable_esignature: null,
    });

    for (const payload of projectWrites()) {
      expect(payload).not.toHaveProperty("waiver_required");
      expect(payload).not.toHaveProperty("waiver_allow_upload");
      expect(payload).not.toHaveProperty("waiver_disable_esignature");
    }
  });

  test("a refused waiver change aborts the whole update", async () => {
    rpcOutcome = "missing_waiver_source";

    const result = await updateProject(PROJECT_ID, {
      title: "Beach cleanup",
      waiver_required: true,
    } as never);

    expect(result).toEqual({
      error:
        "Upload the waiver PDF before requiring a waiver on a published project.",
    });
    // Nothing else was written: the title edit did not slip through.
    expect(projectWrites()).toHaveLength(0);
  });

  test("an RPC transport failure fails closed", async () => {
    rpcError = { message: "connection reset" };

    const result = await updateProject(PROJECT_ID, {
      waiver_required: true,
    } as never);

    expect(result).toEqual({
      error: "This project's waiver settings could not be saved.",
    });
    expect(projectWrites()).toHaveLength(0);
  });

  test("publication status and waiver evidence are never client writable", async () => {
    await updateProject(PROJECT_ID, {
      title: "Beach cleanup",
      workflow_status: "published",
      waiver_pdf_storage_path: "project_waivers/someone-else/source.pdf",
      waiver_pdf_url: "https://local.test/forged.pdf",
      waiver_definition_id: "66666666-6666-4666-8666-666666666666",
      creator_id: "77777777-7777-4777-8777-777777777777",
    } as never);

    expect(rpcCalls).toHaveLength(0);

    const writes = projectWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ title: "Beach cleanup" });
  });

  test("an ordinary edit never calls the waiver RPC", async () => {
    await updateProject(PROJECT_ID, { title: "Beach cleanup" } as never);

    expect(
      rpcCalls.filter((call) => call.name === "apply_project_waiver_settings"),
    ).toHaveLength(0);
    expect(projectWrites()).toEqual([{ title: "Beach cleanup" }]);
  });
});
