import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * This route has no in-app caller today, but it is a public, unauthenticated
 * GET endpoint (see route-boundaries below), so a reserved organization
 * username must be reported unavailable here too -- anyone can hit it
 * directly regardless of which client UI does or does not call it.
 */

let dbCalls = 0;
let existingUsernames = new Set<string>();

function serverClient() {
  return {
    from(table: string) {
      if (table !== "organizations") {
        throw new Error(`serverClient: unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            single: async () => {
              dbCalls += 1;
              return existingUsernames.has(value)
                ? { data: { username: value }, error: null }
                : { data: null, error: { code: "PGRST116" } };
            },
          }),
        }),
      };
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient(),
}));

const { GET } = await import("./route");

function requestFor(username: string | null) {
  const nextUrl = new URL("https://lets-assist.com/api/check-org-username");
  if (username !== null) {
    nextUrl.searchParams.set("username", username);
  }
  // The handler only reads `request.nextUrl.searchParams`, so a minimal
  // stub avoids depending on the real `NextRequest` constructor.
  return { nextUrl } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  dbCalls = 0;
  existingUsernames = new Set();
});

describe("GET /api/check-org-username", () => {
  test("reports every reserved slug spelling unavailable without querying the database", async () => {
    for (const value of ["create", "CREATE", " join ", "Join"]) {
      const response = await GET(requestFor(value));
      expect(await response.json()).toEqual({ available: false });
    }
    expect(dbCalls).toBe(0);
  });

  test("reports an available, non-reserved username as available", async () => {
    const response = await GET(requestFor("acme-nonprofit"));
    expect(await response.json()).toEqual({ available: true });
    expect(dbCalls).toBe(1);
  });

  test("reports a taken, non-reserved username as unavailable", async () => {
    existingUsernames.add("taken-org");
    const response = await GET(requestFor("taken-org"));
    expect(await response.json()).toEqual({ available: false });
  });

  test("still requires the username parameter", async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
  });
});
