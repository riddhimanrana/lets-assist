import { expect, test } from "bun:test";

import {
  buildWaiverEvidencePath,
  isProjectWaiverEvidencePath,
} from "./evidence-path";

const PROJECT = "10000000-0000-4000-8000-000000000020";
const OTHER = "20000000-0000-4000-8000-000000000099";
const KEY = "3d6a1cd5-60a6-4a61-8b13-06a4402fe143";
const FILE = "9f0e1d2c-3b4a-4c5d-8e6f-708192a3b4c5";

test("accepts every shape the sign-up flow writes for this project", () => {
  for (const path of [
    `waiver_${KEY}_volunteer_1760000000000.png`,
    `waiver_${KEY}_parent_guardian_1760000000000.jpg`,
    `signatures/${PROJECT}/${KEY}/${FILE}.png`,
    `signed-waivers/${PROJECT}/${KEY}/${FILE}.pdf`,
    `cloned-waiver-evidence/${PROJECT}/${KEY}/${FILE}.jpg`,
  ]) {
    expect(isProjectWaiverEvidencePath(path, PROJECT)).toBe(true);
  }
});

test("refuses another project's evidence and anything that is not evidence", () => {
  for (const path of [
    `signatures/${OTHER}/${KEY}/${FILE}.png`,
    `signed-waivers/${OTHER}/${KEY}/${FILE}.pdf`,
    `signatures/${PROJECT}/../${OTHER}/${KEY}/${FILE}.png`,
    `/signatures/${PROJECT}/${KEY}/${FILE}.png`,
    `project_waivers/${PROJECT}/${FILE}.pdf`,
    "waiver_guess_volunteer_1.png",
    "someone-else.png",
    "",
  ]) {
    expect(isProjectWaiverEvidencePath(path, PROJECT)).toBe(false);
  }
  expect(isProjectWaiverEvidencePath(null, PROJECT)).toBe(false);
  expect(
    isProjectWaiverEvidencePath(
      `signatures/${PROJECT}/${KEY}/${FILE}.png`,
      null,
    ),
  ).toBe(false);
});

test("every path the builder writes is accepted for its own project only", () => {
  for (const folder of [
    "signatures",
    "signed-waivers",
    "cloned-waiver-evidence",
  ] as const) {
    for (const extension of ["png", "jpg", "pdf"]) {
      const path = buildWaiverEvidencePath({
        folder,
        projectId: PROJECT,
        evidenceKey: KEY,
        extension,
      });
      expect(isProjectWaiverEvidencePath(path, PROJECT)).toBe(true);
      expect(isProjectWaiverEvidencePath(path, OTHER)).toBe(false);
    }
  }
});

test("the builder refuses ids and file types that would escape the folder", () => {
  const base = {
    folder: "signatures",
    evidenceKey: KEY,
    extension: "png",
  } as const;
  expect(() =>
    buildWaiverEvidencePath({ ...base, projectId: "../other" }),
  ).toThrow();
  expect(() =>
    buildWaiverEvidencePath({
      ...base,
      projectId: PROJECT,
      evidenceKey: "a/b",
    }),
  ).toThrow();
  expect(() =>
    buildWaiverEvidencePath({ ...base, projectId: PROJECT, extension: "p/ng" }),
  ).toThrow();
});

test("an older signer image with an unusual role key still loads", () => {
  expect(
    isProjectWaiverEvidencePath(
      `waiver_${KEY}_Parent or guardian (1)_1760000000000.png`,
      PROJECT,
    ),
  ).toBe(true);
});
