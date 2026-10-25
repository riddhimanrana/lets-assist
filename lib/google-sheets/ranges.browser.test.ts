import { expect, test } from "bun:test";

test("spreadsheet range helpers bundle for the browser without provider or logging code", async () => {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/ranges.ts"],
    target: "browser",
    minify: false,
  });
  expect(result.success).toBe(true);
  expect(result.outputs).toHaveLength(1);
  const bundle = await result.outputs[0].text();
  expect(bundle).not.toMatch(
    /googleapis|opentelemetry|posthog|fetch\(|node:|supabase/,
  );
  expect(bundle).toContain("formatCsfSheetBounds");
});
