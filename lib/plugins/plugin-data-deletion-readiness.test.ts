import { describe, expect, test } from "bun:test";

import type { OrganizationPluginDefinition } from "@/types/plugin";
import { getPluginDataDeletionReadiness } from "./plugin-data-deletion-readiness";

const deleteHook = async () => undefined;

function definition(overrides?: {
  declaration?: Record<string, unknown>;
  hook?: boolean;
  includeStorage?: boolean;
}): OrganizationPluginDefinition {
  return {
    manifest: {
      key: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      visibility: "global",
      dataAccess: [
        {
          schema: "plugin_data",
          relation: "test_records",
          access: "server-only",
          purpose: "Test records",
          tenantColumn: "organization_id",
        },
      ],
      storageAccess: overrides?.includeStorage
        ? [
            {
              bucket: "plugin-files",
              pathPattern: "{organizationId}/test-plugin/*",
              access: "server-only",
              purpose: "Test files",
            },
          ]
        : [],
      ...(overrides?.declaration
        ? { dataDeletion: overrides.declaration }
        : {}),
    },
    lifecycle:
      overrides?.hook === false ? undefined : { onDataDelete: deleteHook },
  } as unknown as OrganizationPluginDefinition;
}

function completeDeclaration(overrides: Record<string, unknown> = {}) {
  return {
    reviewed: true,
    reviewedAt: "2026-08-12",
    execution: {
      atomicity: "non-transactional",
      retrySafety: "idempotent",
    },
    dataTargets: [
      {
        schema: "plugin_data",
        relation: "test_records",
        tenantColumn: "organization_id",
        disposition: "delete",
      },
    ],
    storageTargets: [],
    externalSystemsNotCovered: [],
    ...overrides,
  };
}

describe("getPluginDataDeletionReadiness", () => {
  test("fails closed when either the declaration or hook is absent", () => {
    const declarationMissing = getPluginDataDeletionReadiness(definition());
    expect(declarationMissing.ready).toBe(false);
    expect(declarationMissing.blockers).toContain("declaration_missing");

    const hookMissing = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration(),
        hook: false,
      }),
    );
    expect(hookMissing.ready).toBe(false);
    expect(hookMissing.blockers).toContain("hook_missing");
  });

  test("accepts an exact, reviewed, retry-safe contract covering every declared tenant target", () => {
    const readiness = getPluginDataDeletionReadiness(
      definition({ declaration: completeDeclaration() }),
    );

    expect(readiness).toMatchObject({
      manifestReviewed: true,
      hookPresent: true,
      contractComplete: true,
      retrySafe: true,
      allTenantDataDeleted: true,
      ready: true,
      blockers: [],
    });
  });

  test("refuses a declaration that omits, duplicates, or invents a data target", () => {
    const missing = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({ dataTargets: [] }),
      }),
    );
    expect(missing.ready).toBe(false);
    expect(missing.blockers).toContain("data_targets_incomplete");

    const target = completeDeclaration().dataTargets[0];
    const duplicate = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({
          dataTargets: [target, target],
        }),
      }),
    );
    expect(duplicate.ready).toBe(false);
    expect(duplicate.blockers).toContain("data_targets_incomplete");

    const extra = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({
          dataTargets: [
            target,
            {
              schema: "plugin_data",
              relation: "undeclared_records",
              tenantColumn: "organization_id",
              disposition: "delete",
            },
          ],
        }),
      }),
    );
    expect(extra.ready).toBe(false);
    expect(extra.blockers).toContain("data_targets_incomplete");
  });

  test("requires an exact disposition for every declared storage target", () => {
    const missingStorage = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration(),
        includeStorage: true,
      }),
    );
    expect(missingStorage.ready).toBe(false);
    expect(missingStorage.blockers).toContain("storage_targets_incomplete");

    const complete = getPluginDataDeletionReadiness(
      definition({
        includeStorage: true,
        declaration: completeDeclaration({
          storageTargets: [
            {
              bucket: "plugin-files",
              pathPattern: "{organizationId}/test-plugin/*",
              disposition: "delete",
            },
          ],
        }),
      }),
    );
    expect(complete.ready).toBe(true);
  });

  test("records a complete retention declaration but keeps permanent deletion unavailable", () => {
    const readiness = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({
          dataTargets: [
            {
              schema: "plugin_data",
              relation: "test_records",
              tenantColumn: "organization_id",
              disposition: "retain",
              reason: "Legally required retention",
            },
          ],
        }),
      }),
    );

    expect(readiness.contractComplete).toBe(true);
    expect(readiness.allTenantDataDeleted).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("tenant_data_retained");
  });

  test("refuses malformed review dates and hooks that are not safe to retry after partial failure", () => {
    const badDate = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({ reviewedAt: "sometime recently" }),
      }),
    );
    expect(badDate.ready).toBe(false);
    expect(badDate.blockers).toContain("review_date_invalid");

    const manualReconciliation = getPluginDataDeletionReadiness(
      definition({
        declaration: completeDeclaration({
          execution: {
            atomicity: "non-transactional",
            retrySafety: "manual-reconciliation",
          },
        }),
      }),
    );
    expect(manualReconciliation.ready).toBe(false);
    expect(manualReconciliation.blockers).toContain("hook_not_retry_safe");
  });

  test("refuses stored plugin_data relations with no tenant column", () => {
    const unsafe = definition({
      declaration: completeDeclaration({
        dataTargets: [
          {
            schema: "plugin_data",
            relation: "test_records",
            tenantColumn: null,
            disposition: "delete",
          },
        ],
      }),
    });
    unsafe.manifest.dataAccess![0]!.tenantColumn = undefined;

    const readiness = getPluginDataDeletionReadiness(unsafe);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("tenant_scope_missing");
  });
});
