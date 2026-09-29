import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const paths = [
  "app/organization/page.tsx",
  "app/organization/create/page.tsx",
  "app/organization/create/actions.ts",
  "app/projects/create/server/create.ts",
  "app/projects/create/server/drafts.ts",
  "app/projects/[id]/server/lifecycle.ts",
  "app/trusted-member/submit-form.tsx",
];

describe("trusted membership uses the caller-scoped database boundary", () => {
  for (const path of paths) {
    test(`${path} does not query the protected profiles table`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\.from\("profiles"\)/);
      expect(source).toMatch(
        /\.rpc\(\s*"is_trusted_member",\s*\{\s*p_user: user.id/,
      );
    });
  }

  test("project creation loads the authenticated creator's real avatar column", () => {
    const source = readFileSync("app/projects/create/page.tsx", "utf8");
    expect(source).not.toContain("profile_image_url");
    expect(source).not.toContain('.from("profiles")');
    expect(source).toContain("getProjectCreatorProfileById(user.id)");
    expect(source).toContain("userProfile?.avatar_url");
    expect(source.indexOf("if (!user)")).toBeLessThan(
      source.indexOf("await getProjectCreatorProfileById(user.id)"),
    );
  });
});
