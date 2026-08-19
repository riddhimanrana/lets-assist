import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const creatorDashboard = readFileSync(
  new URL("./CreatorDashboard.tsx", import.meta.url),
  "utf8",
);
const editProjectClient = readFileSync(
  new URL("./edit/EditProjectClient.tsx", import.meta.url),
  "utf8",
);

describe("project deletion navigation", () => {
  test.each([
    ["creator dashboard", creatorDashboard],
    ["edit project", editProjectClient],
  ])("%s replaces the deleted route without refreshing it", (_name, source) => {
    const handler = source.match(
      /const handleDeleteProject = async \(\) => \{[\s\S]*?\n[ ]{2}\};/,
    )?.[0];

    expect(handler).toBeDefined();
    expect(handler).toContain('router.replace("/home")');
    expect(handler).not.toContain('router.push("/home")');
    expect(handler).not.toContain("router.refresh()");
  });
});
