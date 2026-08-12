import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260812001000_project_cancellation_hostile_review_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("project cancellation forward-upgrade ordering", () => {
  test("parks every legacy pending/processing job before replacement claims exist", () => {
    const revoke = migration.indexOf(
      "REVOKE ALL ON FUNCTION public.claim_project_cancellation_jobs",
    );
    const park = migration.indexOf("WHERE status IN ('pending', 'processing')");
    const drop = migration.indexOf(
      "DROP FUNCTION public.claim_project_cancellation_jobs",
    );
    const replacement = migration.indexOf(
      "CREATE FUNCTION public.claim_project_cancellation_jobs",
    );

    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(park).toBeGreaterThan(revoke);
    expect(drop).toBeGreaterThan(park);
    expect(replacement).toBeGreaterThan(drop);

    const parkStatement = migration.slice(
      migration.lastIndexOf("UPDATE public.project_cancellation_jobs", park),
      park + "WHERE status IN ('pending', 'processing')".length,
    );
    expect(parkStatement).toContain("status = 'needs_review'");
    expect(parkStatement).not.toContain("cursor");
    expect(parkStatement).not.toContain("attempts = 0");
  });

  test("preserves in-flight provider ambiguity before leases are cleared", () => {
    const deliveryPark = migration.indexOf(
      "failure_code = 'upgrade_inflight_outcome_unknown'",
    );
    const jobPark = migration.indexOf(
      "last_error = 'legacy_job_parked_before_atomic_claims'",
    );

    expect(deliveryPark).toBeGreaterThanOrEqual(0);
    expect(jobPark).toBeGreaterThan(deliveryPark);
    expect(
      migration.slice(
        migration.lastIndexOf(
          "UPDATE public.project_cancellation_deliveries",
          deliveryPark,
        ),
        deliveryPark,
      ),
    ).toContain("email_state = 'unknown_outcome'");
  });

  test("installs only the atomic authenticated cancellation boundary", () => {
    expect(migration).toContain(
      "CREATE FUNCTION public.cancel_project_transactional",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.cancel_project_transactional(uuid, text)\n  TO authenticated",
    );
    expect(migration).toContain(
      "DROP FUNCTION public.enqueue_project_cancellation_job",
    );
    expect(migration).toContain(
      "DROP FUNCTION public.initialize_project_cancellation_audience",
    );
    expect(migration).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.cancel_project_transactional(uuid, text)\n  TO service_role",
    );
  });
});
