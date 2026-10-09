import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PDFDocument } from "pdf-lib";

type Op = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

const SIGNATURE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const CREATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SIGNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GUEST_RECORD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let sessionUser: { id: string } | null = null;
let signatureRow: Record<string, unknown> | null = null;
let projectRow: Record<string, unknown> | null = null;
let membership: Result = { data: null, error: null };
let guestTokenValid = false;
let storedObject: Blob | null = null;
const tableCalls: Array<{ table: string; ops: Op[] }> = [];
const downloads: Array<{ bucket: string; path: string }> = [];

function makeClient() {
  const from = (table: string) => {
    const ops: Op[] = [];
    const settle = (): Result => {
      tableCalls.push({ table, ops });
      if (table === "waiver_signatures")
        return { data: signatureRow, error: null };
      if (table === "projects") return { data: projectRow, error: null };
      if (table === "organization_members") return membership;
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
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push({ bucket, path });
          return storedObject
            ? { data: storedObject, error: null }
            : { data: null, error: { message: "missing" } };
        },
      }),
    },
  };
}

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
mock.module("@/lib/waiver/source-pdf-loader", () => ({
  loadWaiverSourcePdf: async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    return document.save();
  },
}));

const { serveSignedWaiver, singleSignerDefinition } =
  await import("./serve-signed-waiver");

const request = (query = "", headers: Record<string, string> = {}) =>
  new Request(`https://app.test/api/waivers/${SIGNATURE_ID}/download${query}`, {
    headers,
  });

const serve = (
  options: { inline?: boolean; query?: string; accept?: string } = {},
) =>
  serveSignedWaiver(
    request(
      options.query,
      options.accept ? { accept: options.accept } : undefined,
    ),
    SIGNATURE_ID,
    { inline: options.inline ?? false },
  );

const member = (role: string, status: string | null): Result => ({
  data: { role, status },
  error: null,
});

beforeEach(() => {
  tableCalls.length = 0;
  downloads.length = 0;
  sessionUser = null;
  guestTokenValid = false;
  membership = { data: null, error: null };
  storedObject = new Blob(["%PDF-1.4"], { type: "application/pdf" });
  signatureRow = {
    id: SIGNATURE_ID,
    user_id: SIGNER,
    anonymous_id: null,
    waiver_pdf_url: null,
    waiver_pdf_storage_path: `project_waivers/${PROJECT_ID}/source.pdf`,
    signature_payload: null,
    signature_storage_path: null,
    signed_at: "2026-03-01T20:15:00.000Z",
    upload_storage_path: `signed-waivers/${PROJECT_ID}/key/file.pdf`,
    signature_text: null,
    waiver_definition_id: null,
    project_id: PROJECT_ID,
    signup_id: "22222222-2222-4222-8222-222222222222",
    waiver_definition: null,
  };
  projectRow = {
    creator_id: CREATOR,
    organization_id: ORG_ID,
    can_be_managed_by_staff: false,
    waiver_pdf_storage_path: `project_waivers/${PROJECT_ID}/source.pdf`,
    waiver_pdf_url: null,
    project_timezone: "America/Los_Angeles",
  };
});

describe("serveSignedWaiver access", () => {
  test.each([
    ["an inactive admin", member("admin", "inactive"), true],
    ["an invited admin", member("admin", "invited"), true],
    ["an invited staff member", member("staff", "invited"), true],
    ["an inactive staff member", member("staff", "inactive"), true],
    ["an admin row with no status", member("admin", null), true],
    [
      "active staff when staff management is off",
      member("staff", "active"),
      false,
    ],
    ["an active plain member", member("member", "active"), true],
    ["a user with no membership", { data: null, error: null }, true],
  ])("refuses %s", async (_label, row, staffManaged) => {
    sessionUser = { id: MEMBER };
    membership = row;
    projectRow = { ...projectRow, can_be_managed_by_staff: staffManaged };

    const response = await serve();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "You do not have access to this signed waiver.",
    });
    // A refused caller never causes the signed file to be read.
    expect(downloads).toEqual([]);
  });

  test("allows an active admin", async () => {
    sessionUser = { id: MEMBER };
    membership = member("admin", "active");

    expect((await serve()).status).toBe(200);
  });

  test("allows active staff when the project allows staff management", async () => {
    sessionUser = { id: MEMBER };
    membership = member("staff", "active");
    projectRow = { ...projectRow, can_be_managed_by_staff: true };

    expect((await serve()).status).toBe(200);
  });

  test("allows the project creator and the signer", async () => {
    sessionUser = { id: CREATOR };
    expect((await serve()).status).toBe(200);

    sessionUser = { id: SIGNER };
    expect((await serve()).status).toBe(200);
  });

  test("refuses a request with no session", async () => {
    expect((await serve()).status).toBe(403);
    expect(downloads).toEqual([]);
  });

  test("reads the membership status for this user in this organization", async () => {
    sessionUser = { id: MEMBER };
    membership = member("admin", "active");
    await serve();

    const lookup = tableCalls.find(
      (call) => call.table === "organization_members",
    );
    expect(lookup?.ops).toEqual([
      { method: "select", args: ["role, status"] },
      { method: "eq", args: ["organization_id", ORG_ID] },
      { method: "eq", args: ["user_id", MEMBER] },
    ]);
  });

  test("a failed membership lookup refuses the request", async () => {
    sessionUser = { id: MEMBER };
    membership = { data: null, error: { message: "timeout" } };

    const response = await serve();

    expect(response.status).toBe(500);
    expect(downloads).toEqual([]);
  });
});

describe("serveSignedWaiver guest link", () => {
  beforeEach(() => {
    signatureRow = {
      ...signatureRow,
      user_id: null,
      anonymous_id: GUEST_RECORD,
    };
  });
  const guestQuery = (token: string, id = GUEST_RECORD) =>
    `?anonymousSignupId=${id}&token=${token}`;

  test("a guest with a valid token can read their own waiver", async () => {
    guestTokenValid = true;
    expect((await serve({ query: guestQuery("valid-token") })).status).toBe(
      200,
    );
  });

  test("a signed-in visitor can still open their own guest link", async () => {
    guestTokenValid = true;
    sessionUser = { id: MEMBER };

    expect((await serve({ query: guestQuery("valid-token") })).status).toBe(
      200,
    );
  });

  test("a wrong token, a missing token, or another guest's id is refused", async () => {
    guestTokenValid = true;
    sessionUser = { id: MEMBER };

    expect((await serve({ query: guestQuery("wrong") })).status).toBe(403);
    expect((await serve()).status).toBe(403);
    expect(
      (
        await serve({
          query: guestQuery(
            "valid-token",
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          ),
        })
      ).status,
    ).toBe(403);
    expect(downloads).toEqual([]);
  });
});

describe("serveSignedWaiver responses", () => {
  beforeEach(() => {
    sessionUser = { id: CREATOR };
  });

  test("a photo upload downloads as an image with a matching name", async () => {
    storedObject = new Blob(["jpeg"], { type: "image/jpeg" });
    signatureRow = {
      ...signatureRow,
      upload_storage_path: `signed-waivers/${PROJECT_ID}/key/file.jpg`,
    };

    const response = await serve();

    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="signed-waiver-${SIGNATURE_ID}.jpg"`,
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(downloads).toEqual([
      {
        bucket: "waiver-signatures",
        path: `signed-waivers/${PROJECT_ID}/key/file.jpg`,
      },
    ]);
  });

  test("the stored content type wins over a misleading extension", async () => {
    storedObject = new Blob(["png"], { type: "image/png" });

    const response = await serve({ inline: true });

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe(
      `inline; filename="waiver-${SIGNATURE_ID}.png"`,
    );
  });

  test("an e-signed waiver with no stored definition still renders", async () => {
    signatureRow = {
      ...signatureRow,
      upload_storage_path: null,
      signature_payload: {
        signers: [
          {
            role_key: "volunteer",
            method: "typed",
            data: "Alex Johnson",
            timestamp: "2026-03-01T20:15:00.000Z",
          },
        ],
        fields: {},
      },
    };

    const response = await serve({ inline: true });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    expect(pdf.getPageCount()).toBe(1);
  });

  test("the synthetic definition is keyed on the role the payload used", () => {
    expect(singleSignerDefinition("volunteer").fields).toEqual([
      expect.objectContaining({
        field_type: "signature",
        signer_role_key: "volunteer",
        page_index: 0,
      }),
    ]);
  });

  test("a preview opened as a document gets a readable page, not raw JSON", async () => {
    storedObject = null;

    const response = await serve({
      inline: true,
      accept: "text/html,application/xhtml+xml",
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("The signed waiver file is missing from storage.");
    expect(body).not.toContain('{"error"');
    expect(body).not.toContain("<script");
  });

  test("a download failure stays JSON with a readable message", async () => {
    storedObject = null;

    const response = await serve({ accept: "text/html" });

    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "The signed waiver file is missing from storage.",
    });
  });

  test("a missing record is a readable 404", async () => {
    signatureRow = null;

    const response = await serve();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "This signed waiver could not be found.",
    });
  });
});
