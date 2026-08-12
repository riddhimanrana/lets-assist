import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * The create and edit forms give instant "unavailable" feedback for a
 * reserved username without a network round trip. That is only safe
 * because the source of truth is `lib/organization/reserved-slugs.ts` --
 * the same set the Server Actions and the database constraint enforce --
 * not a form-local guess. This pins both forms to the shared helper so a
 * future reserved route can't be added to one without the other, and so
 * neither form regresses to a hardcoded, single-word check again (the
 * create form previously special-cased only `"create"`, missing `"join"`
 * entirely).
 */
describe("organization username reserved-slug client feedback", () => {
  test("the create form derives its instant check from the shared reserved-slug helper", () => {
    const source = read("app/organization/create/OrganizationCreator.tsx");
    expect(source).toContain(
      'import { isReservedOrganizationSlug } from "@/lib/organization/reserved-slugs";',
    );
    expect(source).toContain("isReservedOrganizationSlug(e.target.value)");
    // No hardcoded reserved-word literal comparison remains.
    expect(source).not.toMatch(/===\s*["']create["']/u);
    expect(source).not.toMatch(/===\s*["']join["']/u);
  });

  test("the edit form derives its instant check from the shared reserved-slug helper", () => {
    const source = read(
      "app/organization/[id]/settings/EditOrganizationForm.tsx",
    );
    expect(source).toContain(
      'import { isReservedOrganizationSlug } from "@/lib/organization/reserved-slugs";',
    );
    expect(source).toContain("isReservedOrganizationSlug(value)");
  });
});
