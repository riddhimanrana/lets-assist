import { describe, expect, test } from "bun:test";

import { SETTINGS_SECTIONS, resolveSettingsSection } from "./settings-sections";

describe("organization settings sections", () => {
  test("every listed section resolves to itself", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(resolveSettingsSection(section.value)).toBe(section.value);
    }
  });

  test("the Google OAuth return sections open Integrations", () => {
    // lib/auth/google-oauth-return-routes.ts sends admins back to these two
    // values, and the calendar and sheets cards read them to show the result.
    expect(resolveSettingsSection("calendar")).toBe("integrations");
    expect(resolveSettingsSection("sheets")).toBe("integrations");
  });

  test("a missing or unknown section falls back to General", () => {
    expect(resolveSettingsSection(null)).toBe("general");
    expect(resolveSettingsSection(undefined)).toBe("general");
    expect(resolveSettingsSection("")).toBe("general");
    expect(resolveSettingsSection("not-a-section")).toBe("general");
  });
});
