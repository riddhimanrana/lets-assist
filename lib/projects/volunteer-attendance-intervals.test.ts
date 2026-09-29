import { expect, mock, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";

mock.module("server-only", () => ({}));
const { loadVolunteerAttendanceIntervals } =
  await import("./volunteer-attendance-intervals");

type Interval = {
  project_id: string;
  signup_id: string;
  check_in_time: string;
  check_out_time: string;
};
const interval = (signupId: string, projectId = "project"): Interval => ({
  project_id: projectId,
  signup_id: signupId,
  check_in_time: "2026-09-20T09:00:00Z",
  check_out_time: "2026-09-20T10:00:00Z",
});

function fixture(rows: Interval[], fail = false, serverCap = 1000) {
  const requests: URL[] = [];
  const client = createClient("http://attendance.local.test", "fictional-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async (input: RequestInfo | URL) => {
          const url = new URL(String(input));
          requests.push(url);
          if (fail)
            return Response.json(
              { message: "fictional error" },
              { status: 400 },
            );
          const params = url.searchParams;
          const signupIds = params.get("signup_id")!.slice(4, -1).split(",");
          const selected = rows
            .map((row, index) => ({
              ...row,
              id: index.toString().padStart(8, "0"),
            }))
            .filter(
              (row) =>
                params.get("project_id") === `eq.${row.project_id}` &&
                signupIds.includes(row.signup_id),
            );
          const after = params.get("id")?.replace(/^gt\./, "");
          return Response.json(
            selected
              .filter((row) => !after || row.id > after)
              .slice(0, Math.min(serverCap, Number(params.get("limit")))),
          );
        },
        { preconnect() {} },
      ),
    },
  });
  return { client, requests };
}

test("reads every bounded interval page only for the authorized project signup IDs", async () => {
  const ids = Array.from({ length: 21 }, (_, index) => `signup-${index}`);
  const rows = ids.flatMap((id) =>
    Array.from({ length: 50 }, () => interval(id)),
  );
  const { client, requests } = fixture([
    ...rows,
    interval(ids[0], "other-project"),
    interval("another-user"),
  ]);
  const result = await loadVolunteerAttendanceIntervals(client, "project", ids);
  expect(Object.keys(result)).toEqual(ids);
  expect(Object.values(result).flat()).toHaveLength(1050);
  expect(requests).toHaveLength(4);
  for (const request of requests) {
    expect(request.searchParams.get("select")).toBe(
      "id,signup_id,check_in_time,check_out_time",
    );
    expect(request.searchParams.get("project_id")).toBe("eq.project");
    expect(request.searchParams.get("limit")).toBe("500");
    expect(request.searchParams.get("order")).toBe("id.asc");
  }
  expect(result[ids[0]][0]).toEqual({
    checkIn: rows[0].check_in_time,
    checkOut: rows[0].check_out_time,
  });
});

test("chunks large signup lists and makes no service query without authorized IDs", async () => {
  const { client, requests } = fixture([]);
  expect(await loadVolunteerAttendanceIntervals(client, "project", [])).toEqual(
    {},
  );
  expect(requests).toHaveLength(0);
  const ids = Array.from({ length: 201 }, (_, index) => `signup-${index}`);
  const result = await loadVolunteerAttendanceIntervals(client, "project", [
    ...ids,
    ids[0],
  ]);
  expect(Object.keys(result)).toHaveLength(201);
  expect(requests).toHaveLength(3);
});

test("read failure and unexpected interval overflow cannot become legacy envelope totals", async () => {
  for (const { client } of [
    fixture([], true),
    fixture(Array.from({ length: 51 }, () => interval("signup"))),
  ]) {
    await expect(
      loadVolunteerAttendanceIntervals(client, "project", ["signup"]),
    ).rejects.toThrow("Could not load volunteer attendance intervals.");
  }
});

test("page hydrates only its signed-in user's RLS-approved signups and both cards use the shared total", async () => {
  const page = await Bun.file(
    new URL("../../app/projects/[id]/page.tsx", import.meta.url),
  ).text();
  const dashboard = await Bun.file(
    new URL("../../app/projects/[id]/UserDashboard.tsx", import.meta.url),
  ).text();
  expect(page).toContain('.eq("project_id", project.id)');
  expect(page).toContain('.eq("user_id", user.id)');
  expect(page).toContain("} else if (relevantSignups) {");
  expect(page).toContain("relevantSignups.map((signup) => signup.id)");
  expect(page).toContain("attendance_intervals: null");
  expect(
    dashboard.match(/volunteerAttendanceDuration\(\s*status.signup/g),
  ).toHaveLength(2);
  expect(dashboard).not.toContain("function calculateVolunteerDuration");
  expect(dashboard).toContain('.eq("project_id", project.id)');
  expect(dashboard).toContain(
    "matchVolunteerCertificate(project, signup, cert)",
  );
});

test("a lower server row cap still reads all reviewed intervals", async () => {
  const rows = ["first", "second", "third"].flatMap((id) =>
    Array.from({ length: 50 }, () => interval(id)),
  );
  const { client, requests } = fixture(rows, false, 75);
  const result = await loadVolunteerAttendanceIntervals(client, "project", [
    "first",
    "second",
    "third",
  ]);
  expect(Object.values(result).flat()).toHaveLength(150);
  expect(requests).toHaveLength(3);
  expect(requests[1].searchParams.get("id")).toBe("gt.00000074");
  expect(requests[2].searchParams.get("id")).toBe("gt.00000149");
});
