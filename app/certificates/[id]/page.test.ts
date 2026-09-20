import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260701042331_tenant_read_models_phase3.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("public certificate projection", () => {
  test("every selected field exists in the public verification view", () => {
    const view = migration
      .split("CREATE VIEW public.certificate_verification_read_model")[1]
      .split("FROM public.certificates")[0];
    const columns = new Set(
      [...view.matchAll(/(?:c\.([a-z_]+)|AS ([a-z_]+))/g)].map(
        (match) => match[1] || match[2],
      ),
    );
    const selections = [...page.matchAll(/\.select\(\s*(["`])([\s\S]*?)\1/g)];
    expect(selections.length).toBe(2);
    for (const [, , selection] of selections) {
      for (const column of selection.split(",").map((value) => value.trim())) {
        expect(columns.has(column)).toBe(true);
      }
    }
    expect(columns.has("volunteer_email")).toBe(false);
  });

  test("print data omits private email and missing records return not found", () => {
    expect(page).toContain("volunteer_email: null");
    expect(page).toMatch(/if \(error \|\| !record\) \{[\s\S]*?notFound\(\)/);
  });
});
