import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Project } from "@/types";
import {
  ProjectSlotAction,
  type ProjectSlotActionProps,
} from "./ProjectSlotAction";
import { ProjectSlotsCard } from "./ProjectSlotsCard";
import { ProjectDetailsAside } from "./ProjectDetailsAside";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000081",
  title: "Fictional neighborhood cleanup",
  description: "Fictional layout fixture",
  location: "Fictional community park",
  creator_id: "00000000-0000-4000-8000-000000000082",
  event_type: "multiDay",
  workflow_status: "published",
  status: "upcoming",
  visibility: "unlisted",
  verification_method: "manual",
  require_login: true,
  pause_signups: false,
  created_at: "2026-10-12T00:00:00Z",
  project_timezone: "America/Los_Angeles",
  profiles: {} as Project["profiles"],
  schedule: {
    multiDay: [
      {
        date: "2099-06-14",
        slots: [
          {
            name: "Morning cleanup",
            startTime: "09:00",
            endTime: "11:00",
            volunteers: 5,
          },
          {
            name: "Afternoon cleanup",
            startTime: "13:00",
            endTime: "15:00",
            volunteers: 4,
          },
        ],
      },
    ],
  },
};
function action(overrides: Partial<ProjectSlotActionProps> = {}) {
  return ProjectSlotAction({
    projectTitle: project.title,
    isCreator: false,
    isPast: false,
    isCancelled: false,
    isLoading: false,
    isSignedUp: false,
    isRejected: false,
    isAttended: false,
    isPending: false,
    isFull: false,
    onClick: () => {},
    ...overrides,
  });
}

describe("previous slot signup layout with current state guards", () => {
  test("each available slot retains its own filled signup action and exact callback", () => {
    let invoked = 0;
    const button = action({ onClick: () => invoked++ });
    expect(button.props.variant).toBe("default");
    expect(button.props.disabled).toBe(false);
    expect(renderToStaticMarkup(button)).toContain("Sign up");
    button.props.onClick();
    expect(invoked).toBe(1);
  });
  test("pending and existing signups retain distinct action styles", () => {
    expect(action({ isPending: true }).props.variant).toBe("outline");
    expect(action({ isSignedUp: true }).props.variant).toBe("secondary");
    expect(action({ isPending: true, isSignedUp: true }).props.variant).toBe(
      "outline",
    );
  });
  test("full, past, cancelled, busy, rejected and attended slots remain disabled", () => {
    for (const key of [
      "isFull",
      "isPast",
      "isCancelled",
      "isLoading",
      "isRejected",
      "isAttended",
    ] as const) {
      expect(action({ [key]: true }).props.disabled).toBe(true);
    }
    expect(action({ isFull: true, isSignedUp: true }).props.disabled).toBe(
      false,
    );
  });
  test("the creator retains a truthful note rather than an apparent signup button", () => {
    const html = renderToStaticMarkup(action({ isCreator: true }));
    expect(html).toContain("You are the organizer");
    expect(html).not.toContain("<button");
  });
  test("the bordered day slots bind signup callbacks to their exact schedule IDs", () => {
    const bindings: Array<[string, boolean]> = [];
    const html = renderToStaticMarkup(
      <ProjectSlotsCard
        project={project}
        calculatedStatus="upcoming"
        remainingSlots={{ "2099-06-14-0-0": 3, "2099-06-14-0-1": 4 }}
        renderAction={(id, past) => {
          bindings.push([id, past]);
          return <button type="button">Sign up</button>;
        }}
        renderAttendees={() => null}
      />,
    );
    expect(bindings).toEqual([
      ["2099-06-14-0-0", false],
      ["2099-06-14-0-1", false],
    ]);
    expect(html).toContain("Morning cleanup");
    expect(html).toContain("Afternoon cleanup");
    expect(html.replace(/<[^>]*>/g, "")).toContain("3 of 5 spots left");
    expect(html.match(/<li class="rounded-lg border/g)).toHaveLength(2);
    expect(html).toContain("<h2>Volunteer opportunities</h2>");
    expect(html).not.toContain("Choose a slot");
  });
  test("blank legacy times keep a readable TBD row and a disabled past action", () => {
    const legacy = {
      ...project,
      schedule: {
        multiDay: [
          {
            date: "2099-06-14",
            slots: [
              { name: "Walk-in", startTime: "", endTime: "", volunteers: 0 },
            ],
          },
        ],
      },
    };
    let pastFlag = false;
    const html = renderToStaticMarkup(
      <ProjectSlotsCard
        project={legacy}
        calculatedStatus="upcoming"
        remainingSlots={{}}
        renderAction={(_, past) => {
          pastFlag = past;
          return action({ isPast: past, isFull: true });
        }}
        renderAttendees={() => null}
      />,
    );
    expect(pastFlag).toBe(true);
    expect(html).toContain("TBD");
    expect(html).toContain("Time passed");
    expect(html).toContain("disabled");
  });
  test("Project Details remains a named card with coordinator and requirements", () => {
    const html = renderToStaticMarkup(
      <ProjectDetailsAside
        project={project}
        creator={null}
        eagerImage={false}
        onPreviewImage={() => {}}
      />,
    );
    expect(html).toContain("<h2>Project details</h2>");
    expect(html).toContain("Project coordinator");
    expect(html).toContain("Sign-up requirements");
    expect(html).toContain("Account required");
    expect(html).toContain("Manual check-in");
  });
});
