import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const staging = readFileSync(
  new URL(
    "../supabase/migrations/20260917010000_csf_term_decision_staging.sql",
    import.meta.url,
  ),
  "utf8",
);
const publish = readFileSync(
  new URL(
    "../supabase/migrations/20260917010100_csf_sheet_application_decision_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);
const sync = readFileSync(
  new URL(
    "../supabase/migrations/20260917010200_csf_sheet_application_decision_sync.sql",
    import.meta.url,
  ),
  "utf8",
);
const release = readFileSync(
  new URL(
    "../supabase/migrations/20260917010300_csf_sheet_application_decision_release.sql",
    import.meta.url,
  ),
  "utf8",
);

const mergeOwnership = readFileSync(
  new URL(
    "../supabase/migrations/20260917020000_csf_decision_stage_merge_ownership.sql",
    import.meta.url,
  ),
  "utf8",
);
const mappingFields = readFileSync(
  new URL(
    "../supabase/migrations/20260917020100_csf_application_decision_mapping_fields.sql",
    import.meta.url,
  ),
  "utf8",
);

const finalizedGuard = readFileSync(
  new URL(
    "../supabase/migrations/20260917030000_csf_finalized_outcome_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

const provenanceNullSafety = readFileSync(
  new URL(
    "../supabase/migrations/20260917030100_csf_provenance_null_safety.sql",
    import.meta.url,
  ),
  "utf8",
);

const all = [
  staging,
  publish,
  sync,
  release,
  mergeOwnership,
  mappingFields,
  finalizedGuard,
  provenanceNullSafety,
].join("\n");

/** Executable SQL only. Prose about a review campaign is not a mail send. */
function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const executable = withoutComments(all);

const NEW_TABLES = [
  "csf_application_decision_sync_runs",
  "csf_application_decision_sync_sources",
  "csf_application_decision_sync_rows",
  "csf_application_decision_releases",
  "csf_application_decision_stages",
  "csf_application_decision_mappings",
] as const;

/** Every function the migrations create, with its exact argument type list. */
const FUNCTIONS: Array<{ name: string; args: string; callable: boolean }> = [
  { name: "csf_term_is_sheet_review", args: "uuid, uuid", callable: false },
  { name: "csf_guard_application_decision_evidence", args: "", callable: false },
  { name: "csf_queue_application_sheet_writeback", args: "uuid, uuid, text, text", callable: false },
  { name: "csf_guard_sheet_writeback_review_mode", args: "", callable: false },
  { name: "csf_assert_sheet_decision_authority", args: "uuid, uuid, text, text", callable: false },
  { name: "csf_sheet_decision_term_lock_key", args: "uuid, uuid", callable: false },
  { name: "csf_set_term_application_review_source", args: "uuid, uuid, uuid, text, uuid", callable: true },
  // The six-argument first cut is dropped by 20260917020100; the mapping is
  // saved as one document with a version to check against.
  { name: "csf_set_application_decision_mapping", args: "uuid, uuid, uuid, jsonb, integer", callable: true },
  { name: "csf_list_application_decision_mappings", args: "uuid, uuid", callable: true },
  { name: "csf_guard_decision_stage_profile_matches_application", args: "", callable: false },
  { name: "csf_publish_sheet_application_decision", args: "uuid, uuid, text, text, uuid, jsonb", callable: false },
  { name: "csf_stage_sheet_application_decisions", args: "uuid, uuid, uuid, uuid, jsonb, jsonb", callable: true },
  { name: "csf_sheet_application_decision_run_receipt", args: "uuid, uuid", callable: false },
  { name: "csf_record_sheet_decision_sync_failure", args: "uuid, uuid, uuid, uuid, jsonb, text", callable: true },
  { name: "csf_release_sheet_application_decisions", args: "uuid, uuid, uuid, uuid, uuid[]", callable: true },
  { name: "csf_list_sheet_application_decisions", args: "uuid, uuid, uuid, text, text, text, integer, text", callable: true },
  { name: "csf_sheet_application_decision_term_state", args: "uuid, uuid, uuid", callable: true },
  { name: "csf_member_term_review_state", args: "uuid, uuid", callable: true },
  { name: "csf_reject_native_decision_in_sheet_review", args: "uuid, uuid", callable: false },
];

describe("Sheets application decision schema", () => {
  test("every new table keeps RLS on and hands service_role nothing but SELECT", () => {
    for (const table of NEW_TABLES) {
      expect(staging).toContain(`'${table}'`);
    }
    expect(staging).toContain(
      "REVOKE ALL ON TABLE plugin_data.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(staging).toContain("GRANT SELECT ON TABLE plugin_data.%I TO service_role");
    expect(staging).toContain("ENABLE ROW LEVEL SECURITY");
    // A blanket write grant would let a PostgREST call stage a decision.
    expect(staging).not.toContain("GRANT ALL ON TABLE plugin_data.csf_application_decision");
  });

  test("every table is tenant-scoped through a composite foreign key", () => {
    for (const table of [
      "csf_application_decision_sync_sources",
      "csf_application_decision_sync_rows",
      "csf_application_decision_releases",
      "csf_application_decision_stages",
    ]) {
      const definition = staging.slice(
        staging.indexOf(`CREATE TABLE plugin_data.${table}`),
      );
      const body = definition.slice(0, definition.indexOf("\n);"));
      expect(body).toContain("FOREIGN KEY (");
      expect(body).toContain(", organization_id)");
    }
  });

  test("sync, source, row, and release evidence are all immutable", () => {
    for (const table of [
      "csf_application_decision_sync_runs",
      "csf_application_decision_sync_sources",
      "csf_application_decision_sync_rows",
      "csf_application_decision_releases",
    ]) {
      expect(staging).toContain(
        `BEFORE UPDATE OR DELETE ON plugin_data.${table}`,
      );
    }
    expect(staging).toContain("ERRCODE = '55000'");
  });

  test("the staged decision table cannot be read as a published one", () => {
    // A stage is only 'released' when it carries what was published.
    expect(staging).toContain("csf_application_decision_stages_released_is_complete");
    expect(staging).toContain("released_decision IS NOT NULL");
  });
});

describe("function ACLs", () => {
  for (const fn of FUNCTIONS) {
    test(`${fn.name} is ${fn.callable ? "callable by service_role only" : "internal"}`, () => {
      const signature = `plugin_data.${fn.name}(${fn.args})`;
      const revoke = fn.callable
        ? `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated;`
        : `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated, service_role;`;
      expect(all).toContain(revoke);
      if (fn.callable) {
        expect(all).toContain(
          `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
        );
      } else {
        expect(all).not.toContain(
          `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
        );
      }
    });
  }

  test("every created function is in the reviewed list", () => {
    const created = [
      ...all.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION plugin_data\.([a-z0-9_]+)\(/g,
      ),
    ].map((match) => match[1]);
    const reviewed = new Set<string>([
      ...FUNCTIONS.map((fn) => fn.name),
      // Replaced, not created here; their ACLs are asserted separately.
      "csf_decide_term_application",
      "csf_record_review_decision",
      // Wrapped by 20260917020000 so a staged decision follows the merge.
      "csf_profile_merge_reference_plan",
      "csf_merge_profiles",
    ]);
    for (const name of created) {
      expect(reviewed.has(name)).toBe(true);
    }
  });

  test("the replaced native decision paths keep their existing boundary", () => {
    expect(release).toContain(
      "REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)\n  FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(release).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text)\n  TO service_role;",
    );
  });

  test("every function pins an empty search path", () => {
    const definitions = all.split(/CREATE (?:OR REPLACE )?FUNCTION /).slice(1);
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.slice(0, definition.indexOf("AS $$"))).toContain(
        "SET search_path = ''",
      );
    }
  });
});

describe("the release gate cannot be bypassed", () => {
  test("both in-app decision paths refuse to publish in a Sheets-review term", () => {
    const guard = "csf_reject_native_decision_in_sheet_review";
    // The five-argument decide is what the request-aware overload calls.
    const decide = release.slice(
      release.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(",
      ),
    );
    expect(decide.slice(0, decide.indexOf("$$;"))).toContain(guard);

    const campaign = release.slice(
      release.indexOf(
        "CREATE OR REPLACE FUNCTION plugin_data.csf_record_review_decision(",
      ),
    );
    const campaignBody = campaign.slice(0, campaign.indexOf("$$;"));
    expect(campaignBody).toContain(guard);
    // Guarded before the publish, not after it.
    expect(campaignBody.indexOf(guard)).toBeLessThan(
      campaignBody.indexOf("csf_decide_term_application_policy_base"),
    );
  });

  test("staging refuses a term that is not in Sheets review", () => {
    expect(sync).toContain("CSF_SHEET_REVIEW_MODE=not_enabled");
  });

  test("source write-back is suppressed and the ledger fails closed", () => {
    expect(staging).toContain("application.sheet_writeback_suppressed");
    expect(staging).toContain("CSF_SHEET_REVIEW_MODE=write_back_disabled");
    // Scoped to the legacy application rows so export destinations keep working.
    expect(staging).toContain("IF NEW.destination_id IS NOT NULL OR NEW.application_id IS NULL THEN");
  });
});

describe("provenance is verified, not claimed", () => {
  test("the match basis is derived from recorded provenance, never from the payload", () => {
    // It appears in the receipt the caller reads back, never as an input key.
    expect(sync).not.toContain("'matchBasis'::");
    expect(sync).not.toMatch(/->>\s*'matchBasis'/);
    expect(sync).toContain(
      "WHEN nullif(entry.value ->> 'importRowId', '') IS NOT NULL THEN 'import_row_provenance'",
    );
  });

  test("a claimed application must be tied to the workbook that was read", () => {
    expect(sync).toContain("import_row.sheet_tab_name = source_plan.sheet_tab_name");
    expect(sync).toContain("import_job.source_file_id = source_plan.spreadsheet_file_id");
    expect(sync).toContain("import_row.matched_application_id = application.id");
    expect(sync).toContain("application.source_import_row_id = import_row.id");
    expect(sync).toContain("source.source_type = 'application_responses'");
  });

  test("the fallback basis compares a recorded response id, not file membership", () => {
    expect(sync).toContain(
      "application.google_form_response_id = parsed.response_id",
    );
    expect(sync).toContain("application.google_form_response_id IS NOT NULL");
    // The response id must resolve to exactly one application in the term.
    expect(sync).toContain("AND peer.id <> application.id");
    expect(sync).toContain(
      "OR application.source_submitted_at = parsed.response_submitted_at",
    );
  });

  test("no match basis exists for a name, a row position, or plain file membership", () => {
    const basisCheck = staging.slice(
      staging.indexOf("match_basis text NOT NULL CHECK"),
    );
    const values = basisCheck.slice(0, basisCheck.indexOf("))"));
    expect(values).not.toContain("name");
    expect(values).not.toContain("row_position");
    expect(values).not.toContain("stable_source_key");
    expect(values).toContain("import_row_provenance");
    expect(values).toContain("recorded_response_id");
  });

  test("a mapping edited after the read cannot apply obsolete column semantics", () => {
    expect(sync).toContain("mapping.mapping_version::text = (entry.value ->> 'mappingVersion')");
    expect(sync).toContain("'mapping_version_stale'");
    // Staleness outranks every other blocker: the columns themselves moved.
    const outcome = sync.slice(sync.indexOf("WHEN row_plan.match_basis = 'unmatched' THEN 'unmatched'"));
    expect(outcome.indexOf("NOT row_plan.mapping_current")).toBeLessThan(
      outcome.indexOf("NOT row_plan.provenance_verified"),
    );
  });

  test("the decision mapping is versioned behind a permission recheck", () => {
    expect(mappingFields).toContain("csf_set_application_decision_mapping");
    expect(mappingFields).toContain("'manage_sheet_sync'");
    expect(mappingFields).toContain(
      "+ CASE WHEN v_changed THEN 1 ELSE 0 END",
    );
  });

  test("a concurrent mapping save is refused under the row lock", () => {
    // The stored row is read FOR UPDATE before the version is compared, so the
    // loser of a race is rejected rather than merged over.
    const body = mappingFields.slice(
      mappingFields.indexOf("SELECT * INTO v_existing"),
    );
    expect(body.indexOf("FOR UPDATE")).toBeLessThan(
      body.indexOf("p_expected_version <> v_existing.mapping_version"),
    );
    expect(mappingFields).toContain("CSF_DECISION_MAPPING_VERSION=");
  });

  test("the mapping carries identity, scope, and colour configuration", () => {
    for (const column of ["identity_columns", "scope", "colors"]) {
      expect(mappingFields).toContain(`ADD COLUMN ${column} jsonb`);
    }
    // Banding is configuration, not a guess in the reader.
    expect(mappingFields).toContain("ignoredFills");
  });

  test("a reused request id is bound to its term and payload", () => {
    for (const source of [sync, release]) {
      expect(source).toContain("term_id IS DISTINCT FROM p_term_id");
      expect(source).toContain("request_fingerprint IS DISTINCT FROM v_fingerprint");
      expect(source).toContain("CSF_COMMITTED_REQUEST_OUTCOME=request_conflict");
    }
    expect(staging).toContain("request_fingerprint text NOT NULL");
  });

  test("two sources disagreeing is a conflict, never last-source-wins", () => {
    expect(sync).toContain("'cross_source_conflict'");
    expect(sync).toContain("row_plan.previous_source_id <> row_plan.source_id");
  });

  test("a provenance check that cannot be evaluated fails closed", () => {
    // Comparing a NULL column yields NULL, and `NOT NULL` is NULL, so an
    // unknown verification used to skip the fail-closed branch entirely.
    expect(provenanceNullSafety).toContain("coalesce(CASE");
    expect(provenanceNullSafety).toContain("END, false),");
    const verification = provenanceNullSafety.slice(
      provenanceNullSafety.indexOf("coalesce(CASE"),
    );
    const guarded = verification.slice(0, verification.indexOf("END, false),"));
    expect(guarded).toContain(
      "import_row.matched_application_id = application.id",
    );
  });

  test("two rows claiming one application are both ambiguous", () => {
    expect(sync).toContain("parsed.application_claims > 1");
    expect(sync).toContain("'ambiguous_match'");
  });
});

describe("publication semantics", () => {
  test("release reuses the existing atomic decision rather than a parallel one", () => {
    expect(publish).toContain("csf_decide_term_application_policy_base");
    expect(release).toContain("csf_publish_sheet_application_decision");
  });

  test("an officer's Sheet decision is recorded as external review, not computed eligibility", () => {
    expect(staging).toContain("ADD VALUE IF NOT EXISTS 'approved_sheet_review'");
    expect(staging).toContain("ADD VALUE IF NOT EXISTS 'rejected_sheet_review'");
    expect(publish).toContain("'decisionBasis', 'officer_external_sheet_review'");
    expect(publish).toContain("'academicPreflightEvaluated', false");
    // The base's own code is fine to describe; stamping it here would not be.
    expect(withoutComments(publish)).not.toContain("approved_standard");
  });

  test("a historical outcome is refused instead of rewritten", () => {
    expect(finalizedGuard).toContain("CSF_RELEASE_BLOCKER=historical_outcome");
    expect(finalizedGuard).toContain("IN ('completed', 'not_completed')");
  });

  test("an acceptance is held against a finalized outcome too", () => {
    // The first cut exempted `accepted`, so a green mark on a finished
    // semester republished an acceptance over it.
    expect(finalizedGuard).toContain(
      "IF v_membership.status IN ('completed', 'not_completed') THEN",
    );
    expect(finalizedGuard).not.toContain("IF p_decision <> 'accepted'");
    // The release planner holds every terminal verdict, not only a rejection.
    const heldBranches = finalizedGuard.split(
      "IN ('accepted', 'rejected', 'rejected_with_explanation')",
    ).length - 1;
    expect(heldBranches).toBe(2);
  });

  test("the current semester is picked deterministically", () => {
    expect(finalizedGuard).toContain(
      "ORDER BY term.starts_at DESC NULLS LAST, term.created_at DESC, term.id DESC",
    );
  });

  test("LEAST and GREATEST are not schema-qualified", () => {
    // They are SQL syntax; qualifying them fails to parse.
    for (const source of [release, finalizedGuard]) {
      expect(source).not.toContain("pg_catalog.greatest");
      expect(source).not.toContain("pg_catalog.least");
    }
  });

  test("an uncolored row after release retracts and revokes", () => {
    expect(publish).toContain("status = 'needs_review'");
    expect(publish).toContain("status = 'revoked'");
    expect(publish).toContain("application.sheet_review_");
  });

  test("release holds a blocked row instead of aborting the whole term", () => {
    expect(release).toContain("'held'");
    expect(release).toContain("'pending'");
    expect(release).toContain("held_count");
  });

  test("the new profile reference has a merge policy, not just a column", () => {
    expect(mergeOwnership).toContain(
      "'plugin_data.csf_application_decision_stages.profile_id'",
    );
    expect(mergeOwnership).toContain("sameTransactionRewrites");
    // The merge fails closed if any stage ends up on the wrong student.
    expect(mergeOwnership).toContain(
      "stage.profile_id IS DISTINCT FROM application.profile_id",
    );
    expect(mergeOwnership).toContain(
      "profile_merge.decision_stages_reassigned",
    );
    // Both renamed bases stay owner-only.
    for (const base of [
      "csf_profile_merge_reference_plan_decision_stages_base(uuid, uuid)",
      "csf_merge_profiles_decision_stages_base(uuid, uuid, uuid, text, uuid)",
    ]) {
      expect(mergeOwnership).toContain(
        `REVOKE ALL ON FUNCTION plugin_data.${base}\n  FROM PUBLIC, anon, authenticated, service_role, postgres;`,
      );
    }
  });

  test("nothing in this change sends or enqueues a message", () => {
    for (const forbidden of [
      "csf_publication_notification_deliveries",
      "csf_publication_events",
      "csf_communication",
      "campaign",
      "notification",
      "resend",
      "email",
    ]) {
      expect(executable.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
