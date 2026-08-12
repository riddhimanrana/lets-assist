import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const scheduleMigration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812100200_enforce_project_schedule_validation.sql",
  ),
  "utf8",
);
const feedbackMigration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812100300_feedback_dispatch_phases.sql",
  ),
  "utf8",
);

function expectPgTapPlanMatches(fileName: string) {
  const source = readFileSync(
    join(repositoryRoot, "supabase/tests/database", fileName),
    "utf8",
  );
  const planned = Number(source.match(/extensions\.plan\((\d+)\)/u)?.[1]);
  const assertions = source.match(
    /SELECT extensions\.(?:ok|is|isnt|lives_ok|throws_ok|results_eq)\(/gu,
  );
  expect(planned).toBe(assertions?.length ?? 0);
}

describe("project schedule forward-migration contracts", () => {
  test("validates only inserts and changed schedule metadata", () => {
    expect(scheduleMigration).toContain(
      "BEFORE INSERT OR UPDATE OF project_timezone, recurrence_rule ON public.projects",
    );
    expect(scheduleMigration).toContain(
      "NEW.project_timezone IS DISTINCT FROM OLD.project_timezone",
    );
    expect(scheduleMigration).toContain(
      "NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule",
    );
  });

  test("enforces strict keys, calendar dates, and the 52 ceiling", () => {
    expect(scheduleMigration).toContain("FROM jsonb_object_keys(p_rule)");
    expect(scheduleMigration).toContain("v_end_date := v_end_date_text::date");
    expect(scheduleMigration).toContain("v_end_occurrences > 52");
  });

  test("every new private function has explicit reviewed ACLs", () => {
    for (const signature of [
      "private.project_timezone_is_valid(text)",
      "private.project_recurrence_rule_is_valid(jsonb)",
      "private.enforce_project_schedule_validation()",
    ]) {
      expect(scheduleMigration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}`,
      );
      expect(scheduleMigration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}`,
      );
    }
  });

  test("the authored pgTAP plan matches its assertions", () => {
    expectPgTapPlanMatches("project_schedule_validation.test.sql");
  });
});

describe("feedback phase forward-migration contracts", () => {
  test("preparation and dispatch have distinct reap outcomes", () => {
    expect(feedbackMigration).toContain("requests.state = 'preparing'");
    expect(feedbackMigration).toContain(
      "failure_code = 'preparation_lease_expired'",
    );
    expect(feedbackMigration).toContain("requests.state = 'dispatching'");
    expect(feedbackMigration).toContain(
      "failure_code = 'dispatch_lease_expired'",
    );
  });

  test("provider attempts increment only at the durable dispatch boundary", () => {
    const claimBody = feedbackMigration.slice(
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.claim_project_feedback_requests_for_preparation",
      ),
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.begin_project_feedback_request_dispatch",
      ),
    );
    const dispatchBody = feedbackMigration.slice(
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.begin_project_feedback_request_dispatch",
      ),
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.reap_project_feedback_request_leases",
      ),
    );

    expect(claimBody).not.toContain("attempts = requests.attempts + 1");
    expect(dispatchBody).toContain("attempts = requests.attempts + 1");
  });

  test("the new service-only RPC has explicit client denial and service grant", () => {
    for (const signature of [
      "public.claim_project_feedback_requests_for_preparation(text, integer, integer)",
      "public.begin_project_feedback_request_dispatch(uuid, text, integer)",
    ]) {
      expect(feedbackMigration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}`,
      );
      expect(feedbackMigration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}`,
      );
    }
    expect(feedbackMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(feedbackMigration).toContain("TO service_role");
  });

  test("the legacy claim RPC remains dispatch-conservative during rollout", () => {
    const legacyClaimBody = feedbackMigration.slice(
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.claim_project_feedback_requests(",
      ),
      feedbackMigration.indexOf(
        "CREATE OR REPLACE FUNCTION public.claim_project_feedback_requests_for_preparation",
      ),
    );
    expect(legacyClaimBody).toContain("state = 'dispatching'");
    expect(legacyClaimBody).toContain("attempts = requests.attempts + 1");
  });

  test("attempt exhaustion becomes a terminal failure, never frozen queued work", () => {
    expect(feedbackMigration).toContain(
      "WHEN p_state = 'queued' AND requests.attempts >= 3 THEN 'failed'",
    );
    expect(feedbackMigration).toContain("THEN 'attempts_exhausted'");
  });

  test("the updated pgTAP plan matches its assertions", () => {
    expectPgTapPlanMatches("project_feedback_requests.test.sql");
  });
});
