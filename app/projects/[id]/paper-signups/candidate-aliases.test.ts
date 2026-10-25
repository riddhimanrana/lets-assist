import { beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@/types";

const input = {
  projectId: "a1111111-1111-4111-8111-111111111111",
  batchId: "a2222222-2222-4222-8222-222222222222",
};
let allowed = true;
let project: Pick<Project, "event_type" | "schedule">;
let session = "oneTime";
let reads = 0;
let signups: Array<{
  id: string;
  project_id: string;
  schedule_id: string;
  status: string;
  profile: { full_name: string; email: string };
  guest: null;
}> = [];
mock.module("./access", () => ({
  requirePaperScanAccess: async () =>
    allowed
      ? {
          ok: true,
          userId: "fictional-organizer",
          project,
          admin: {
            from: (table: string) => {
              reads++;
              const filters: Array<(row: Record<string, unknown>) => boolean> =
                [];
              const query = {
                select: () => query,
                eq: (field: string, value: string) => {
                  filters.push((row) => row[field] === value);
                  return query;
                },
                in: (field: string, values: string[]) => {
                  filters.push((row) => values.includes(String(row[field])));
                  return query;
                },
                gt: (field: string, value: string) => {
                  filters.push((row) => String(row[field]) > value);
                  return query;
                },
                order: () => query,
                limit: () => query,
                single: async () => {
                  expect(table).toBe("project_paper_scan_batches");
                  const row = {
                    id: input.batchId,
                    project_id: input.projectId,
                    schedule_id: session,
                  };
                  return {
                    data: filters.every((filter) => filter(row)) ? row : null,
                  };
                },
                then: (
                  resolve: (value: {
                    data: typeof signups;
                    error: null;
                  }) => unknown,
                ) => {
                  expect(table).toBe("project_signups");
                  return resolve({
                    data: signups
                      .filter((row) => filters.every((filter) => filter(row)))
                      .slice(0, 200),
                    error: null,
                  });
                },
              };
              return query;
            },
          },
        }
      : { ok: false, error: "Not authorized" },
}));
const { loadAttendanceCandidates } = await import("./manual-actions");
beforeEach(() => {
  allowed = true;
  reads = 0;
  signups = [];
});
const slot = { startTime: "09:00", endTime: "11:00", volunteers: 10 };
const fixtures: Array<{
  project: Pick<Project, "event_type" | "schedule">;
  session: string;
  aliases: string[];
  other: string;
}> = [
  {
    project: {
      event_type: "oneTime",
      schedule: { oneTime: { date: "2030-08-18", ...slot } },
    },
    session: "oneTime",
    aliases: ["oneTime", "0", "default"],
    other: "invalid",
  },
  {
    project: {
      event_type: "multiDay",
      schedule: { multiDay: [{ date: "2030-08-18", slots: [slot, slot] }] },
    },
    session: "2030-08-18-0-0",
    aliases: ["2030-08-18-0-0", "2030-08-18-0", "0-0", "day-0-slot-0"],
    other: "day-0-slot-1",
  },
  {
    project: {
      event_type: "sameDayMultiArea",
      schedule: {
        sameDayMultiArea: {
          date: "2030-08-18",
          overallStart: "09:00",
          overallEnd: "11:00",
          roles: [
            { name: "Setup", ...slot },
            { name: "Cleanup", ...slot },
          ],
        },
      },
    },
    session: "Setup",
    aliases: ["Setup", "role-0"],
    other: "role-1",
  },
];
for (const fixture of fixtures) {
  test(`${fixture.project.event_type} manual review includes legacy signups only from its authorized session`, async () => {
    project = fixture.project;
    session = fixture.session;
    signups = fixture.aliases.map((alias, index) => ({
      id: `signup-${index}`,
      project_id: input.projectId,
      schedule_id: alias,
      status: index % 2 ? "attended" : "approved",
      profile: {
        full_name: `Volunteer ${index}`,
        email: `volunteer-${index}@example.test`,
      },
      guest: null,
    }));
    const expected = signups.map((row) => ({
      id: row.id,
      name: row.profile.full_name,
      email: row.profile.email,
    }));
    signups.push(
      { ...signups[0], id: "other-session", schedule_id: fixture.other },
      { ...signups[0], id: "other-project", project_id: "another-project" },
      { ...signups[0], id: "rejected", status: "rejected" },
    );
    expect(await loadAttendanceCandidates(input)).toEqual({
      candidates: expected,
    });
  });
}
test("an invalid batch session does not query volunteer identities", async () => {
  project = fixtures[0].project;
  session = "unknown-session";
  expect(await loadAttendanceCandidates(input)).toEqual({
    error: "Session not found.",
  });
  expect(reads).toBe(1);
});
test("revoked management access cannot load legacy identities", async () => {
  allowed = false;
  expect(await loadAttendanceCandidates(input)).toEqual({
    error: "Not authorized",
  });
  expect(reads).toBe(0);
});
