import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Project, Signup } from "@/types";
import type { VolunteerCertificate } from "@/lib/projects/volunteer-attendance-duration";
import { UserSignupStatusCard } from "./UserSignupStatusCard";
import { getSignupStatuses } from "./user-dashboard-status";

const signup = {
  id: "signup",
  project_id: "project",
  user_id: "volunteer",
  status: "attended",
  schedule_id: "oneTime",
  check_in_time: "2026-09-20T09:00:00Z",
  check_out_time: "2026-09-20T12:00:00Z",
  attendance_intervals: [
    { checkIn: "2026-09-20T09:00:00Z", checkOut: "2026-09-20T09:30:00Z" },
    { checkIn: "2026-09-20T11:30:00Z", checkOut: "2026-09-20T12:00:00Z" },
  ],
} as Signup;
const certificate: VolunteerCertificate = {
  id: "certificate",
  signup_id: signup.id,
  project_id: "project",
  schedule_id: "oneTime",
  type: "verified",
  credited_minutes: 61,
  event_start: signup.check_in_time,
  event_end: signup.check_out_time,
};

function renderCard(
  published: boolean,
  award?: VolunteerCertificate,
  complete = true,
) {
  const project = {
    id: "project",
    title: "Fictional volunteering",
    event_type: "oneTime",
    verification_method: "manual",
    published: { oneTime: published },
    schedule: {
      oneTime: { date: "2026-09-20", startTime: "09:00", endTime: "12:00" },
    },
  } as unknown as Project;
  const [status] = getSignupStatuses(
    [signup],
    project,
    new Date("2026-09-21T12:00:00Z"),
    award ? { signup: award } : {},
  );
  expect(status).toBeDefined();
  return renderToStaticMarkup(
    <UserSignupStatusCard
      status={status!}
      project={project}
      certificate={award}
      certificateReadComplete={complete}
      hideReminder={false}
      onScan={() => {}}
    />,
  );
}

test("published card displays the award snapshot instead of its attendance envelope", () => {
  const html = renderCard(true, certificate);
  expect(html).toContain("1h 1m");
  expect(html).toContain("/certificates/certificate");
  expect(html).not.toContain("3h");
});

test("unpublished card excludes the gap between reviewed visits", () => {
  const html = renderCard(false);
  expect(html).toContain("1h");
  expect(html).not.toContain("3h");
});

test("a missing award stays unavailable instead of inventing credit or a certificate link", () => {
  for (const complete of [false, true]) {
    const html = renderCard(true, undefined, complete);
    expect(html).toContain(complete ? "Award unavailable" : "Loading award");
    expect(html).not.toContain("/certificates/");
    expect(html).not.toContain("3h");
  }
});
