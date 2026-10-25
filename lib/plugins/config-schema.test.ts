import { expect, test } from "bun:test";
import { editableConfigProperties } from "./config-fields";
import {
  applyConfigDefaults,
  generateConfigFormFields,
  validatePluginConfig,
  type PluginConfigSchema,
} from "./config-schema";

const schema: PluginConfigSchema = {
  type: "object",
  properties: {
    label: { type: "string", default: "Club" },
    legacy_enabled: { type: "boolean", format: "retired", default: true },
  },
  additionalProperties: false,
};

test("retired settings stay typed and readable without returning controls or defaults", () => {
  expect(editableConfigProperties(schema).map(([key]) => key)).toEqual([
    "label",
  ]);
  expect(generateConfigFormFields(schema).map((field) => field.key)).toEqual([
    "label",
  ]);
  expect(applyConfigDefaults({}, schema)).toEqual({ label: "Club" });
  expect(applyConfigDefaults({ legacy_enabled: false }, schema)).toEqual({
    label: "Club",
    legacy_enabled: false,
  });
  expect(validatePluginConfig({ legacy_enabled: false }, schema).valid).toBe(
    true,
  );
  expect(validatePluginConfig({ legacy_enabled: "true" }, schema).valid).toBe(
    false,
  );
  expect(validatePluginConfig({ unknown_enabled: true }, schema).valid).toBe(
    false,
  );
});
