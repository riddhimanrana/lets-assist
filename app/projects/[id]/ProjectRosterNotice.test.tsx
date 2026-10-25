import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlotAttendee } from "@/components/projects/SlotAttendeesDropdown";
import { ProjectRosterNotice } from "./ProjectRosterNotice";

const previousSchedule = [
  { signup_id: "fictional", schedule_id: "removed" },
] as SlotAttendee[];
const render = (
  state: Parameters<typeof ProjectRosterNotice>[0]["state"],
  rows = previousSchedule,
) =>
  renderToStaticMarkup(
    <ProjectRosterNotice
      state={state}
      previousSchedule={rows}
      onRetry={async () => {}}
    />,
  );

test("previous schedule signups have their own visible count and no signup action", () => {
  const html = render("ready");
  expect(html).toContain("Signups from a previous schedule");
  expect(html).toContain("1 signed up");
  expect(html).toContain("Contact the organizer");
  expect(html).not.toContain("Sign up now");
});

test("loading, failure and denied access never claim a zero or previous roster", () => {
  expect(render("loading")).toContain("Loading signups");
  expect(render("error")).toContain("Retry loading signups");
  for (const state of ["loading", "error"] as const) {
    expect(render(state)).not.toContain("1 signed up");
  }
  expect(render("restricted")).toBe("");
  expect(render("ready", [])).toBe("");
});
