import { beforeEach, describe, expect, mock, test } from "bun:test";

const projectId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const viewerId = "33333333-3333-4333-8333-333333333333";
const project = {
  id: projectId,
  creator_id: viewerId,
  organization_id: organizationId,
  title: "Fictional cleanup",
  event_type: "oneTime",
  project_timezone: "UTC",
  status: "upcoming",
  created_at: "2026-10-01T00:00:00Z",
  schedule: {
    oneTime: {
      date: "2099-01-01",
      startTime: "09:00",
      endTime: "10:00",
      volunteers: 2000,
    },
  },
};
const calls: { name: string; args: Record<string, unknown> }[] = [];
const order: string[] = [];
let missingCounts = false;
let rawSignupReads = 0;
class Query {
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  or() {
    return this;
  }
  range() {
    return this;
  }
  order(column: string) {
    order.push(column);
    return this;
  }
  then(resolve: (value: unknown) => unknown) {
    const data =
      this.table === "project_discovery_read_model" || this.table === "projects"
        ? [project]
        : [];
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}
const from = (table: string) => {
  if (table === "project_signups") {
    rawSignupReads += 1;
    throw new Error("Raw signup fetch forbidden");
  }
  return new Query(table);
};
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: missingCounts
          ? []
          : [
              {
                project_id: projectId,
                slots_filled: 1601,
                slots_filled_by_schedule: { oneTime: 1601 },
              },
            ],
        error: null,
      };
    },
  }),
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from,
    auth: { getUser: async () => ({ data: { user: { id: viewerId } } }) },
  }),
}));
mock.module("@/lib/supabase/retry-query", () => ({
  withRetryableSupabaseQuery: async (query: () => unknown) => query(),
}));

const { getActiveProjects } = await import("./actions");
describe("project feed exact occupancy integration", () => {
  beforeEach(() => {
    calls.length = 0;
    order.length = 0;
    missingCounts = false;
    rawSignupReads = 0;
  });
  test("public discovery requests bounded public aggregates with stable page ordering", async () => {
    const projects = await getActiveProjects();
    expect(projects[0]).toHaveProperty("slots_filled", 1601);
    expect(projects[0]).toHaveProperty("slots_filled_by_schedule", {
      oneTime: 1601,
    });
    expect(calls).toEqual([
      {
        name: "project_occupancy_for_visible_projects",
        args: {
          p_project_ids: [projectId],
          p_viewer_id: null,
          p_organization_id: null,
        },
      },
    ]);
    expect(order).toEqual(["created_at", "id"]);
    expect(rawSignupReads).toBe(0);
  });
  test("organization aggregates bind the session viewer instead of a supplied user ID", async () => {
    const projects = await getActiveProjects(
      21,
      0,
      "upcoming",
      organizationId,
      "forged-viewer",
    );
    expect(projects[0]).toHaveProperty("slots_filled", 1601);
    expect(calls[0].args).toEqual({
      p_project_ids: [projectId],
      p_viewer_id: viewerId,
      p_organization_id: organizationId,
    });
    expect(rawSignupReads).toBe(0);
  });
  test("missing aggregates fail the page instead of claiming empty capacity", async () => {
    missingCounts = true;
    await expect(getActiveProjects()).rejects.toThrow("unavailable");
  });
  test("invalid direct action pagination is refused before querying", async () => {
    await expect(getActiveProjects(1000)).rejects.toThrow(
      "Invalid project search parameters",
    );
    expect(calls).toEqual([]);
  });
});
