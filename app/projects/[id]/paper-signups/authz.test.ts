import { describe, expect, test } from "bun:test";

import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";

/**
 * The paper-signup decision table. Every server action in this directory
 * gates on canManageProjectAccess, and the commit RPC re-checks the same
 * policy in SQL via app_private.can_manage_project — the pgTAP suite
 * (paper_signup_scan_commit.test.sql) asserts the SQL side; this file pins
 * the TypeScript side so the two cannot silently drift apart.
 */

const CREATOR = "creator-1";
const OTHER = "user-2";

describe("paper signup management access", () => {
  test("the project creator can manage", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: CREATOR,
        organizationRole: null,
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("an org admin can manage regardless of the staff flag", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "admin",
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("org staff can manage only when the project opted in", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: true,
      }),
    ).toBe(true);
  });

  test("org staff cannot manage when the project opted out", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: false,
      }),
    ).toBe(false);
  });

  test("staff with an absent flag are denied, not defaulted in", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: null,
      }),
    ).toBe(false);
  });

  test("plain members and unrelated users are denied", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "member",
        canBeManagedByStaff: true,
      }),
    ).toBe(false);
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: null,
        canBeManagedByStaff: true,
      }),
    ).toBe(false);
  });

  test("inactive admins and staff confer no paper-scan access", () => {
    for (const role of ["admin", "staff"]) {
      expect(
        canManageProjectAccess({
          creatorId: CREATOR,
          userId: OTHER,
          organizationRole: activeOrganizationRole({
            role,
            status: "inactive",
          }),
          canBeManagedByStaff: true,
        }),
      ).toBe(false);
    }
  });

  test("both service-role entry points derive an active membership and fence extraction ownership", async () => {
    const actionsSource = await Bun.file(
      new URL("./actions.ts", import.meta.url),
    ).text();
    const scanRouteSource = await Bun.file(
      new URL("../../../api/ai/scan-signup-sheet/route.ts", import.meta.url),
    ).text();

    for (const source of [actionsSource, scanRouteSource]) {
      expect(source).toContain('.select("role, status")');
      expect(source).toContain("activeOrganizationRole(membership)");
    }
    expect(scanRouteSource).toContain("extraction_claim_id: claimId");
    expect(scanRouteSource).toContain('.eq("updated_at", batch.updated_at)');
    expect(scanRouteSource).toContain(
      '.eq("extraction_claim_id", claimedBatch.claimId)',
    );
  });

  test("registered scan photos survive an ambiguous extraction response", async () => {
    const captureSource = await Bun.file(
      new URL("./CaptureStep.tsx", import.meta.url),
    ).text();

    expect(captureSource).toContain("registeredBatchId = batchResult.batchId");
    expect(captureSource).toContain(
      "registeredBatchId === null && uploadedPaths.length > 0",
    );
    expect(captureSource).toContain("metadata: { cleanupToken }");
    expect(captureSource).toContain("releaseOrphanedUploads(cleanup)");
    expect(captureSource).toContain("rememberPendingCleanup(cleanup)");
    expect(captureSource).toContain("window.localStorage.setItem");
    expect(captureSource).toContain("window.localStorage.getItem");
    expect(captureSource).toContain('"registered" in queueResult');
    expect(captureSource).not.toContain(".remove(cleanup.objectPaths)");
    expect(captureSource).toContain('"Retry cleanup"');
    expect(captureSource).toContain('.from("project_paper_scan_batches")');
    expect(captureSource).toContain('recoveredBatch.status === "draft"');
    expect(captureSource).toContain('recoveredBatch.status === "review"');
    expect(captureSource).toContain('recoveredBatch.status === "failed"');
    expect(captureSource).toContain('recoveredBatch.status === "committed"');
    expect(captureSource).toContain('recoveredBatch.status === "discarded"');
    expect(
      captureSource.lastIndexOf("window.location.reload()"),
    ).toBeGreaterThan(
      captureSource.indexOf('recoveredBatch.status === "review"'),
    );
  });

  test("orphan cleanup survives revoked project access without widening management authority", async () => {
    const actionsSource = await Bun.file(
      new URL("./actions.ts", import.meta.url),
    ).text();
    const cleanupSource = actionsSource.slice(
      actionsSource.indexOf(
        "export async function queueOrphanedPaperScanUploads",
      ),
      actionsSource.indexOf("const updateRowSchema"),
    );

    expect(cleanupSource).toContain("getAuthUser()");
    expect(cleanupSource).not.toContain("requirePaperScanAccess");
    expect(cleanupSource).toContain("data?.metadata?.cleanupToken");
    expect(cleanupSource).toContain('"queue_orphaned_paper_scan_uploads"');
    expect(cleanupSource).toContain("return { registered: true }");
  });
});
