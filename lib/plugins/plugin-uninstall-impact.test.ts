import { describe, expect, test } from "bun:test";

import { describePluginUninstallImpact } from "./plugin-uninstall-impact";

describe("describePluginUninstallImpact", () => {
  test("asserts the true contract shape: workflows stop, settings removed, data retained", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: [],
    });

    expect(impact.workflowsStop).toBe(true);
    expect(impact.settingsRemoved).toBe(true);
    expect(impact.dataRetained).toBe(true);
  });

  test("never claims plugin_data is deleted or erasable from this screen", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: [],
    });

    expect(impact.summary).not.toMatch(/data.{0,40}(deleted|erased|removed)/i);
    expect(impact.summary).toMatch(/not deleted/i);
    expect(impact.summary).toMatch(/no self-service way/i);
  });

  test("states settings removal is real and irreversible", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: [],
    });

    expect(impact.summary).toMatch(/removes its saved settings/i);
    expect(impact.summary).toMatch(/cannot be undone/i);
  });

  test("names declared data-access purposes when present", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: ["season tracking", "member profile extensions"],
    });

    expect(impact.summary).toContain("season tracking");
    expect(impact.summary).toContain("member profile extensions");
    expect(impact.dataCategories).toEqual([
      "season tracking",
      "member profile extensions",
    ]);
    expect(impact.totalDataCategoryCount).toBe(2);
    expect(impact.additionalDataCategoryCount).toBe(0);
  });

  test("stays truthful with no declared data access, without implying there is none", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: [],
    });

    expect(impact.summary).toMatch(/any data it already stored/i);
    expect(impact.dataCategories).toEqual([]);
    expect(impact.totalDataCategoryCount).toBe(0);
  });

  test("deduplicates repeated purposes instead of counting them twice", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: [
        "season tracking",
        "season tracking",
        "member profile extensions",
      ],
    });

    expect(impact.totalDataCategoryCount).toBe(2);
    expect(impact.dataCategories).toEqual([
      "season tracking",
      "member profile extensions",
    ]);
  });

  test("ignores blank/whitespace-only purposes", () => {
    const impact = describePluginUninstallImpact({
      pluginName: "Example Plugin",
      dataAccessPurposes: ["", "   ", "season tracking"],
    });

    expect(impact.totalDataCategoryCount).toBe(1);
    expect(impact.dataCategories).toEqual(["season tracking"]);
  });

  describe("bounded output for a plugin with many declared data-access relations", () => {
    // Mirrors DVHS CSF's actual manifest shape: 40+ distinct dataAccess
    // declarations, each naming an internal plugin_data schema/relation
    // that must never reach this UI copy, only its human `purpose`.
    const RELATION_COUNT = 46;
    const manyRelations = Array.from(
      { length: RELATION_COUNT },
      (_, index) => ({
        schema: "plugin_data",
        relation: `csf_internal_relation_${index}`,
        purpose: `chapter operations category ${index}`,
      }),
    );
    const dataAccessPurposes = manyRelations.map((entry) => entry.purpose);

    test("summary stays bounded no matter how many relations are declared", () => {
      const impact = describePluginUninstallImpact({
        pluginName: "DVHS CSF",
        dataAccessPurposes,
      });

      // The pre-fix bug produced a ~7,214-character dialog string and a
      // ~4,966-character toast string for this exact shape. Bound the
      // summary far below either regardless of how many relations exist.
      expect(impact.summary.length).toBeLessThan(1000);
      expect(impact.totalDataCategoryCount).toBe(RELATION_COUNT);
    });

    test("summary never leaks internal schema or relation names", () => {
      const impact = describePluginUninstallImpact({
        pluginName: "DVHS CSF",
        dataAccessPurposes,
      });

      expect(impact.summary).not.toContain("plugin_data");
      for (const entry of manyRelations) {
        expect(impact.summary).not.toContain(entry.relation);
      }
    });

    test("disclosure category list is bounded and leak-free", () => {
      const impact = describePluginUninstallImpact({
        pluginName: "DVHS CSF",
        dataAccessPurposes,
      });

      expect(impact.dataCategories.length).toBeLessThanOrEqual(20);
      expect(impact.additionalDataCategoryCount).toBe(
        RELATION_COUNT - impact.dataCategories.length,
      );
      for (const category of impact.dataCategories) {
        expect(category).not.toContain("plugin_data");
      }
    });

    test("an individual pathologically long purpose is truncated, not passed through raw", () => {
      const longPurpose = "x".repeat(5000);
      const impact = describePluginUninstallImpact({
        pluginName: "DVHS CSF",
        dataAccessPurposes: [longPurpose],
      });

      expect(impact.summary.length).toBeLessThan(1000);
      expect(impact.dataCategories[0]?.length).toBeLessThanOrEqual(100);
    });
  });
});
