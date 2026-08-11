import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const schools = readFileSync(
  new URL("./sections/schools.tsx", import.meta.url),
  "utf8",
);
const helpIndex = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("current CSF platform help", () => {
  test("directs installed chapters to the role-aware workspace guide", () => {
    expect(schools).toContain("DVHS CSF members and officers");
    expect(schools).toContain("select Help from the CSF");
    expect(schools).toContain("Role-aware and permission-filtered");
    expect(helpIndex).toContain("Chapter CSF Workspaces");
    expect(helpIndex).toContain("CSF Member Workflow");
    expect(helpIndex).toContain("CSF Chapter Setup");
  });

  test("teaches the current record, link, review, and staff-access workflow", () => {
    for (const copy of [
      "Connect your CSF student record",
      "class link or student-specific link",
      "After approval, open My CSF",
      "Open Members to add records",
      "Open Staff access to assign a connected account",
      "Communications separates campaign content",
    ]) {
      expect(schools).toContain(copy);
    }
  });

  test("removes unsupported universal CSF claims and obsolete click paths", () => {
    for (const staleCopy of [
      "Most CSF programs require",
      "10-15 hours per semester",
      "Create projects specifically tagged for CSF requirements",
      "Create a project tagged as &quot;CSF Volunteer Hours&quot;",
      "Dashboard → Export Certificates",
      "Start CSF Project",
    ]) {
      expect(schools).not.toContain(staleCopy);
    }
    expect(schools).toMatch(
      /does not assume one universal CSF hour\s+or point requirement/u,
    );
  });
});
