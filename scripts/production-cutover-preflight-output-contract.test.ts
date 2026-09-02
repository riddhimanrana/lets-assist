import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const preflight = readFileSync(
  join(repositoryRoot, "scripts/production-cutover-preflight.sql"),
  "utf8",
);

describe("Production cutover preflight output contract", () => {
  test("emits counts instead of live row identifiers for blockers", () => {
    const blockerOutput = preflight.slice(
      preflight.indexOf("D1  Duplicate verified certificates"),
      preflight.indexOf("D10 Current reviewed public client grants"),
    );
    for (const countAlias of [
      "duplicate_signup_group_count",
      "incompatible_campaign_count",
      "duplicate_class_group_count",
      "reserved_slug_organization_count",
      "invalid_cancellation_job_count",
      "cross_tenant_reply_count",
      "invalid_receipt_group_count",
      "external_dependency_count",
    ]) {
      expect(blockerOutput).toContain(countAlias);
    }
    for (const rowProjection of [
      "SELECT signup_id",
      "array_agg(id ORDER BY id)",
      "SELECT campaign.organization_id",
      "SELECT organization_id, cohort_id",
      "SELECT id AS organization_id",
      'SELECT id, status, attempts, "cursor"',
      "SELECT reply.id AS reply_id",
      "SELECT organization_id, correlation_id",
      "pg_catalog.pg_describe_object(",
    ]) {
      expect(blockerOutput).not.toContain(rowProjection);
    }
  });
});
