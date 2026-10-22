import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const cases = [
  {
    zone: "UTC",
    stamp: "2026-10-18T02:00:00Z",
    moderationTime: "2:00AM",
    localDay: "Oct 18, 2026",
    pickerDay: "10/18/2026",
    localTime: "2:00AM",
    endTime: "3:00AM",
  },
  {
    zone: "America/Los_Angeles",
    stamp: "2026-10-18T02:00:00Z",
    moderationTime: "2:00AM",
    localDay: "Oct 17, 2026",
    pickerDay: "10/17/2026",
    localTime: "7:00PM",
    endTime: "8:00PM",
  },
  {
    zone: "Asia/Tokyo",
    stamp: "2026-10-18T23:30:00Z",
    moderationTime: "11:30PM",
    localDay: "Oct 19, 2026",
    pickerDay: "10/19/2026",
    localTime: "8:30AM",
    endTime: "9:30AM",
  },
];

for (const entry of cases) {
  for (const ready of [false, true]) {
    test(`timestamp labels in ${entry.zone}, ${ready ? "client ready" : "server snapshot"}`, () => {
      const result = spawnSync(
        process.execPath,
        [
          "--no-env-file",
          "--eval",
          `
        import { mock } from "bun:test";
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        const unexpected = () => { throw new Error("Rendering must not invoke an action or network call"); };
        mock.module("next/navigation", () => ({ useRouter: () => ({ refresh: unexpected }), usePathname: () => "/fixture", useSearchParams: () => new URLSearchParams() }));
        mock.module("@/app/projects/create/actions", () => ({ deleteDraft: unexpected, publishDraft: unexpected }));
        mock.module("@/app/organization/[id]/moderation/actions", () => ({ getOrgFlaggedContent: unexpected }));
        mock.module("@/lib/supabase/client", () => ({ createClient: unexpected }));
        ${ready ? 'mock.module("@/hooks/useHydrated", () => ({ useHydrated: () => true }));' : ""}
        const stamp = ${JSON.stringify(entry.stamp)};
        const text = (node) => renderToStaticMarkup(node).replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, "").replace(/\\s+/g, " ");
        const short = (s) => s.match(/(?:Oct|Nov) [0-9]{1,2}, 2026/g) ?? [];
        const times = (s) => [...s.matchAll(/([0-9]{1,2}):([0-9]{2})\\s*([AP]M)/g)].map((m) => Number(m[1]) + ":" + m[2] + m[3]);
        const { default: DraftsClient } = await import("./app/projects/drafts/DraftsClient");
        const { FeedbackClient } = await import("./app/projects/[id]/feedback/FeedbackClient");
        const { buildMemberColumns } = await import("./app/organization/[id]/members-columns");
        const { default: OrgModerationDashboard } = await import("./app/organization/[id]/moderation/OrgModerationDashboard");
        const { CalendarConnectionSection } = await import("./app/account/calendar/CalendarConnectionSection");
        const { SyncedEventsSection } = await import("./app/account/calendar/SyncedEventsSection");
        const { DateTimePicker } = await import("./components/ui/date-time-picker");
        const { FeedbackQueue } = await import("./app/admin/components/FeedbackQueue");
        const queue = () => text(createElement(FeedbackQueue, { filteredFeedback: [{ id: "fictional-feedback", title: "Fictional feedback", feedback: "Fictional text", section: "other", email: "fixture@example.test", created_at: stamp }, { id: "fictional-invalid", title: "Fictional invalid date", feedback: "Fictional text", section: "other", email: "fixture@example.test", created_at: "invalid" }], selectedId: null, setSelectedId: unexpected, selectedIndex: -1, selectByOffset: unexpected, getModerationStatus: () => "pending" }));
        Date.now = () => Date.parse(stamp) + 65_000;
        const firstQueue = queue();
        Date.now = () => Date.parse(stamp) + 125_000;
        const laterQueue = queue();
        const member = { id: "fictional-membership", user_id: "fictional-user", joined_at: stamp, role: "member" };
        const columns = buildMemberColumns({ viewerRole: "admin", currentUserId: "fictional-admin", canViewHours: true, showDirectory: true, memberHours: {}, loadingHours: false, directory: { [member.id]: { email: "fixture@example.test", status: "active", lastActivityAt: stamp } }, loadingDirectory: false, processingMember: null, onViewHours: unexpected, onUpdateRole: unexpected, onRemove: unexpected });
        const cell = (key) => text(columns.find((c) => c.id === key || c.accessorKey === key).cell({ row: { original: member, id: member.id } }));
        const moderation = text(createElement(OrgModerationDashboard, { organizationId: "fictional-org", initialStats: { total: 1, pending: 1, blocked: 0, critical: 0, recentWeek: 1 }, initialFlagged: [{ id: "fictional-flag", content_type: "project", severity: "low", created_at: stamp, reason: "Fictional reason" }] }));
        const events = text(createElement(SyncedEventsSection, { creatorEvents: [{ key: "fictional-timed", projectId: "fictional-project", title: "Fictional timed event", start: stamp, end: new Date(Date.parse(stamp) + 3600000).toISOString(), location: null, syncedAt: stamp }, { key: "fictional-all-day", projectId: "fictional-project", title: "Fictional all-day event", start: "2026-10-18", end: null, location: null, syncedAt: null }], volunteerEvents: [], removing: false, onRemove: unexpected }));
        const picker = text(createElement(DateTimePicker, { value: new Date(stamp), onChange: unexpected }));
        process.stdout.write(JSON.stringify({
          drafts: short(text(createElement(DraftsClient, { drafts: [{ id: "fictional-draft", title: "Fictional draft", description: "Fictional description", location: "Fictional place", event_type: "oneTime", schedule: { oneTime: { date: "2026-11-18", startTime: "11:00", endTime: "12:00", volunteers: 5 } }, cover_image_url: null, created_at: stamp, workflow_status: "draft", organization: null }] }))),
          feedback: short(text(createElement(FeedbackClient, { projectId: "fictional-project", projectTitle: "Fictional project", summary: { count: 1, average: 4, distribution: { 1:0, 2:0, 3:0, 4:1, 5:0 }, attendeeCount: 1 }, entries: [{ id: "fictional-feedback", rating: 4, comment: "Fictional comment", commentModerationStatus: "allowed", volunteerName: "Fictional volunteer", submittedVia: "web", createdAt: stamp, updatedAt: stamp }] }))),
          joined: short(cell("joined_at")), lastActivity: short(cell("last_activity")),
          moderationDates: short(moderation), moderationTimes: times(moderation),
          connected: text(createElement(CalendarConnectionSection, { connection: { calendar_email: "fixture@example.test", created_at: stamp }, legacyReconnectRequired: false, isDisconnecting: false, onConnect: unexpected, onDisconnect: unexpected })).match(/October [0-9]{1,2}, 2026/g) ?? [],
          eventDates: short(events), eventTimes: times(events),
          pickerDates: picker.match(/[0-9]{2}\\/[0-9]{2}\\/2026/g) ?? [], pickerTimes: times(picker),
          pickerPlaceholder: picker.includes("MM/DD/YYYY hh:mm aa"),
          queueDates: [short(firstQueue), short(laterQueue)],
          queueRelative: [firstQueue, laterQueue].map((s) => s.match(/[0-9]+ minutes? ago/g) ?? []),
          invalidQueueDate: [firstQueue, laterQueue].every((s) => s.includes("Unknown date")),
        }));
      `,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 15_000,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            LANG: "en_US.UTF-8",
            TZ: entry.zone,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        drafts: ["Nov 18, 2026", "Oct 18, 2026"],
        feedback: ["Oct 18, 2026"],
        joined: ["Oct 18, 2026"],
        lastActivity: ["Oct 18, 2026"],
        moderationDates: ["Oct 18, 2026"],
        moderationTimes: [entry.moderationTime],
        connected: ["October 18, 2026"],
        eventDates: ready
          ? [entry.localDay, entry.localDay, entry.localDay, "Oct 18, 2026"]
          : ["Oct 18, 2026"],
        eventTimes: ready
          ? [entry.localTime, entry.endTime, entry.localTime]
          : [],
        pickerDates: ready ? [entry.pickerDay] : [],
        pickerTimes: ready ? [entry.localTime] : [],
        pickerPlaceholder: !ready,
        queueDates: ready ? [[], []] : [["Oct 18, 2026"], ["Oct 18, 2026"]],
        queueRelative: ready ? [["1 minute ago"], ["2 minutes ago"]] : [[], []],
        invalidQueueDate: true,
      });
    }, 20_000);
  }
}
