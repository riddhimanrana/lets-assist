import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  settingsReadinessScope,
  settleSettingsReadiness,
} from "./settings-readiness.mjs";
const entries = ["invitations", "integrations"].map((section) => ({
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
      { id: "organization-settings-plugins" },
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
