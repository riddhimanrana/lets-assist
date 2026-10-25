import { describe, expect, test } from "bun:test";

import {
  healthVerdict,
  parseContainerRows,
  summarizeProjects,
} from "./docker-health.mjs";

describe("local Docker health", () => {
  test("groups only Let's Assist Supabase resources", () => {
    const projects = summarizeProjects(
      parseContainerRows(
        [
          "lets-assist-csf-browser-one|running|Up 2 minutes (healthy)|supabase_db_lets-assist-csf-browser-one",
          "lets-assist-csf-browser-one|restarting|Restarting (1)|supabase_auth_lets-assist-csf-browser-one",
          "vela-dashboard|running|Up 2 minutes (healthy)|supabase_db_vela-dashboard",
        ].join("\n"),
      ),
    );

    expect(projects).toEqual([
      {
        project: "lets-assist-csf-browser-one",
        containers: 2,
        running: 1,
        restarting: 1,
        unhealthy: 0,
      },
    ]);
  });

  test("fails for restart loops or more than two stacks", () => {
    const restartLoop = healthVerdict([
      {
        project: "lets-assist-csf-browser-one",
        containers: 2,
        running: 1,
        restarting: 1,
        unhealthy: 0,
      },
    ]);
    expect(restartLoop.healthy).toBe(false);

    const overloaded = healthVerdict(
      ["one", "two", "three"].map((project) => ({
        project,
        containers: 1,
        running: 1,
        restarting: 0,
        unhealthy: 0,
      })),
    );
    expect(overloaded.healthy).toBe(false);
    expect(overloaded.overloaded).toBe(true);
  });
});
