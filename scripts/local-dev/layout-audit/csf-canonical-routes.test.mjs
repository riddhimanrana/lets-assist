import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const captures = JSON.parse(
  fs.readFileSync(
    new URL("./upstream/manifest.baseline-template.json", import.meta.url),
  ),
).captures;

const canonicalTabs = {
  "csf-overview": "csf-overview",
  "csf-home": "csf-home",
  "csf-my-profile": "csf-profile",
  "csf-profiles": "csf-members",
  "csf-cohorts": "csf-cohorts",
  "csf-terms": "csf-terms",
  "csf-meetings": "csf-activities&csf_service=meetings",
  "csf-applications": "csf-applications",
  "csf-opportunities": "csf-activities&csf_service=opportunities",
  "csf-partner-clubs": "csf-activities&csf_service=partner-clubs",
  "csf-submissions": "csf-submissions",
  "csf-points": "csf-activities&csf_service=points",
  "csf-verification": "csf-activities&csf_service=verification",
  "csf-sheets": "csf-cohorts",
  "csf-staff": "csf-staff",
  "csf-audit": "csf-audit",
  "csf-communications": "csf-communications",
  "csf-settings": "csf-settings",
  "csf-help": "csf-help",
};

test("private CSF scenes capture the canonical organization tabs", () => {
  const privateScenes = captures.filter(
    (capture) => capture.group === "private-candidate",
  );
  assert.equal(privateScenes.length, Object.keys(canonicalTabs).length + 2);
  for (const [id, query] of Object.entries(canonicalTabs)) {
    const scene = privateScenes.find((capture) => capture.id === id);
    const route = `/organization/dvhs-csf?tab=${query}`;
    assert(scene, `Missing ${id} scene`);
    assert.equal(scene.route, route);
    assert.deepEqual(scene.expectedRoutes, [route]);
    assert(scene.actorKey);
    assert(scene.ready.length > 0);
    assert.equal(
      new URL(route, "http://127.0.0.1:3000").pathname,
      "/organization/dvhs-csf",
    );
  }
  for (const id of ["csf-public", "csf-connect"]) {
    const scene = privateScenes.find((capture) => capture.id === id);
    assert(scene);
    assert.equal(
      scene.route,
      `/organization/dvhs-csf/plugins/dvhs-csf/${id.slice(4)}`,
    );
    assert.deepEqual(
      scene.expectedRoutes,
      id === "csf-connect"
        ? [scene.route, `${scene.route}?connected=1`]
        : [scene.route],
    );
  }
});

test("canonical CSF overview requires the loaded officer tasks interior", () => {
  const overview = captures.find((capture) => capture.id === "csf-overview");
  assert.deepEqual(overview.ready, [
    { selector: 'section[data-tour-id="csf-officer-tasks"]' },
    { role: "heading", name: "Your tasks" },
  ]);
  assert.equal(overview.actorKey, "csfAdmin");
});

test("Connect captures only the verified fixture's linked terminal state", () => {
  const connect = captures.find((capture) => capture.id === "csf-connect");
  assert.equal(connect.actorKey, "csfApplicant");
  assert.deepEqual(connect.ready, [
    { role: "heading", name: "Your CSF record is linked" },
    { role: "button", name: "Go to My CSF" },
  ]);
});

// Cached organization tabs retain inert markup with duplicate section IDs.
// Accessible roles select the open roster; Base UI gives the import anchor
// button semantics even though its navigation target is a Link.
test("review scenes require accessible loaded roster controls", () => {
  const applications = captures.find(
    (capture) => capture.id === "csf-applications",
  );
  assert.deepEqual(applications.ready, [
    { role: "textbox", name: "Search by name" },
    { role: "button", name: "Link Google Sheet" },
  ]);
  const verification = captures.find(
    (capture) => capture.id === "csf-verification",
  );
  assert.deepEqual(verification.ready, [
    { role: "textbox", name: "Search by name" },
  ]);
  for (const scene of [applications, verification]) {
    assert.equal(scene.actorKey, "csfAdmin");
    assert.equal(scene.group, "private-candidate");
  }
});

test("Help requires the loaded member guide and its accessible replay button", () => {
  const help = captures.find((capture) => capture.id === "csf-help");
  assert.deepEqual(help.ready, [
    { role: "textbox", name: "Search CSF help" },
    { text: "Member guide" },
    { role: "button", name: "Replay tour" },
  ]);
});

test("CSF Settings requires loaded disconnected content and only its three initial reads", () => {
  const settings = captures.find((c) => c.id === "csf-settings");
  assert.deepEqual(settings.readActions, [
    "getCsfSheetsConnectionStatusAction",
    "getCsfSheetSyncWorkspaceAction",
    "getCsfSheetSemesterLedgerWorklistAction",
  ]);
  assert(
    settings.ready.some(
      (r) => r.role === "region" && r.name === "Google Drive connection",
    ),
  );
  assert(settings.ready.every((r) => r.role));
});
