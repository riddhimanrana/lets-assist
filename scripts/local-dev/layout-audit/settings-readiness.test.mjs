import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  settingsReadinessScope,
  settleSettingsReadiness,
} from "./settings-readiness.mjs";
const entries = ["invitations", "integrations", "plugins"].map((section) => ({
  id: "organization-settings-" + section,
  actorKey: "developer",
  route: "/organization/local-platform-org/settings?section=" + section,
  expectedRoutes: [
    "/organization/local-platform-org/settings?section=" + section,
  ],
}));
test("only exact reviewed settings scenes get this bounded readiness wait", () => {
  for (const entry of entries) {
    assert.equal(settingsReadinessScope(entry), true);
    for (const changed of [
      { actorKey: "csfMember" },
      { route: entry.route + "&other=1" },
      { id: "organization-settings-danger" },
      { expectedRoutes: ["/organization/other/settings"] },
    ])
      assert.equal(settingsReadinessScope({ ...entry, ...changed }), false);
  }
});
test("visible skeleton, busy and status markers cannot be photographed as settled", async () => {
  let shown = true,
    checks = 0;
  const marker = { getClientRects: () => (shown ? [{}] : []) },
    context = vm.createContext({
      document: {
        querySelectorAll(selector) {
          assert.equal(
            selector,
            '[aria-busy="true"],[data-slot="skeleton"],[role="status"][aria-label^="Loading "]',
          );
          return [marker];
        },
      },
      getComputedStyle: () => ({
        visibility: "visible",
        display: "block",
        opacity: "1",
      }),
    });
  const page = {
    async waitForFunction(fn, args, options) {
      assert.equal(options.timeout, 12000);
      assert.equal(vm.runInContext("(" + fn + ")()", context), false);
      checks++;
      shown = false;
      assert.equal(vm.runInContext("(" + fn + ")()", context), true);
      checks++;
    },
  };
  assert.deepEqual(await settleSettingsReadiness(page, entries[0]), {
    loadingMarkers: 0,
    boundedWaitMs: 12000,
  });
  assert.equal(checks, 2);
});
test("an unresolved load remains a failure instead of a partial acceptance", async () => {
  await assert.rejects(
    settleSettingsReadiness(
      {
        waitForFunction: async () => {
          throw Error("loading did not finish");
        },
      },
      entries[1],
    ),
  );
});

const csfSettings = {
  id: "csf-settings",
  actorKey: "csfAdmin",
  route: "/organization/dvhs-csf?tab=csf-settings",
  expectedRoutes: ["/organization/dvhs-csf?tab=csf-settings"],
};
test("CSF readiness admits only the canonical administrator scene", () => {
  assert.equal(settingsReadinessScope(csfSettings), true);
  assert.equal(
    settingsReadinessScope({ ...csfSettings, actorKey: "developer" }),
    false,
  );
  assert.equal(
    settingsReadinessScope({
      ...csfSettings,
      route: csfSettings.route + "&other=1",
    }),
    false,
  );
});
test("a disconnected CSF label with a visible status error never settles", async () => {
  const marker = { getClientRects: () => [{}] };
  const context = vm.createContext({
    document: {
      querySelectorAll(selector) {
        assert(
          selector.includes(
            'section[aria-label="Google Drive connection"] [role="alert"]',
          ),
        );
        return [marker];
      },
    },
    getComputedStyle: () => ({
      visibility: "visible",
      display: "block",
      opacity: "1",
    }),
  });
  await assert.rejects(
    settleSettingsReadiness(
      {
        waitForFunction: async (fn, args, options) => {
          assert.equal(args, true);
          assert.equal(options.timeout, 12000);
          assert.equal(vm.runInContext("(" + fn + ")(true)", context), false);
          throw Error("still has a connection error");
        },
      },
      csfSettings,
    ),
  );
});

test("loaded CSF text is checked inside only the accessible tab panel", async () => {
  const reads = [];
  const panel = {
    getByRole(role, options) {
      assert.equal(role, "region");
      assert.equal(options.exact, true);
      return {
        getByText(text, textOptions) {
          assert.equal(textOptions.exact, true);
          reads.push({ region: options.name, text });
          return {
            waitFor: async (options) =>
              assert.deepEqual(options, { state: "visible", timeout: 12000 }),
          };
        },
      };
    },
  };
  const page = {
    waitForFunction: async () => {},
    getByRole(role) {
      assert.equal(role, "tabpanel");
      return panel;
    },
  };
  await settleSettingsReadiness(page, csfSettings);
  assert.deepEqual(
    reads.map((r) => r.region),
    ["Google Drive connection", "Sheet sync"],
  );
  assert(reads[0].text.startsWith("Connect Google"));
  assert(reads[1].text.startsWith("No export destinations configured."));
});
