import { beforeEach, describe, expect, mock, test } from "bun:test";

let authorized = true;
const inserted: Record<string, unknown>[] = [];
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: authorized
            ? { id: "viewer", email: "viewer@example.test" }
            : null,
        },
      }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "certificate" }, error: null }),
          }),
        };
      },
    }),
  }),
}));
const { POST } = await import("./route");
const input = {
  title: "Cleanup",
  creatorName: "Supervisor",
  date: "2026-10-06",
  startTime: "09:00",
  endTime: "10:00",
  timeZone: "America/Los_Angeles",
};
const request = (body: string) =>
  new Request("http://localhost/api/self-reported-hours", {
    method: "POST",
    body,
  });

describe("self-reported hours route", () => {
  beforeEach(() => {
    authorized = true;
    inserted.length = 0;
  });
  test("stores validated UTC instants on the authenticated user's uncertified record", async () => {
    const response = await POST(
      request(
        JSON.stringify({ ...input, user_id: "forged", is_certified: true }),
      ),
    );
    expect(response.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      user_id: "viewer",
      event_start: "2026-10-06T16:00:00.000Z",
      event_end: "2026-10-06T17:00:00.000Z",
      is_certified: false,
      type: "self-reported",
    });
  });
  test("malformed JSON and invalid field types return 400 without a write", async () => {
    expect((await POST(request("invalid json"))).status).toBe(400);
    expect(
      (await POST(request(JSON.stringify({ ...input, title: 123 })))).status,
    ).toBe(400);
    expect(inserted).toEqual([]);
  });
  test("a wall time that happens twice returns its explanation and writes nothing", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          ...input,
          date: "2026-11-01",
          startTime: "01:30",
          endTime: "02:30",
          timeZone: "America/Los_Angeles",
        }),
      ),
    );
    expect(response.status).toBe(400);
    // The hours form shows this `error` as the toast description.
    expect(await response.json()).toEqual({
      error:
        "That time happens twice on this date because clocks change. Enter a time before 1:00 AM or after 2:00 AM, or split the entry.",
    });
    expect(inserted).toEqual([]);
  });
  test("requires authentication before parsing a write", async () => {
    authorized = false;
    expect((await POST(request(JSON.stringify(input)))).status).toBe(401);
    expect(inserted).toEqual([]);
  });
});
