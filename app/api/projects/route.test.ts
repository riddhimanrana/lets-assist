import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
let unavailable = false;
mock.module("@/app/home/actions", () => ({
  getActiveProjects: async (...args: unknown[]) => {
    calls.push(args);
    if (unavailable) throw new Error("Synthetic occupancy unavailable");
    return [{ id: "fictional-project", slots_filled: 1200 }];
  },
}));
const { GET } = await import("./route");
const request = (query = "") =>
  new Request(`http://localhost/api/projects?${query}`);

describe("project discovery route", () => {
  beforeEach(() => {
    calls.length = 0;
    unavailable = false;
  });
  test("passes validated filters and pagination to the feed", async () => {
    const response = await GET(
      request(
        "limit=21&offset=42&status=upcoming&eventType=multiDay&search=park",
      ),
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      [
        21,
        42,
        "upcoming",
        undefined,
        undefined,
        { searchTerm: "park", eventType: "multiDay" },
      ],
    ]);
    expect(await response.json()).toEqual([
      { id: "fictional-project", slots_filled: 1200 },
    ]);
  });
  test("invalid input returns 400 before any feed read", async () => {
    for (const query of [
      "limit=5000",
      "offset=-1",
      "eventType=unknown",
      "limit=1junk",
    ]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
  test("unavailable counts return retryable failure instead of apparent empty capacity", async () => {
    unavailable = true;
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Projects are temporarily unavailable. Please try again.",
    });
  });
});
