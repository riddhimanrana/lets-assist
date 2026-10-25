import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const cases = [
  {
    timezone: "UTC",
    timestamp: "2026-10-18T02:00:00Z",
    time: "2:00 AM",
    seconds: "2:00:00 AM",
  },
  {
    timezone: "America/Los_Angeles",
    timestamp: "2026-10-18T02:00:00Z",
    time: "2:00 AM",
    seconds: "2:00:00 AM",
  },
  {
    timezone: "Asia/Tokyo",
    timestamp: "2026-10-18T23:30:00Z",
    time: "11:30 PM",
    seconds: "11:30:00 PM",
  },
];

for (const { timezone, timestamp, time, seconds } of cases) {
  test(`server-rendered admin timestamps retain UTC labels in ${timezone}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "--eval",
        `
      import { mock } from "bun:test";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      const unexpected = () => { throw new Error("Rendering must not invoke an action"); };
      mock.module("next/navigation", () => ({ useRouter: () => ({ refresh: unexpected }) }));
      mock.module("@/app/admin/actions", () => ({ updateTrustedMemberStatus: unexpected }));
      mock.module("@/app/admin/plugins/actions", () => ({
        upsertOrganizationPluginEntitlement: unexpected,
        bulkUpsertOrganizationPluginEntitlements: unexpected,
      }));
      mock.module("@/app/admin/system-banner/actions", () => ({
        saveSystemBanner: unexpected, deactivateSystemBannerScope: unexpected,
      }));
      mock.module("@/components/shared/ProfileHoverCard", () => ({
        ProfileHoverCard: ({ children }) => children,
      }));
      const createdAt = ${JSON.stringify(timestamp)};
      const text = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, "");
      const short = (value) => value.match(/Oct [0-9]{1,2}, 2026/g) ?? [];
      const day = (value) => value.match(/Oct [0-9]{1,2}/g) ?? [];
      const long = (value) => value.match(/October [0-9]{1,2}(?:st|nd|rd|th), 2026(?: [0-9]{1,2}:[0-9]{2} [AP]M)?/g) ?? [];
      const numeric = (value) => value.match(/[0-9]{1,2}\\/[0-9]{1,2}\\/2026/g) ?? [];
      const numericTime = (value) => value.match(/[0-9]{1,2}\\/[0-9]{1,2}\\/2026, [0-9]{1,2}:[0-9]{2}:[0-9]{2} [AP]M/g) ?? [];
      const row = { id: "fictional-row", created_at: createdAt, reason: "Fictional reason", content_type: "project", content_details: { title: "Fictional project" } };
      const { columns } = await import("./app/admin/components/trusted-members/columns");
      const { getReportColumns, getFlaggedColumns } = await import("./app/admin/moderation/columns");
      const cell = (definitions, key) => text(definitions.find((d) => d.accessorKey === key || d.id === key).cell({ row: { original: row } }));
      const { WaiverDefinitionTable } = await import("./app/admin/waivers/WaiverDefinitionTable");
      const { OverviewTab } = await import("./app/admin/components/OverviewTab");
      const { FeedbackDetail } = await import("./app/admin/components/FeedbackDetail");
      const { default: PluginAccessControls } = await import("./app/admin/plugins/PluginAccessControls");
      const { SystemBannerAdminClient } = await import("./app/admin/system-banner/SystemBannerAdminClient");
      const feedback = { id: "fictional-feedback", title: "Fictional feedback", feedback: "Fictional text", section: "other", email: "fixture@example.test", created_at: createdAt, moderation_reviewed_at: createdAt };
      const result = {
        trusted: short(cell(columns, "created_at")),
        reports: day(cell(getReportColumns(unexpected), "reason")),
        flags: long(cell(getFlaggedColumns(unexpected), "content_details")),
        waivers: short(text(createElement(WaiverDefinitionTable, { definitions: [{ id: "fictional-waiver", title: "Fictional waiver", version: 1, active: true, updated_at: createdAt }] }))),
        overview: day(text(createElement(OverviewTab, {
          stats: { feedbackCount: 0, trustedPendingCount: 0, flaggedPendingCount: 1, reportsPendingCount: 1 },
          flaggedContent: [{ id: "fictional-flag", created_at: createdAt }],
          reportPreview: [{ id: "fictional-report", reason: "Fictional report", created_at: createdAt }],
          reportsStats: { total: 1, pending: 1, resolved: 0, highPriority: 0, recentWeek: 1 },
        }))),
        feedback: long(text(createElement(FeedbackDetail, {
          filteredFeedback: [feedback], selectedFeedback: feedback, selectedIndex: 0,
          setSelectedId: unexpected, getModerationStatus: () => "pending",
          handleModeration: unexpected, handleDelete: unexpected, isActionLoading: false,
        }))),
        pluginWindow: numeric(text(createElement(PluginAccessControls, {
          selectedPluginKey: "fictional-plugin", data: {
            plugins: [{ key: "fictional-plugin", name: "Fictional plugin", visibility: "private" }],
            organizations: [{ id: "fictional-org", name: "Fictional organization" }],
            entitlements: [{ id: "fictional-entitlement", organization_id: "fictional-org", organization_name: "Fictional organization", plugin_key: "fictional-plugin", status: "active", starts_at: createdAt, ends_at: createdAt, is_forced: false }],
          },
        }))),
        banner: numericTime(text(createElement(SystemBannerAdminClient, {
          sitewideBanner: { id: "fictional-banner", title: null, message: "Fictional message", banner_type: "info", target_scope: "sitewide", is_active: false, starts_at: null, ends_at: null, cta_label: null, cta_url: null, dismissible: true, show_icon: true, text_align: "center", created_at: createdAt, updated_at: createdAt }, landingBanner: null,
        }))),
      };
      process.stdout.write(JSON.stringify(result));
    `,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 15_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          TZ: timezone,
          LANG: "en_US.UTF-8",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      trusted: ["Oct 18, 2026"],
      reports: ["Oct 18"],
      flags: ["October 18th, 2026"],
      waivers: ["Oct 18, 2026"],
      overview: ["Oct 18", "Oct 18"],
      feedback: [`October 18th, 2026 ${time}`, `October 18th, 2026 ${time}`],
      pluginWindow: ["10/18/2026", "10/18/2026"],
      banner: [`10/18/2026, ${seconds}`],
    });
  });
}
