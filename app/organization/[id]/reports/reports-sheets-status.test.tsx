import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReportsSheetsStatus } from "./ReportsSheetsStatus";
import type { SheetSyncStatus } from "./sheets-actions";

const settingsHref = "/organization/fictional-org/settings?section=sheets";

const configured: SheetSyncStatus = {
  connected: true,
  connectedEmail: "owner@example.com",
  scopesOk: true,
  viewerIsOwner: true,
  syncConfig: {
    sheetId: "sheet-1",
    sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1",
    sheetTitle: "Fictional hours",
    tabName: "Member Hours",
    reportType: "member-hours",
    autoSync: true,
    syncIntervalMinutes: 1440,
    lastSyncedAt: null,
  },
};

function render(sheetStatus: SheetSyncStatus | null, isAdmin: boolean) {
  return renderToStaticMarkup(
    <ReportsSheetsStatus
      organizationId="org-1"
      sheetStatus={sheetStatus}
      isAdmin={isAdmin}
      settingsHref={settingsHref}
      syncing={false}
      onSyncNow={() => {}}
      onChanged={() => {}}
    />,
  );
}

test("admins get sync now and a link to the settings that own configuration", () => {
  const html = render(configured, true);
  expect(html).toContain("Fictional hours");
  expect(html).toContain("Connected");
  expect(html).toContain("Sync now");
  expect(html).toContain(`href="${settingsHref.replaceAll("&", "&amp;")}"`);
  expect(html).toContain("Manage");
  // Configuration lives in settings only.
  expect(html).not.toContain("Destination");
  expect(html).not.toContain("Unlink");
});

test("staff see the status without any action", () => {
  const html = render(configured, false);
  expect(html).toContain("Fictional hours");
  expect(html).toContain("Auto-sync daily");
  expect(html).toContain("Managed by organization admins.");
  expect(html).not.toContain("Sync now");
  expect(html).not.toContain("Manage<");
  expect(html).not.toContain("owner@example.com");
});

test("an admin without a sync is pointed at setup in settings", () => {
  const html = render({ connected: false }, true);
  expect(html).toContain("Not set up");
  expect(html).toContain("Set up Sheets sync");
  expect(html).not.toContain("Sync now");
});

test("a broken owner connection reads as needing a reconnect and blocks sync", () => {
  const html = render({ ...configured, scopesOk: false }, true);
  expect(html).toContain("Needs reconnect");
  expect(html).toMatch(
    /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Sync now/u,
  );
});

test("the row shows a loading placeholder until the status arrives", () => {
  expect(render(null, true)).toContain(
    'aria-label="Loading Google Sheets status"',
  );
});

test("an admin who can pick is offered the picker when the owner cannot open the file", () => {
  const html = render(
    {
      ...configured,
      viewerConnected: true,
      viewerScopesOk: true,
      destinationProblem: { kind: "reselect" },
    },
    true,
  );
  expect(html).toContain("Needs attention");
  expect(html).toContain("Choose the spreadsheet again");
  expect(html).toMatch(/<button[^>]*>Choose spreadsheet<\/button>/u);
  expect(html).toMatch(
    /<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Sync now/u,
  );
});

test("an admin without their own Google connection is told to connect first", () => {
  const html = render(
    { ...configured, destinationProblem: { kind: "reselect" } },
    true,
  );
  expect(html).toContain("Connect your Google account with Sheets access");
  expect(html).not.toContain("Choose spreadsheet<");
});

test("staff are told to ask an admin and get no picker", () => {
  const html = render(
    { ...configured, destinationProblem: { kind: "reselect" } },
    false,
  );
  expect(html).toContain("Ask an organization admin to choose it again");
  expect(html).not.toContain("Choose spreadsheet<");
});

test("a missing tab names the tab and offers the tabs that exist", () => {
  const html = render(
    {
      ...configured,
      destinationProblem: {
        kind: "tab_missing",
        tabName: "Member Hours",
        tabs: ["Hours 2026", "Archive"],
      },
    },
    true,
  );
  expect(html).toContain("The tab &quot;Member Hours&quot; is missing");
  expect(html).toContain("Hours 2026");
  expect(html).toContain("Archive");
});
