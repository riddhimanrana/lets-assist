import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildCsfCalendarProjections } = await import("./csf-calendar-sync");

describe("CSF calendar projections", () => {
  test("projects only published opportunities and corroborates a usable time range", () => {
    const projections = buildCsfCalendarProjections({
      opportunities: [
        {
          id: "opportunity-1",
          title: "Library sorting",
          body: "Sort donated books.",
          starts_at: "2026-09-10T17:00:00.000Z",
          ends_at: null,
          location: "Library",
          signup_url: "https://lets-assist.com/projects/example",
          status: "published",
        },
        {
          id: "opportunity-draft",
          title: "Draft",
          body: null,
          starts_at: "2026-09-11T17:00:00.000Z",
          ends_at: null,
          location: null,
          signup_url: null,
          status: "draft",
        },
      ],
      meetings: [],
      meetingSessions: [],
      deadlines: [],
    });

    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      sourceKind: "csf_opportunity",
      sourceId: "opportunity-1",
      occurrenceKey: "primary",
      event: {
        summary: "[CSF] Library sorting",
        location: "Library",
        start: { dateTime: "2026-09-10T17:00:00.000Z" },
        end: { dateTime: "2026-09-10T18:00:00.000Z" },
      },
    });
    expect(projections[0]?.event.description).toContain("https://lets-assist.com/projects/example");
  });

  test("projects active meeting sessions without leaking attendance-source coordinates", () => {
    const projections = buildCsfCalendarProjections({
      opportunities: [],
      meetings: [
        { id: "meeting-1", label: "January meeting", status: "active" },
        { id: "meeting-old", label: "Archived meeting", status: "archived" },
      ],
      meetingSessions: [
        {
          id: "session-1",
          meeting_id: "meeting-1",
          session_date: "2026-01-15",
          starts_at: null,
          location: "Library",
          status: "scheduled",
        },
        {
          id: "session-old",
          meeting_id: "meeting-old",
          session_date: "2026-01-16",
          starts_at: null,
          location: null,
          status: "scheduled",
        },
      ],
      deadlines: [],
    });

    expect(projections).toHaveLength(1);
    expect(projections[0]?.event).toMatchObject({
      summary: "[CSF] January meeting",
      start: { date: "2026-01-15" },
      end: { date: "2026-01-16" },
      location: "Library",
    });
    expect(JSON.stringify(projections[0])).not.toContain("attendance");
  });

  test("projects open deadlines as transparent events and excludes completed work", () => {
    const projections = buildCsfCalendarProjections({
      opportunities: [],
      meetings: [],
      meetingSessions: [],
      deadlines: [
        {
          id: "deadline-1",
          title: "Submit application",
          description: "Finish every required field.",
          due_at: "2026-09-20T06:59:00.000Z",
          status: "open",
          audience: "applicants",
          related_route: "/organization/dvhs-csf?tab=csf-profile",
        },
        {
          id: "deadline-done",
          title: "Done",
          description: null,
          due_at: "2026-09-01T06:59:00.000Z",
          status: "completed",
          audience: "members",
          related_route: null,
        },
      ],
    });

    expect(projections).toHaveLength(1);
    expect(projections[0]?.event).toMatchObject({
      summary: "[CSF deadline] Submit application",
      transparency: "transparent",
      start: { dateTime: "2026-09-20T06:59:00.000Z" },
      end: { dateTime: "2026-09-20T07:29:00.000Z" },
    });
    expect(projections[0]?.event.description).toContain("Open in Let's Assist");
  });

  test("drops malformed dates and unsafe external or protocol-relative links", () => {
    const projections = buildCsfCalendarProjections({
      opportunities: [{
        id: "bad-opportunity",
        title: "Bad date",
        body: null,
        starts_at: "not-a-date",
        ends_at: null,
        location: null,
        signup_url: "javascript:alert(1)",
        status: "published",
      }],
      meetings: [],
      meetingSessions: [],
      deadlines: [{
        id: "deadline-safe",
        title: "Safe route",
        description: null,
        due_at: "2026-09-20T06:59:00.000Z",
        status: "planned",
        audience: "all",
        related_route: "//external.example/path",
      }],
    });

    expect(projections).toHaveLength(1);
    expect(projections[0]?.sourceKind).toBe("csf_deadline");
    expect(projections[0]?.event.description).toBeUndefined();
  });
});
