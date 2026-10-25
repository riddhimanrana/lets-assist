import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";

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
let sourcePageSize: [number, number] = [612, 792];
mock.module("@/lib/waiver/source-pdf-loader", () => ({
  loadWaiverSourcePdf: async () => {
    const document = await PDFDocument.create();
    document.addPage(sourcePageSize);
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

/**
 * The first page of a served PDF: its size, and each standard-font string with
 * the left, right, bottom, and top edges it was drawn within.
 */
async function servedPage(response: Response) {
  const document = await PDFDocument.load(await response.arrayBuffer());
  const page = document.getPages()[0];
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref))
      : [contents];
  const source = streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) =>
      Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
    )
    .join("\n");

  const font = await (
    await PDFDocument.create()
  ).embedFont(StandardFonts.Helvetica);
  const drawn = Array.from(source.matchAll(/BT([\s\S]*?)ET/g), ([, body]) => {
    const size = /\s(-?[\d.]+) Tf/.exec(body);
    const origin = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/.exec(body);
    const hex = /<([0-9A-Fa-f]+)>\s*Tj/.exec(body);
    if (!size || !origin || !hex) throw new Error("Unreadable text block");
    const text = Buffer.from(hex[1], "hex").toString("latin1");
    const [x, y, points] = [origin[1], origin[2], size[1]].map(Number);
    return {
      text,
      x,
      y,
      right: x + font.widthOfTextAtSize(text, points),
      bottom: y - points * 0.25,
      top: y + points,
    };
  });

  return { size: page.getSize(), drawn };
}

const typedVolunteerPayload = {
  signers: [
    {
      role_key: "volunteer",
      method: "typed",
      data: "Alex Johnson",
      timestamp: "2026-03-01T20:15:00.000Z",
    },
  ],
  fields: {},
};

const UNPLACEABLE_MESSAGE =
  "A signature on this waiver has no valid position on the waiver document, so a complete signed copy cannot be created. Contact the organizer for help.";

beforeEach(() => {
  tableCalls.length = 0;
  downloads.length = 0;
  sessionUser = null;
  guestTokenValid = false;
  membership = { data: null, error: null };
  sourcePageSize = [612, 792];
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
    upload_storage_path: `signed-waivers/${PROJECT_ID}/3d6a1cd5-60a6-4a61-8b13-06a4402fe143/9f0e1d2c-3b4a-4c5d-8e6f-708192a3b4c5.pdf`,
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
      upload_storage_path: `signed-waivers/${PROJECT_ID}/3d6a1cd5-60a6-4a61-8b13-06a4402fe143/9f0e1d2c-3b4a-4c5d-8e6f-708192a3b4c5.jpg`,
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
        path: `signed-waivers/${PROJECT_ID}/3d6a1cd5-60a6-4a61-8b13-06a4402fe143/9f0e1d2c-3b4a-4c5d-8e6f-708192a3b4c5.jpg`,
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

  test("a corrupt signature returns a private readable refusal, never a completed PDF", async () => {
    signatureRow = {
      ...signatureRow,
      upload_storage_path: null,
      signature_payload: {
        signers: [
          {
            role_key: "volunteer",
            method: "draw",
            data: "data:image/png;base64,AAAA",
            timestamp: "2026-03-01T20:15:00.000Z",
          },
        ],
        fields: {},
      },
    };
    const response = await serve({ inline: true, accept: "text/html" });
    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain("signature");
  });

  test.each([
    ["on a page the document does not have", "volunteer", 3],
    ["only for another role", "guardian", 0],
  ])(
    "a valid typed signature whose placement is %s returns a private readable refusal, never a PDF",
    async (_label, fieldRole, pageIndex) => {
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
        waiver_definition: {
          id: "55555555-5555-4555-8555-555555555555",
          pdf_storage_path: `project_waivers/${PROJECT_ID}/source.pdf`,
          pdf_public_url: null,
          signers: [],
          fields: [
            {
              field_key: "volunteer_signature",
              field_type: "signature",
              page_index: pageIndex,
              rect: { x: 72, y: 500, width: 240, height: 48 },
              signer_role_key: fieldRole,
            },
          ],
        },
      };
      const message =
        "A signature on this waiver has no valid position on the waiver document, so a complete signed copy cannot be created. Contact the organizer for help.";

      const download = await serve();

      expect(download.status).toBe(422);
      expect(download.headers.get("Content-Type")).toContain(
        "application/json",
      );
      expect(download.headers.get("Content-Disposition")).toBeNull();
      expect(download.headers.get("Cache-Control")).toBe("private, no-store");
      expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await download.json()).toEqual({ error: message });

      const preview = await serve({ inline: true, accept: "text/html" });
      const body = await preview.text();

      expect(preview.status).toBe(422);
      expect(preview.headers.get("Content-Type")).toContain("text/html");
      expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
      expect(preview.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(body).toContain(message);
      expect(body).not.toContain("%PDF");
      expect(body).not.toContain("Alex Johnson");
      // No signature evidence was read from storage for the refused copy.
      expect(downloads).toEqual([]);
    },
  );

  test("the same typed signature with a placement on the page still renders", async () => {
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
      waiver_definition: {
        id: "55555555-5555-4555-8555-555555555555",
        pdf_storage_path: `project_waivers/${PROJECT_ID}/source.pdf`,
        pdf_public_url: null,
        signers: [],
        fields: [
          {
            field_key: "volunteer_signature",
            field_type: "signature",
            page_index: 0,
            rect: { x: 72, y: 500, width: 240, height: 48 },
            signer_role_key: "volunteer",
          },
        ],
      },
    };

    const response = await serve();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  test("a Letter source with no stored definition is stamped where it always was", async () => {
    signatureRow = {
      ...signatureRow,
      upload_storage_path: null,
      signature_payload: typedVolunteerPayload,
    };

    const response = await serve();

    expect(response.status).toBe(200);
    const { drawn } = await servedPage(response);
    expect(drawn.map(({ text, x, y }) => ({ text, x, y }))).toEqual([
      { text: "Alex Johnson", x: 105, y: 672 },
      { text: "Signed: Mar 1, 2026 at 12:15 PM PST", x: 100, y: 638 },
    ]);
  });

  test.each<[string, [number, number], number]>([
    ["a landscape Letter", [792, 612], 470],
    ["a short portrait A5", [420, 595], 453],
  ])(
    "%s source with no stored definition returns a complete signed copy",
    async (_label, size, boxBottom) => {
      sourcePageSize = size;
      signatureRow = {
        ...signatureRow,
        upload_storage_path: null,
        signature_payload: typedVolunteerPayload,
      };

      const response = await serve({ inline: true });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const page = await servedPage(response);
      expect(page.size).toEqual({ width: size[0], height: size[1] });
      expect(page.drawn.map(({ text, x, y }) => ({ text, x, y }))).toEqual([
        { text: "Alex Johnson", x: 105, y: boxBottom + 22 },
        {
          text: "Signed: Mar 1, 2026 at 12:15 PM PST",
          x: 100,
          y: boxBottom - 12,
        },
      ]);
      for (const text of page.drawn) {
        expect(text.x).toBeGreaterThanOrEqual(0);
        expect(text.bottom).toBeGreaterThanOrEqual(0);
        expect(text.right).toBeLessThanOrEqual(size[0]);
        expect(text.top).toBeLessThanOrEqual(size[1]);
      }
    },
  );

  test("a legacy typed signature with no payload also fits a short source", async () => {
    sourcePageSize = [420, 595];
    signatureRow = {
      ...signatureRow,
      upload_storage_path: null,
      signature_text: "Alex Johnson",
    };

    const response = await serve();

    expect(response.status).toBe(200);
    const page = await servedPage(response);
    expect(page.drawn.map(({ text }) => text)).toEqual([
      "Alex Johnson",
      "Signed: Mar 1, 2026 at 12:15 PM PST",
    ]);
    for (const text of page.drawn) {
      expect(text.bottom).toBeGreaterThanOrEqual(0);
      expect(text.right).toBeLessThanOrEqual(420);
      expect(text.top).toBeLessThanOrEqual(595);
    }
  });

  test.each([
    ["a stored definition", "55555555-5555-4555-8555-555555555555"],
    [
      "a stored definition that carries the fallback's id",
      "synthetic-single-signer",
    ],
  ])(
    "%s with a placement off a landscape source is refused, never moved",
    async (_label, definitionId) => {
      sourcePageSize = [792, 612];
      signatureRow = {
        ...signatureRow,
        upload_storage_path: null,
        signature_payload: typedVolunteerPayload,
        waiver_definition: {
          id: definitionId,
          pdf_storage_path: `project_waivers/${PROJECT_ID}/source.pdf`,
          pdf_public_url: null,
          signers: [],
          // The same box the fallback uses, which this source could hold if moved.
          fields: singleSignerDefinition("volunteer").fields,
        },
      };

      const response = await serve();

      expect(response.status).toBe(422);
      expect(response.headers.get("Content-Disposition")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: UNPLACEABLE_MESSAGE });
    },
  );

  test("a source too small for the fallback box is refused", async () => {
    sourcePageSize = [100, 100];
    signatureRow = {
      ...signatureRow,
      upload_storage_path: null,
      signature_payload: typedVolunteerPayload,
    };

    const response = await serve();

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: UNPLACEABLE_MESSAGE });
    expect(downloads).toEqual([]);
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
