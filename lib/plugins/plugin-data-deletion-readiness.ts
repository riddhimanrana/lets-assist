import type {
  OrganizationPluginDataDeletionDataTarget,
  OrganizationPluginDataDeletionStorageTarget,
  OrganizationPluginDefinition,
} from "@/types/plugin";

/**
 * The mechanical completeness gate for permanent plugin-data deletion.
 *
 * Deliberately pure and side-effect free so it can run at registry load,
 * in unit tests, and inside the deletion action itself without touching a
 * database. A plugin is only "ready" when BOTH halves of the contract are
 * present — an author can declare `dataDeletion.reviewed: true` without
 * having (or after removing) the `onDataDelete` hook, or ship a hook
 * without ever reviewing/declaring it, and either half missing must fail
 * safe (deletion refused) rather than silently degrade to a no-op or a
 * best-effort partial erasure.
 */
export interface PluginDataDeletionReadiness {
  manifestReviewed: boolean;
  hookPresent: boolean;
  contractComplete: boolean;
  retrySafe: boolean;
  allTenantDataDeleted: boolean;
  ready: boolean;
  blockers: PluginDataDeletionReadinessBlocker[];
}

export type PluginDataDeletionReadinessBlocker =
  | "declaration_missing"
  | "hook_missing"
  | "review_date_invalid"
  | "execution_contract_invalid"
  | "hook_not_retry_safe"
  | "data_targets_incomplete"
  | "storage_targets_incomplete"
  | "tenant_scope_missing"
  | "tenant_data_retained"
  | "external_systems_declaration_missing";

function hasValidReviewDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function dataTargetKey(target: {
  schema: string;
  relation: string;
  tenantColumn?: string | null;
}): string {
  return `${target.schema}\u0000${target.relation}\u0000${target.tenantColumn ?? ""}`;
}

function storageTargetKey(target: {
  bucket: string;
  pathPattern: string;
}): string {
  return `${target.bucket}\u0000${target.pathPattern}`;
}

function exactlyCovers<TExpected, TDeclared>(
  expected: TExpected[],
  declared: TDeclared[],
  expectedKey: (target: TExpected) => string,
  declaredKey: (target: TDeclared) => string,
): boolean {
  const expectedKeys = expected.map(expectedKey);
  const declaredKeys = declared.map(declaredKey);
  return (
    expectedKeys.length === new Set(expectedKeys).size &&
    declaredKeys.length === new Set(declaredKeys).size &&
    expectedKeys.length === declaredKeys.length &&
    expectedKeys.every((key) => declaredKeys.includes(key))
  );
}

export function getPluginDataDeletionReadiness(
  definition: Pick<OrganizationPluginDefinition, "manifest" | "lifecycle">,
): PluginDataDeletionReadiness {
  const declaration = definition.manifest.dataDeletion;
  const manifestReviewed = Boolean(
    declaration && declaration.reviewed === true,
  );
  const hookPresent = typeof definition.lifecycle?.onDataDelete === "function";
  const blockers: PluginDataDeletionReadinessBlocker[] = [];

  if (!declaration) {
    blockers.push("declaration_missing");
  }
  if (!hookPresent) {
    blockers.push("hook_missing");
  }

  if (!declaration) {
    return {
      manifestReviewed,
      hookPresent,
      contractComplete: false,
      retrySafe: false,
      allTenantDataDeleted: false,
      ready: false,
      blockers,
    };
  }

  const validReviewDate = hasValidReviewDate(declaration.reviewedAt);
  if (!validReviewDate) {
    blockers.push("review_date_invalid");
  }

  const executionValid =
    (declaration.execution?.atomicity === "transactional" ||
      declaration.execution?.atomicity === "non-transactional") &&
    (declaration.execution?.retrySafety === "idempotent" ||
      declaration.execution?.retrySafety === "manual-reconciliation");
  if (!executionValid) {
    blockers.push("execution_contract_invalid");
  }

  const retrySafe = declaration.execution?.retrySafety === "idempotent";
  if (!retrySafe) {
    blockers.push("hook_not_retry_safe");
  }

  const declaredDataTargets = Array.isArray(declaration.dataTargets)
    ? declaration.dataTargets
    : [];
  const manifestDataTargets = definition.manifest.dataAccess ?? [];
  const dataTargetsComplete = exactlyCovers(
    manifestDataTargets,
    declaredDataTargets,
    dataTargetKey,
    dataTargetKey,
  );
  if (!dataTargetsComplete) {
    blockers.push("data_targets_incomplete");
  }

  const declaredStorageTargets = Array.isArray(declaration.storageTargets)
    ? declaration.storageTargets
    : [];
  const manifestStorageTargets = definition.manifest.storageAccess ?? [];
  const storageTargetsComplete = exactlyCovers(
    manifestStorageTargets,
    declaredStorageTargets,
    storageTargetKey,
    storageTargetKey,
  );
  if (!storageTargetsComplete) {
    blockers.push("storage_targets_incomplete");
  }

  const targetHasTenantScope = (
    target: OrganizationPluginDataDeletionDataTarget,
  ) =>
    typeof target.tenantColumn === "string" &&
    target.tenantColumn.trim().length > 0;
  const tenantScopeComplete =
    manifestDataTargets.every(
      (target) =>
        typeof target.tenantColumn === "string" &&
        target.tenantColumn.trim().length > 0,
    ) && declaredDataTargets.every(targetHasTenantScope);
  if (!tenantScopeComplete) {
    blockers.push("tenant_scope_missing");
  }

  const hasValidDisposition = (
    target:
      | OrganizationPluginDataDeletionDataTarget
      | OrganizationPluginDataDeletionStorageTarget,
  ) =>
    target.disposition === "delete" ||
    (target.disposition === "retain" &&
      typeof target.reason === "string" &&
      target.reason.trim().length > 0);
  const dataDispositionsValid = declaredDataTargets.every(hasValidDisposition);
  const storageDispositionsValid =
    declaredStorageTargets.every(hasValidDisposition);
  if (!dataDispositionsValid) {
    blockers.push("data_targets_incomplete");
  }
  if (!storageDispositionsValid) {
    blockers.push("storage_targets_incomplete");
  }

  const allTenantDataDeleted =
    dataTargetsComplete &&
    storageTargetsComplete &&
    tenantScopeComplete &&
    dataDispositionsValid &&
    storageDispositionsValid &&
    declaredDataTargets.every((target) => target.disposition === "delete") &&
    declaredStorageTargets.every((target) => target.disposition === "delete");
  if (
    dataTargetsComplete &&
    storageTargetsComplete &&
    dataDispositionsValid &&
    storageDispositionsValid &&
    !allTenantDataDeleted
  ) {
    blockers.push("tenant_data_retained");
  }

  const externalSystemsDeclared = Array.isArray(
    declaration.externalSystemsNotCovered,
  );
  if (!externalSystemsDeclared) {
    blockers.push("external_systems_declaration_missing");
  }

  const contractComplete =
    manifestReviewed &&
    validReviewDate &&
    executionValid &&
    dataTargetsComplete &&
    storageTargetsComplete &&
    tenantScopeComplete &&
    dataDispositionsValid &&
    storageDispositionsValid &&
    externalSystemsDeclared;

  return {
    manifestReviewed,
    hookPresent,
    contractComplete,
    retrySafe,
    allTenantDataDeleted,
    ready:
      manifestReviewed &&
      hookPresent &&
      contractComplete &&
      retrySafe &&
      allTenantDataDeleted,
    blockers: [...new Set(blockers)],
  };
}
