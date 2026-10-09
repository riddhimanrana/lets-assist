import { expect, test } from "bun:test";
import { buildPluginConfigFields } from "./plugin-config-fields";

test("organization settings map editable types without exposing retired controls", () => {
  expect(buildPluginConfigFields(undefined)).toEqual([]);
  expect(buildPluginConfigFields(null)).toEqual([]);
  const properties = {
    club_name: { type: "string" as const },
    notes: { type: "string" as const, format: "textarea", title: "Club notes" },
    long_description: { type: "string" as const, maxLength: 181 },
    enabled: { type: "boolean" as const },
    count: { type: "integer" as const },
    ratio: { type: "number" as const },
    choice: { type: "string" as const, enum: ["one", "two"] },
    metadata: { type: "object" as const },
    legacy_enabled: { type: "boolean" as const, format: "retired" },
  };
  const fields = buildPluginConfigFields({
    type: "object",
    properties,
    required: ["club_name"],
  });
  expect(fields.map(({ key, kind }) => [key, kind])).toEqual([
    ["club_name", "text"],
    ["notes", "textarea"],
    ["long_description", "textarea"],
    ["enabled", "boolean"],
    ["count", "number"],
    ["ratio", "number"],
    ["choice", "enum"],
    ["metadata", "unsupported"],
  ]);
  expect(fields[0]).toEqual({
    key: "club_name",
    kind: "text",
    label: "Club name",
    required: true,
    property: properties.club_name,
  });
  expect(fields[1].label).toBe("Club notes");
  expect(fields.slice(1).every((field) => !field.required)).toBe(true);
});
