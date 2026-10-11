import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createClient as createSdkClient } from "@supabase/supabase-js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
let row: Record<string, unknown>;
const writes: { filter: string | null; body: Record<string, unknown> }[] = [];

// Exercise the real Supabase request builder with a local fetch double.
// It rejects every URL except this fictional row endpoint; no network runs.
const sdk = createSdkClient("https://fixture.invalid", "fictional-key", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = new URL(String(input));
        if (
          url.origin !== "https://fixture.invalid" ||
          url.pathname !== "/rest/v1/projects"
        )
          throw new Error("Network prohibited");
        expect(url.searchParams.get("id")).toBe(`eq.${PROJECT_ID}`);
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          const filter = url.searchParams.get("documents");
          writes.push({ filter, body });
          const matches =
            filter === "is.null"
              ? row.documents === null
              : filter?.startsWith("eq.") &&
                JSON.stringify(row.documents) ===
                  JSON.stringify(JSON.parse(filter.slice(3)));
          if (matches || !filter) row = { ...row, ...body };
          return new Response(null, { status: 204 });
        }
        return Response.json(row);
      },
      { preconnect: () => {} },
    ),
  },
});
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: OWNER_ID } }, error: null }),
    },
    from: (table: string) => sdk.from(table),
  }),
}));
const { linkProjectUploadedAssets } = await import("./assets");

const document = {
  name: "fixture.pdf",
  originalName: "fixture.pdf",
  type: "application/pdf",
  size: 12,
  url: "https://fixture.invalid/fictional-document.pdf",
};
beforeEach(() => {
  row = {
    id: PROJECT_ID,
    creator_id: OWNER_ID,
    organization_id: null,
    cover_image_url: null,
    documents: [],
  };
  writes.length = 0;
});

describe("asset linking through the real Supabase request builder", () => {
  test("array equality is sent as JSON text and the append is in the PATCH body", async () => {
    const existing = {
      ...document,
      name: "existing.pdf",
      url: "https://fixture.invalid/existing.pdf",
    };
    row.documents = [existing];
    expect(
      await linkProjectUploadedAssets(PROJECT_ID, { documents: [document] }),
    ).toEqual({ success: true });
    expect(writes).toEqual([
      {
        filter: `eq.${JSON.stringify([existing])}`,
        body: { documents: [existing, document] },
      },
    ]);
    expect(row.documents).toEqual([existing, document]);
  });
  test("SQL null uses is.null while an empty array uses eq.[]", async () => {
    row.documents = null;
    expect(
      await linkProjectUploadedAssets(PROJECT_ID, { documents: [document] }),
    ).toEqual({ success: true });
    expect(writes[0].filter).toBe("is.null");
    expect(writes[0].body.documents).toEqual([document]);
    row.documents = [];
    writes.length = 0;
    expect(
      await linkProjectUploadedAssets(PROJECT_ID, { documents: [document] }),
    ).toEqual({ success: true });
    expect(writes[0].filter).toBe("eq.[]");
  });
  test("cover-only writes carry neither a document filter nor a replacement", async () => {
    row.documents = [document];
    expect(
      await linkProjectUploadedAssets(PROJECT_ID, {
        coverImageUrl: "https://fixture.invalid/cover.png",
      }),
    ).toEqual({ success: true });
    expect(writes).toEqual([
      {
        filter: null,
        body: { cover_image_url: "https://fixture.invalid/cover.png" },
      },
    ]);
    expect(row.documents).toEqual([document]);
  });
});
