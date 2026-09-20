import { describe, expect, test } from "bun:test";
import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";

describe("attendance print access", () => {
  test("inactive managers cannot print a roster", () => {
    for (const status of ["inactive", "invited", null]) {
      for (const role of ["admin", "staff"]) {
        expect(
          canManageProjectAccess({
            creatorId: "owner",
            userId: "other",
            organizationRole: activeOrganizationRole({ role, status }),
            canBeManagedByStaff: true,
          }),
        ).toBe(false);
      }
    }
  });
  test("print routes authorize managers before server-only manifest access", async () => {
    const page = await Bun.file(new URL("./page.tsx", import.meta.url)).text();
    const action = await Bun.file(
      new URL("./actions.ts", import.meta.url),
    ).text();
    const manifest = await Bun.file(
      new URL("../../../../lib/attendance/print-manifest.ts", import.meta.url),
    ).text();
    expect(page).toContain('dynamic = "force-dynamic"');
    expect(page).toContain("requireAttendancePrintAccess(id)");
    expect(action).toContain(
      "requireAttendancePrintAccess(parsed.data.projectId)",
    );
    expect(manifest).toContain('import "server-only"');
    expect(manifest).toContain('select("role, status")');
    expect(manifest).toContain("activeOrganizationRole(membership)");
    expect(manifest).toContain(
      "requireAttendancePrintAccess(parsed.data.projectId)",
    );
    expect(manifest).toContain("if (input.projectId !== access.project.id)");
    expect(manifest).toContain('.eq("project_id", input.projectId)');
    expect(manifest).toContain('.eq("schedule_id", scheduleId)');
    expect(manifest).toContain(
      "resolveAuthorizedAttendancePrintReferences(access, {",
    );
  });
});
