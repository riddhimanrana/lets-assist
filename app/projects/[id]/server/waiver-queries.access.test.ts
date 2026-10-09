import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

const SIGNUP_ID = "22222222-2222-4222-8222-222222222222";
const SIGNATURE_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const CREATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SIGNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GUEST_RECORD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UPLOAD_PATH = "signed-waivers/project/key/file.jpg";

let sessionUser: { id: string } | null = null;
let signupRow: Record<string, unknown> | null = null;
let membership: Result = { data: null, error: null };
let guestTokenValid = false;
const tableCalls: Array<{ table: string; ops: Op[] }> = [];
const signedUrlCalls: Array<{ path: string; expiresIn: number }> = [];

function makeClient() {
  const from = (table: string) => {
    const ops: Op[] = [];
    const settle = (): Result => {
      tableCalls.push({ table, ops });
      if (table === "project_signups") return { data: signupRow, error: null };
      if (table === "organization_members") return membership;
      if (table === "waiver_signatures") {
        return {
          data: {
            id: SIGNATURE_ID,
            signature_type: "upload",
            signature_storage_path: null,
            upload_storage_path: UPLOAD_PATH,
            signature_payload: null,
            signature_text: null,
            signed_at: "2026-03-01T20:15:00.000Z",
            signer_name: "Signer",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      single: async () => settle(),
      maybeSingle: async () => settle(),
    };
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        ops.push({ method, args });
        return builder;
      };
    }
    return builder;
  };

  return {
    from,
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          signedUrlCalls.push({ path, expiresIn });
          return {
            data: { signedUrl: "https://storage.test/signed" },
            error: null,
          };
        },
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
mock.module("@/lib/anonymous-signup-access", () => ({
  getAnonymousSignupAccessRecord: async (params: {
    anonymousSignupId: string;
    token?: string | null;
  }) =>
    guestTokenValid && params.token === "valid-token"
      ? { data: { id: params.anonymousSignupId }, error: null }
      : { data: null, error: "invalid" },
}));
mock.module("@/app/projects/[id]/server/shared", () => ({
  WAIVER_SIGNATURE_BUCKET: "waiver-signatures",
}));

const { getWaiverDownloadUrl } = await import("./waiver-queries");

const member = (role: string, status: string | null): Result => ({
  data: { role, status },
  error: null,
});

const project = (canBeManagedByStaff: boolean) => ({
  creator_id: CREATOR,
  organization_id: ORG_ID,
  can_be_managed_by_staff: canBeManagedByStaff,
});

beforeEach(() => {
  tableCalls.length = 0;
  signedUrlCalls.length = 0;
  sessionUser = null;
  guestTokenValid = false;
  membership = { data: null, error: null };
  signupRow = {
    id: SIGNUP_ID,
    user_id: SIGNER,
    anonymous_id: null,
    project: project(false),
  };
});

describe("getWaiverDownloadUrl access", () => {
  test.each([
    ["an inactive admin", member("admin", "inactive"), true],
    ["an invited admin", member("admin", "invited"), true],
    ["an invited staff member", member("staff", "invited"), true],
    ["an admin row with no status", member("admin", null), true],
    [
      "active staff when staff management is off",
      member("staff", "active"),
      false,
    ],
    ["an active plain member", member("member", "active"), true],
    ["an unrelated signed-in user", { data: null, error: null }, true],
  ])("refuses %s", async (_label, row, staffManaged) => {
    sessionUser = { id: MEMBER };
    membership = row;
    signupRow = { ...signupRow, project: project(staffManaged) };

    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toEqual({
      error: "Unauthorized",
    });
    // A refused caller never gets a signed URL minted, and the waiver row is
    // never read on their behalf.
    expect(signedUrlCalls).toEqual([]);
    expect(tableCalls.some((call) => call.table === "waiver_signatures")).toBe(
      false,
    );
  });

  test("allows an active admin", async () => {
    sessionUser = { id: MEMBER };
    membership = member("admin", "active");

    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toMatchObject({
      signatureId: SIGNATURE_ID,
    });
  });

  test("allows active staff when the project allows staff management", async () => {
    sessionUser = { id: MEMBER };
    membership = member("staff", "active");
    signupRow = { ...signupRow, project: project(true) };

    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toMatchObject({
      signatureId: SIGNATURE_ID,
    });
  });

  test("allows the creator and the signer", async () => {
    sessionUser = { id: CREATOR };
    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toMatchObject({
      signatureId: SIGNATURE_ID,
    });

    sessionUser = { id: SIGNER };
    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toMatchObject({
      signatureId: SIGNATURE_ID,
    });
  });

  test("refuses a request with no session and no guest link before any lookup", async () => {
    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toEqual({
      error: "Unauthorized",
    });
    expect(tableCalls).toEqual([]);
  });

  test("a failed membership lookup refuses the request", async () => {
    sessionUser = { id: MEMBER };
    membership = { data: null, error: { message: "timeout" } };

    expect(await getWaiverDownloadUrl(SIGNUP_ID)).toEqual({
      error: "Unauthorized",
    });
    expect(signedUrlCalls).toEqual([]);
  });

  test("reads the membership status for this user in this organization", async () => {
    sessionUser = { id: MEMBER };
    membership = member("admin", "active");
    await getWaiverDownloadUrl(SIGNUP_ID);

    expect(
      tableCalls.find((call) => call.table === "organization_members")?.ops,
    ).toEqual([
      { method: "select", args: ["role, status"] },
      { method: "eq", args: ["organization_id", ORG_ID] },
      { method: "eq", args: ["user_id", MEMBER] },
    ]);
  });

  test("the signed URL lives for two minutes, not an hour", async () => {
    sessionUser = { id: SIGNER };
    await getWaiverDownloadUrl(SIGNUP_ID);

    expect(signedUrlCalls).toEqual([{ path: UPLOAD_PATH, expiresIn: 120 }]);
  });
});

describe("getWaiverDownloadUrl guest link", () => {
  beforeEach(() => {
    signupRow = { ...signupRow, user_id: null, anonymous_id: GUEST_RECORD };
  });

  test("a guest with a valid token can open their waiver", async () => {
    guestTokenValid = true;

    expect(
      await getWaiverDownloadUrl(SIGNUP_ID, GUEST_RECORD, "valid-token"),
    ).toMatchObject({ signatureId: SIGNATURE_ID });
  });

  test("a signed-in visitor can open their own guest link", async () => {
    guestTokenValid = true;
    sessionUser = { id: MEMBER };

    expect(
      await getWaiverDownloadUrl(SIGNUP_ID, GUEST_RECORD, "valid-token"),
    ).toMatchObject({ signatureId: SIGNATURE_ID });
  });

  test("a wrong token is refused, signed in or not", async () => {
    guestTokenValid = true;

    expect(
      await getWaiverDownloadUrl(SIGNUP_ID, GUEST_RECORD, "wrong"),
    ).toEqual({ error: "Unauthorized" });

    sessionUser = { id: MEMBER };
    expect(
      await getWaiverDownloadUrl(SIGNUP_ID, GUEST_RECORD, "wrong"),
    ).toEqual({ error: "Unauthorized" });
  });

  test("a valid token for another guest record opens nothing", async () => {
    guestTokenValid = true;

    expect(
      await getWaiverDownloadUrl(
        SIGNUP_ID,
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "valid-token",
      ),
    ).toEqual({ error: "Unauthorized" });
  });

  test("a guest token never opens a signed-in user's waiver", async () => {
    guestTokenValid = true;
    signupRow = { ...signupRow, user_id: SIGNER, anonymous_id: null };

    expect(
      await getWaiverDownloadUrl(SIGNUP_ID, GUEST_RECORD, "valid-token"),
    ).toEqual({ error: "Unauthorized" });
  });
});
