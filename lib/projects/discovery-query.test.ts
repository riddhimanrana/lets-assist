import { describe, expect, test } from "bun:test";
import {
  parseProjectDiscoveryQuery,
  projectDiscoveryQuerySchema,
  projectSearchFilter,
} from "./discovery-query";

describe("project discovery input", () => {
  test("retains default and bounded explicit pagination", () => {
    expect(parseProjectDiscoveryQuery(new URLSearchParams()).data).toEqual({
      limit: 20,
      offset: 0,
      status: "upcoming",
    });
    expect(
      parseProjectDiscoveryQuery(
        new URLSearchParams(
          "limit=100&offset=10000&eventType=multiDay&search=cleanup",
        ),
      ).success,
    ).toBe(true);
  });
  test.each([
    "limit=-1",
    "limit=0",
    "limit=101",
    "limit=20garbage",
    "limit=1.5",
    "limit=Infinity",
    "offset=-1",
    "offset=10001",
    "offset=1e2",
    "status=unknown",
    "eventType=unknown",
    `search=${"x".repeat(201)}`,
  ])("refuses invalid query %s", (query) => {
    expect(parseProjectDiscoveryQuery(new URLSearchParams(query)).success).toBe(
      false,
    );
  });
  test("server action numbers must also satisfy bounds", () => {
    for (const limit of [-1, 0, 1000, NaN, Infinity, 1.5]) {
      expect(projectDiscoveryQuerySchema.safeParse({ limit }).success).toBe(
        false,
      );
    }
  });
  test("quotes reserved filter syntax and escapes quotation and backslash", () => {
    expect(projectSearchFilter("Community, park (west)")).toBe(
      'title.ilike."%Community, park (west)%",description.ilike."%Community, park (west)%"',
    );
    expect(projectSearchFilter('A "quote" and \\ path')).toBe(
      'title.ilike."%A \\"quote\\" and \\\\ path%",description.ilike."%A \\"quote\\" and \\\\ path%"',
    );
  });
});
