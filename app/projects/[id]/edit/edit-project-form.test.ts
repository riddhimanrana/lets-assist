import { expect, test } from "bun:test";
import type { Project } from "@/types";
import {
  getProjectEditFormDefaults,
  hasProjectEditFormChanges,
  type FormValues,
} from "./edit-project-form";

const project = {
  title: "Fictional project",
  description: "Fictional project description",
  location: "Fictional community center",
  require_login: false,
  verification_method: "manual",
  visibility: "public",
} as Project;

test("missing legacy metadata and forced backup upload defaults start pristine", () => {
  for (const row of [
    project,
    { ...project, waiver_allow_upload: false },
    { ...project, waiver_allow_upload: true },
  ]) {
    const values = getProjectEditFormDefaults(row);
    expect(values.location_data).toEqual({
      text: row.location,
      display_name: row.location,
    });
    expect(values.waiver_allow_upload).toBe(true);
    expect(hasProjectEditFormChanges(values, row)).toBe(false);
  }
});

test("preserves saved location and explicit booleans without marking changes", () => {
  const row = {
    ...project,
    location_data: {
      text: "Fictional map result",
      display_name: "Fictional community center",
      coordinates: { latitude: 0, longitude: 0 },
    },
    require_login: true,
    enable_volunteer_comments: true,
    show_attendees_publicly: true,
    waiver_required: true,
    waiver_disable_esignature: true,
  };
  const values = getProjectEditFormDefaults(row);
  expect(values.location_data).toEqual(row.location_data);
  expect(hasProjectEditFormChanges(values, row)).toBe(false);
});

test("real field changes become dirty and reverting restores the pristine state", () => {
  const initial = getProjectEditFormDefaults(project);
  const changes: Partial<FormValues>[] = [
    { title: "Changed title" },
    { description: "Changed description" },
    { location: "Changed location" },
    { location_data: { text: "Changed map result" } },
    { require_login: true },
    { enable_volunteer_comments: true },
    { show_attendees_publicly: true },
    { waiver_required: true },
    { waiver_allow_upload: false },
    { waiver_disable_esignature: true },
    { verification_method: "qr-code" },
    { visibility: "unlisted" },
  ];
  for (const change of changes) {
    expect(hasProjectEditFormChanges({ ...initial, ...change }, project)).toBe(
      true,
    );
    expect(hasProjectEditFormChanges({ ...initial }, project)).toBe(false);
  }
});
