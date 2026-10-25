import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { OrganizationPluginAdminSetting } from "@/types";

import type { PluginRowActions } from "./organization-plugin-helpers";
import {
  AvailablePluginRow,
  InstalledPluginRow,
} from "./OrganizationPluginRows";

const actions: PluginRowActions = {
  updatingActionId: null,
  onToggle: () => {},
  onRequestAction: () => {},
  onRequestDataDeletion: () => {},
  onUpdate: () => {},
  handleApplicationRuntime: () => {},
  onConfigure: () => {},
};

const plugin = {
  key: "fictional-plugin",
  name: "Fictional plugin",
  description: "Does fictional things.",
  detailedDescription: "Does fictional things in detail.",
  ownerName: "Fictional owner",
  ownerType: "platform-official",
  capabilityHighlights: [],
  dataAccess: [],
  dataAccessPurposes: [],
  visibility: "public",
  navLabel: "Fictional",
  version: "1.0.0",
  minimumRole: "member",
  availableInRuntime: true,
  entitled: true,
  isForced: false,
  installed: true,
  enabled: true,
  blockedReason: null,
  latestVersion: "1.1.0",
  installedVersion: "1.0.0",
  forceUpdateVersion: null,
  updateAvailable: true,
  updateDeployedInRuntime: true,
  forceUpdateRequired: false,
  codeRepository: null,
  codeReference: null,
  privateCodebase: false,
  lastUpdatedAt: null,
  configuration: null,
  configSchema: null,
  requiredScopes: ["members:read"],
  dataDeletionAvailable: false,
  dataDeletionExternalSystemsNotCovered: [],
  applicationRuntime: null,
} as unknown as OrganizationPluginAdminSetting;

test("an installed plugin row exposes the enable switch, configure, update and the overflow menu", () => {
  const html = renderToStaticMarkup(
    <InstalledPluginRow plugin={plugin} actions={actions} />,
  );
  expect(html).toContain("Fictional plugin");
  expect(html).toContain('aria-label="Disable Fictional plugin"');
  expect(html).toContain('role="switch"');
  expect(html).toContain("Configure");
  expect(html).toContain("Update");
  expect(html).toContain('aria-label="More actions for Fictional plugin"');
});

test("a forced plugin cannot be switched off from its row", () => {
  const html = renderToStaticMarkup(
    <InstalledPluginRow
      plugin={{ ...plugin, isForced: true }}
      actions={actions}
    />,
  );
  expect(html).toContain("Forced");
  expect(html).toMatch(/role="switch"[^>]*(data-disabled|disabled)/u);
});

test("an available plugin row offers install and counts its permissions", () => {
  const html = renderToStaticMarkup(
    <AvailablePluginRow
      plugin={{ ...plugin, installed: false, enabled: false }}
      actions={actions}
    />,
  );
  expect(html).toContain("Install");
  expect(html).toContain("1 permission");
  expect(html).not.toContain("Delete retained data");
});
