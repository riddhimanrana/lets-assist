import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { maintenancePayload } from "./cutover-vercel.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";
import { candidate, controllerFixture } from "./cutover.fixture.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));

// The Vercel project sets its own install and build commands. Null settings
// fall back to them, so a static upload with no package.json would fail at
// install. Empty strings skip both steps.
test("the static maintenance upload skips the project's install and build", () => {
  const payload = maintenancePayload({ cwd, candidate, run: "100" });
  assert.deepEqual(payload.projectSettings, {
    framework: null,
    buildCommand: "",
    installCommand: "",
    outputDirectory: ".",
  });
  const names = payload.files.map((file) => file.file).sort();
  assert.deepEqual(names, [
    "maintenance-api.json",
    "maintenance-health.txt",
    "maintenance.html",
    "vercel.json",
  ]);
  assert.equal(names.includes("package.json"), false);
  // vercel.json documents the empty-string skip explicitly, so the uploaded
  // configuration repeats it.
  const config = JSON.parse(
    payload.files.find((file) => file.file === "vercel.json").data,
  );
  assert.equal(config.installCommand, "");
  assert.equal(config.buildCommand, "");
  assert.deepEqual(config.crons, []);
  assert.equal(payload.autoAssignCustomDomains, false);
  assert.deepEqual(payload.meta, {
    developmentCutover: "maintenance",
    developmentCandidate: candidate,
    developmentRun: "100",
  });
});

test("preparation stages the maintenance upload with install and build skipped", async () => {
  const f = controllerFixture("prepare");
  const receipt = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(receipt.phase, "prepared");
  const staged = f.state.writes.filter(
    (row) =>
      row.path === "/v13/deployments" &&
      row.body?.meta?.developmentCutover === "maintenance",
  );
  assert.equal(staged.length, 1);
  assert.equal(staged[0].body.projectSettings.installCommand, "");
  assert.equal(staged[0].body.projectSettings.buildCommand, "");
  assert.equal(staged[0].body.projectSettings.framework, null);
});
