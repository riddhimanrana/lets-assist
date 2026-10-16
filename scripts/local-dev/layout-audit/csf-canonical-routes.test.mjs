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
    assert.deepEqual(scene.expectedRoutes, [scene.route]);
  }
});

test("canonical CSF overview still requires both loaded headings", () => {
  const overview = captures.find((capture) => capture.id === "csf-overview");
  assert.deepEqual(overview.ready, [
    { role: "heading", name: "Home" },
    { role: "heading", name: "Your tasks" },
  ]);
  assert.equal(overview.actorKey, "csfAdmin");
});
