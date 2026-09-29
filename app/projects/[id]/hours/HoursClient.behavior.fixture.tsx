import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as React from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Project } from "@/types";
import type { AttendanceHoursSignup } from "./HoursClient";

const scenario = process.argv[2];
const mixed = scenario.startsWith("mixed-");
const state: unknown[] = [];
let cursor = 0;
if (mixed) {
  mock.module("react", () => ({
    ...React,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state))
        state[index] = typeof initial === "function" ? initial() : initial;
      return [
        state[index],
        (value: unknown) => {
          state[index] =
            typeof value === "function" ? value(state[index]) : value;
        },
      ];
    },
  }));
}
type ButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};
const buttons: ButtonProps[] = [];
mock.module("@/components/ui/button", () => ({
  Button: (props: ButtonProps) => {
    buttons.push(props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
mock.module("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
mock.module("@/components/projects/AttendanceTools", () => ({
  AttendanceTools: () => null,
}));
mock.module("@/components/projects/AttendanceExport", () => ({
  AttendanceExport: () => null,
}));
mock.module("@/components/projects/AttendanceIntervalEditor", () => ({
  AttendanceIntervalEditor: () => null,
}));
const publicationCalls: unknown[][] = [];
mock.module("./actions", () => ({
  correctVolunteerAttendance() {},
  recordVolunteerAttendance() {},
  async publishVolunteerHours(...args: unknown[]) {
    publicationCalls.push(args);
    return { success: true, certificatesCreated: 1 };
  },
  resendCertificateEmails() {},
  sendCorrectedCertificateEmail() {},
}));
const future = scenario === "future";
const date = future ? "2099-01-01" : "2020-01-01";
const legacy =
  scenario === "legacy" ||
  scenario === "corrected-legacy" ||
  scenario === "mixed-legacy";
const verified = scenario === "verified" || scenario === "mixed-verified";
const project = {
  id: "fictional-project",
  title: "Fictional attendance",
  event_type: "oneTime",
  project_timezone: "UTC",
  schedule: { oneTime: { date, startTime: "09:00", endTime: "12:00" } },
  published: {},
} as Project;
if (scenario === "missing-window") project.schedule = {};
const signup: AttendanceHoursSignup = {
  id: "fictional-signup",
  project_id: project.id,
  schedule_id: scenario === "past-legacy" ? "0" : "oneTime",
  user_id: "fictional-user",
  status: "attended",
  created_at: "2020-01-01T00:00:00Z",
  attendance_revision: 0,
  check_in_time: `${date}T09:00:00Z`,
  check_out_time: `${date}T11:00:00Z`,
  project_attendance_intervals: [],
  profile: {
    id: "fictional-user",
    full_name: "Fictional volunteer",
    username: "fictional-volunteer",
    email: "fictional-volunteer@example.test",
    phone: "",
  },
  certificates:
    legacy || verified || scenario === "self-reported"
      ? [
          {
            id: "original-certificate",
            credited_minutes: scenario === "legacy" ? null : 90,
            event_start: `${date}T09:00:00Z`,
            event_end: `${date}T11:00:00Z`,
            attendance_revision: 0,
            type: legacy ? null : verified ? "verified" : "self-reported",
            canResendCorrection: false,
          },
        ]
      : [],
};
const { HoursClient } = await import("./HoursClient");
const render = () => {
  cursor = 0;
  buttons.length = 0;
  return renderToStaticMarkup(
    <HoursClient
      project={project}
      initialSignups={
        mixed
          ? [signup, { ...signup, id: "uncertified-signup", certificates: [] }]
          : [signup]
      }
    />,
  );
};
const markup = render();
const button = (label: string) =>
  buttons.find((props) =>
    renderToStaticMarkup(<>{props.children}</>).includes(label),
  );
if (mixed) {
  assert.ok(button("Correct hours"));
  assert.ok(button("Edit visits"));
  assert.equal(button("Review and publish 1 volunteer")?.disabled, false);
  assert.equal(button("Retry certificate delivery"), undefined);
  assert.ok(markup.includes("Not published"));
  button("Review and publish 1 volunteer")!.onClick!();
  render();
  button("Publish hours")!.onClick!();
  await Promise.resolve();
  assert.equal(publicationCalls.length, 1);
  assert.deepEqual(
    (publicationCalls[0][2] as Array<{ signupId: string }>).map(
      (entry) => entry.signupId,
    ),
    ["uncertified-signup"],
  );
} else if (legacy || verified) {
  assert.ok(button("Correct hours"));
  assert.ok(button("View certificate"));
  assert.equal(button("Edit visits"), undefined);
  assert.equal(button("Review and publish"), undefined);
  assert.ok(markup.includes(scenario === "legacy" ? "2h 0m" : "1h 30m"));
  assert.ok(markup.includes("awarded"));
} else {
  assert.ok(button("Edit visits"));
  assert.equal(button("Correct hours"), undefined);
  assert.equal(button("View certificate"), undefined);
  assert.equal(
    button("Review and publish")?.disabled,
    future || scenario === "missing-window",
  );
  if (future) assert.ok(markup.includes("after this session ends"));
  if (scenario === "missing-window")
    assert.ok(markup.includes("needs a valid schedule"));
}
