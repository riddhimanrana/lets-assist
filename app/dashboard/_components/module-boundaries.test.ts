import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("volunteer dashboard module boundaries", () => {
  test("the route delegates data loading and presentation", () => {
    const page = read("app/dashboard/page.tsx");
    // Dashboard data and plugin dashboard cards load in parallel; both are
    // delegated — the route itself still owns no queries or presentation.
    expect(page).toContain("loadVolunteerDashboardData()");
    expect(page).toContain("resolvePlatformDashboardCards");
    expect(page).toContain(
      "<VolunteerDashboardView {...data} pluginCards={pluginCards} />",
    );
    expect(page).not.toContain("createClient");
  });

  test("loader and server presentation stay below route budgets", () => {
    expect(
      read("app/dashboard/_components/dashboard-data.ts").split("\n").length,
    ).toBeLessThanOrEqual(800);
    expect(
      read("app/dashboard/_components/VolunteerDashboardView.tsx").split("\n")
        .length,
    ).toBeLessThanOrEqual(600);
  });

  test("the extracted presentation remains a Server Component", () => {
    const view = read("app/dashboard/_components/VolunteerDashboardView.tsx");
    expect(view).not.toContain('"use client"');
    expect(view).not.toMatch(/export async function VolunteerDashboardView/u);
  });
});
