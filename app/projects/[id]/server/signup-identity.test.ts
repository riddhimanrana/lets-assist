import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type TableCall = { table: string; ops: Op[] };
type RpcCall = { name: string; params: Record<string, unknown> };

type TableHandler = (ops: Op[]) => Record<string, unknown>;
type RpcHandler = (params: Record<string, unknown>) => Record<string, unknown>;

const tableCalls: TableCall[] = [];
const rpcCalls: RpcCall[] = [];
let tableHandlers: Record<string, TableHandler> = {};
let rpcHandlers: Record<string, RpcHandler> = {};
let sessionUser: {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
} | null = null;
let projectRecord: Record<string, unknown> = {};

const CHAINABLE = [
  "select",
  "insert",
  "update",
  "delete",
  "upsert",
  "eq",
  "in",
  "not",
  "ilike",
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
      return tableHandlers[table]?.(ops) ?? { data: null, error: null };
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
      return rpcHandlers[name]?.(params) ?? { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: sessionUser }, error: null }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        copy: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://local.test/x" } }),
      }),
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
  getAuthUser: async () => ({ user: sessionUser, error: null }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("next/headers", () => ({
  headers: async () => new Map<string, string>(),
}));
mock.module("@/services/email", () => ({ sendEmail: async () => ({}) }));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => new Map(),
  getRegisteredPlugin: () => null,
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runPluginOnSignup: async () => {},
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/lib/turnstile", () => ({
  isTurnstileEnabled: () => false,
  verifyTurnstileToken: async () => true,
}));
mock.module("@/app/projects/[id]/server/access", () => ({
  getProject: async () => ({ project: projectRecord, error: null }),
  getProjectWaiver: async () => ({ definition: null }),
  canCurrentUserManageProject: async () => false,
}));

const { signUpForProject } = await import("./signup");

const OPEN_SLOT = {
  oneTime: {
    date: "2099-06-01",
    startTime: "09:00",
    endTime: "12:00",
    volunteers: 5,
  },
};

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Signup Fixture",
    location: "Local",
    event_type: "oneTime",
    verification_method: "manual",
    status: "upcoming",
    workflow_status: "published",
    require_login: false,
    pause_signups: false,
    organization_id: null,
    schedule: OPEN_SLOT,
    enable_volunteer_comments: false,
    waiver_required: false,
    waiver_allow_upload: true,
    waiver_disable_esignature: false,
    restrict_to_org_domains: false,
    ...overrides,
  };
}

function insertedSignup() {
  return {
    data: [
      {
        signup_id: "22222222-2222-4222-8222-222222222222",
        anonymous_signup_id: null,
        waiver_signature_id: "33333333-3333-4333-8333-333333333333",
        outcome: "inserted",
        slot_capacity: 5,
        active_count: 0,
      },
    ],
    error: null,
  };
}

const SESSION = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "member@verified.test",
  user_metadata: { full_name: "Verified Member" },
};

const GUEST_PAYLOAD = {
  name: "Guest Volunteer",
  email: "guest@allowed.test",
};

const TYPED_WAIVER = {
  signatureType: "typed" as const,
  signatureText: "Verified Member",
  signerName: "Someone Else",
  signerEmail: "spoofed@allowed.test",
};

const signupInserts = () =>
  rpcCalls.filter((call) => call.name === "insert_project_signup_with_waiver");

const deleteCalls = () =>
  tableCalls.filter((call) =>
    call.ops.some((op) => op.method === "delete" || op.method === "update"),
  );

beforeEach(() => {
  tableCalls.length = 0;
  rpcCalls.length = 0;
  sessionUser = null;
  projectRecord = baseProject();
  tableHandlers = {
    projects: () => ({ data: projectRecord, error: null }),
    project_signups: () => ({ data: null, error: null, count: 0 }),
    profiles: () => ({ data: null, error: null }),
    user_emails: () => ({ data: [], error: null }),
    anonymous_signups: () => ({ data: null, error: null }),
    organization_members: () => ({ data: null, error: null }),
  };
  rpcHandlers = {
    check_email_exists: () => ({ data: false, error: null }),
    insert_project_signup_with_waiver: () => insertedSignup(),
  };
});

afterEach(() => {
  // No refusal or success path may ever compensate with a signup delete.
  expect(
    deleteCalls().filter((call) => call.table === "project_signups"),
  ).toEqual([]);
});

describe("signUpForProject actor derivation", () => {
  test("a signed-in caller submitting a guest payload is refused before any write", async () => {
    sessionUser = SESSION;

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      GUEST_PAYLOAD,
    );

    expect(result.error).toMatch(/signed in/iu);
    expect(rpcCalls).toEqual([]);
    expect(tableCalls).toEqual([]);
  });

  test("a signed-in caller cannot use a guest email to pass the domain gate", async () => {
    sessionUser = { ...SESSION, email: "member@blocked.test" };
    projectRecord = baseProject({
      restrict_to_org_domains: true,
      organization: { allowed_email_domains: ["allowed.test"] },
      organization_id: "44444444-4444-4444-8444-444444444444",
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      { ...GUEST_PAYLOAD, email: "insider@allowed.test" },
    );

    expect(result.error).toMatch(/signed in/iu);
    expect(signupInserts()).toEqual([]);
  });

  test("a signed-in caller off the allowed domain is refused without a write", async () => {
    sessionUser = { ...SESSION, email: "member@blocked.test" };
    projectRecord = baseProject({
      restrict_to_org_domains: true,
      organization: { allowed_email_domains: ["allowed.test"] },
      organization_id: "44444444-4444-4444-8444-444444444444",
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
    );

    expect(result.error).toMatch(/restricted to users/iu);
    expect(signupInserts()).toEqual([]);
  });

  test("a signed-in caller on a verified secondary domain is accepted", async () => {
    sessionUser = { ...SESSION, email: "member@blocked.test" };
    projectRecord = baseProject({
      restrict_to_org_domains: true,
      organization: { allowed_email_domains: ["allowed.test"] },
      organization_id: "44444444-4444-4444-8444-444444444444",
    });
    tableHandlers.user_emails = () => ({
      data: [{ email: "member@allowed.test" }],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
    );

    expect(result.success).toBe(true);
    expect(signupInserts()).toHaveLength(1);
  });
});

describe("signUpForProject waiver boundary", () => {
  test("a waiver project refuses a signed-in signup with no signature", async () => {
    sessionUser = SESSION;
    projectRecord = baseProject({ waiver_required: true });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
    );

    expect(result.error).toMatch(/requires a waiver signature/iu);
    expect(signupInserts()).toEqual([]);
  });

  test("the evidence travels inside the one capacity-checked transaction", async () => {
    sessionUser = SESSION;
    projectRecord = baseProject({ waiver_required: true });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      undefined,
      undefined,
      TYPED_WAIVER,
    );

    expect(result.success).toBe(true);

    const inserts = signupInserts();
    expect(inserts).toHaveLength(1);

    const params = inserts[0].params;
    expect(params.p_user_id).toBe(SESSION.id);
    expect(params.p_anonymous_id).toBeNull();
    expect(params.p_anonymous_profile).toBeNull();

    const waiver = params.p_waiver as Record<string, unknown>;
    expect(waiver.signature_type).toBe("typed");
    // The verified session address wins over the submitted signer address.
    expect(waiver.signer_email).toBe(SESSION.email);
    expect(waiver).not.toHaveProperty("project_id");
    expect(waiver).not.toHaveProperty("signup_id");
    expect(waiver).not.toHaveProperty("user_id");
  });

  test("a database refusal surfaces its mapped message and leaves nothing behind", async () => {
    sessionUser = SESSION;
    projectRecord = baseProject({ waiver_required: true });
    rpcHandlers.insert_project_signup_with_waiver = () => ({
      data: [
        {
          signup_id: null,
          anonymous_signup_id: null,
          waiver_signature_id: null,
          outcome: "waiver_required",
          slot_capacity: 5,
          active_count: 0,
        },
      ],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      undefined,
      undefined,
      TYPED_WAIVER,
    );

    expect(result.error).toBe(
      "This project requires a waiver signature before signing up.",
    );
    expect(result.success).toBeUndefined();
    expect(signupInserts()).toHaveLength(1);
  });

  test("a staged project refusal is reported without leaking provider text", async () => {
    sessionUser = SESSION;
    rpcHandlers.insert_project_signup_with_waiver = () => ({
      data: [
        {
          signup_id: null,
          anonymous_signup_id: null,
          waiver_signature_id: null,
          outcome: "project_unpublished",
          slot_capacity: 5,
          active_count: 0,
        },
      ],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
    );

    expect(result.error).toBe("This project is not open for signups yet.");
  });

  test("a thrown provider fault is reported generically", async () => {
    sessionUser = SESSION;
    rpcHandlers.insert_project_signup_with_waiver = () => {
      throw new Error("connection to 10.0.0.7 refused: password=hunter2");
    };

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
    );

    expect(result.error).toBe("An error occurred during signup");
    expect(JSON.stringify(result)).not.toMatch(/hunter2|10\.0\.0\.7/u);
  });
});

describe("signUpForProject guest flow", () => {
  test("a guest signup creates its identity inside the same transaction", async () => {
    sessionUser = null;
    projectRecord = baseProject({ verification_method: "signup-only" });
    rpcHandlers.insert_project_signup_with_waiver = () => ({
      data: [
        {
          signup_id: "22222222-2222-4222-8222-222222222222",
          anonymous_signup_id: "55555555-5555-4555-8555-555555555555",
          waiver_signature_id: null,
          outcome: "inserted",
          slot_capacity: 5,
          active_count: 0,
        },
      ],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      GUEST_PAYLOAD,
    );

    expect(result.success).toBe(true);

    const params = signupInserts()[0].params;
    expect(params.p_user_id).toBeNull();
    expect(params.p_anonymous_id).toBeNull();
    expect(params.p_anonymous_profile).toMatchObject({
      email: GUEST_PAYLOAD.email,
      name: GUEST_PAYLOAD.name,
      confirmed: true,
    });
    expect(
      tableCalls.filter(
        (call) =>
          call.table === "anonymous_signups" &&
          call.ops.some((op) => op.method === "insert"),
      ),
    ).toEqual([]);
  });

  test("a new guest on a waiver project without a signature never reaches the database", async () => {
    sessionUser = null;
    projectRecord = baseProject({ waiver_required: true });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      GUEST_PAYLOAD,
    );

    expect(result.error).toMatch(/requires a waiver signature/iu);
    expect(signupInserts()).toEqual([]);
  });

  test("a guest waiver signature is recorded under the gated guest address", async () => {
    sessionUser = null;
    projectRecord = baseProject({ waiver_required: true });
    rpcHandlers.insert_project_signup_with_waiver = () => ({
      data: [
        {
          signup_id: "22222222-2222-4222-8222-222222222222",
          anonymous_signup_id: "55555555-5555-4555-8555-555555555555",
          waiver_signature_id: "33333333-3333-4333-8333-333333333333",
          outcome: "inserted",
          slot_capacity: 5,
          active_count: 0,
        },
      ],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      GUEST_PAYLOAD,
      undefined,
      TYPED_WAIVER,
    );

    expect(result.success).toBe(true);

    const waiver = signupInserts()[0].params.p_waiver as Record<
      string,
      unknown
    >;
    expect(waiver.signer_email).toBe(GUEST_PAYLOAD.email);
  });

  test("a guest capacity refusal writes nothing at all", async () => {
    sessionUser = null;
    rpcHandlers.insert_project_signup_with_waiver = () => ({
      data: [
        {
          signup_id: null,
          anonymous_signup_id: null,
          waiver_signature_id: null,
          outcome: "slot_full",
          slot_capacity: 5,
          active_count: 5,
        },
      ],
      error: null,
    });

    const result = await signUpForProject(
      projectRecord.id as string,
      "oneTime",
      GUEST_PAYLOAD,
    );

    expect(result.error).toBe(
      "This slot just filled up. Please choose another time.",
    );
    expect(
      tableCalls.filter(
        (call) =>
          call.table === "anonymous_signups" &&
          call.ops.some((op) => op.method === "insert"),
      ),
    ).toEqual([]);
  });
});
