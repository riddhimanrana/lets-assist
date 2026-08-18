import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function readRepositoryFile(name: string) {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

function flow(text: string) {
  return text.replace(/\s+/gu, " ");
}

function between(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

const operatorGuide = flow(
  readRepositoryFile("docs/csf/dvhs-fall-2026-operator-guide.md"),
);
const officerRunbook = flow(readRepositoryFile("docs/csf/officer-runbook.md"));
const testingAndRelease = flow(
  readRepositoryFile("docs/csf/testing-and-release.md"),
);
const productionCutoverRunbook = flow(
  readRepositoryFile("docs/development/production-cutover-runbook.md"),
);
const cleanupRegister = flow(
  readRepositoryFile("docs/development/cleanup-register.md"),
);
const csfCommunicationsActions = readRepositoryFile(
  "lib/plugins/private/plugins/dvhs-csf/communications-actions.ts",
);
const csfCommunicationsActionsTest = readRepositoryFile(
  "lib/plugins/private/plugins/dvhs-csf/services/communications-actions.test.ts",
);

describe("CSF release-state documentation truthfulness guards", () => {
  test("current status separates the repository ledger from hosted database and deployed code", () => {
    const migrations = readdirSync(join(repositoryRoot, "supabase/migrations"))
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(318);
    expect(migrations.at(-1)).toBe(
      "20260818040246_generalize_private_plugin_storage_and_publish_dvhs_csf_1_1_0.sql",
    );

    const currentState = between(
      testingAndRelease,
      "## Current hosted Development state",
      "## Historical pre-hardening Development state",
    );
    expect(currentState).toContain(
      "sole current CSF implementation/status register is",
    );
    expect(currentState).toContain(
      "repository candidate has 318 ordered migrations through",
    );
    expect(currentState).toContain(
      "`20260816185321_enforce_authoritative_plugin_releases`",
    );
    expect(currentState).toContain(
      "`20260816190454_durable_paper_signup_notifications`",
    );
    expect(currentState).toContain(
      "`20260817010000_csf_source_evidence_revision_deadlock`",
    );
    expect(currentState).toContain(
      "`20260817022000_csf_permanent_class_code_join`",
    );
    expect(currentState).toContain("`20260817050000_publish_dvhs_csf_1_0_0`");
    expect(currentState).toContain(
      "`20260817110500_csf_current_school_year_consequential_authority`",
    );
    expect(currentState).toContain(
      "`20260817114700_repin_dvhs_csf_1_0_0_source`",
    );
    expect(currentState).toContain(
      "`20260817132000_restore_multi_date_meeting_permission_rechecks`",
    );
    expect(currentState).toContain(
      "`20260817133000_consolidate_plugin_version_read_policies`",
    );
    expect(currentState).toContain(
      "`20260818040246_generalize_private_plugin_storage_and_publish_dvhs_csf_1_1_0`",
    );
    expect(currentState).toContain("Hosted Development serves exact root merge SHA");
    expect(currentState).toContain("migration-current at 317 rows through");
    expect(currentState).toContain(
      "Production remains untouched at the audited 236-row baseline",
    );
    expect(currentState).toContain(
      "exact read-only preflight now expects an 82-migration cutover",
    );
    expect(currentState).toContain("fresh exact 318-migration replay");
    expect(currentState).toContain("155 pgTAP files with 5,833 assertions");
    expect(currentState).toContain("6fd34120ab474cbf6db3b5fd47439324bc436345");
    expect(currentState).toContain("4d1001e9d3269b8bd28de93c071c6b4b216824fd");
    expect(currentState).toContain(
      "04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79",
    );
    expect(currentState).toContain("5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5");
    expect(currentState).toContain(
      "Real CSF sources remain immutable-preview-only",
    );
    expect(currentState).toContain("Class of 2030 is template-only");
    expect(currentState).toContain("no real-row commit");

    const externalGates = between(
      testingAndRelease,
      "### External and action-time gates",
      "## Artifact index",
    );
    expect(externalGates).toContain("repository branch has 293 through");
    expect(externalGates).toContain(
      "`20260813013300_close_csf_representative_and_publication_races`",
    );
    expect(externalGates).toContain(
      "`20260813020000_cancellation_preserves_unknown_delivery_outcomes`",
    );
    expect(externalGates).toContain(
      "`20260813085442_harden_private_is_plugin_enabled_acl`",
    );
    expect(externalGates).toContain(
      "`20260813091801_harden_dv_private_policy_helper_acls`",
    );
    expect(testingAndRelease).toContain(
      "That table is the superseded July source snapshot",
    );
    expect(testingAndRelease).toContain(
      "current reviewed Spring 2026 application source is bounded to `A1:Q518`",
    );
    expect(testingAndRelease).toContain(
      "earlier 618-row/23-column shape must not be used",
    );
  });

  test("the officer runbook tracks the exact current cutover ledger", () => {
    expect(officerRunbook).toContain(
      "this repository carries 318 ordered migrations through `20260818040246_generalize_private_plugin_storage_and_publish_dvhs_csf_1_1_0`",
    );
    expect(officerRunbook).toContain(
      "exact repository-pinned 82-migration cutover",
    );
    expect(officerRunbook).toContain("ordered ledger through `20260818040246`");
    expect(officerRunbook).not.toContain(
      "this repository carries 277 ordered migrations",
    );
    expect(officerRunbook).not.toContain(
      "41-migration Production cutover gates remain pending",
    );
  });

  /**
   * Two kinds of claim live in these documents and they must never be edited
   * together.
   *
   * A DATED RECORD says what someone observed on one run: the rehearsal section
   * below, with its "was verified as", "Preview failed while sealing", and
   * "Production was not changed by this rehearsal". Its numbers are evidence of
   * that run. Rewriting them to today's values would not correct an error, it
   * would destroy the record.
   *
   * A CURRENT-STATE or FORWARD-LOOKING claim must track reality: the "Current
   * hosted Development state" section above, and the "Production cutover
   * checklist" at the end of this test, which has to agree with
   * scripts/production-cutover-preflight.sql.
   *
   * The two carry near-identical strings -- "... ordered migrations through ...",
   * "The N repository-only migrations are", and the union-replay evidence line
   * -- so a global find-and-replace across this file silently rewrites the
   * record's assertions into asserting values the record does not contain. The
   * failure looks like a passing edit until the suite runs. Scope every edit to
   * one block at a time.
   */
  test("the dated rehearsal record stays internally consistent with itself", () => {
    const rehearsalState = between(
      operatorGuide,
      "## Development rehearsal state at this guide's verification point",
      "## Production cutover checklist",
    );
    expect(rehearsalState).toContain(
      "`cf330e5faa844d63a2f41c8f0be4d1c727d51a47`",
    );
    expect(rehearsalState).toContain(
      "Hosted Development Supabase remains at 273 ordered migrations through",
    );
    expect(rehearsalState).toContain(
      "this repository has 292 through `20260815100500_dvhs_csf_application_queue_projection`",
    );
    expect(rehearsalState).toContain(
      "The nineteen repository-only migrations are",
    );
    expect(rehearsalState).toContain(
      "`20260812203500_close_plugin_data_browser_default_acl`",
    );
    expect(rehearsalState).toContain(
      "`20260812132725_csf_drive_metadata_compare_and_set_fence`",
    );
    expect(rehearsalState).toContain(
      "`20260812152300_atomic_csf_post_replies`",
    );
    expect(rehearsalState).toContain(
      "`20260813013200_recheck_csf_activity_partner_authorization_under_lock`",
    );
    expect(rehearsalState).toContain(
      "`20260813013300_close_csf_representative_and_publication_races`",
    );
    expect(rehearsalState).toContain(
      "`20260813020000_cancellation_preserves_unknown_delivery_outcomes`",
    );
    expect(rehearsalState).toContain(
      "`20260813085442_harden_private_is_plugin_enabled_acl`",
    );
    expect(rehearsalState).toContain(
      "`20260813091801_harden_dv_private_policy_helper_acls`",
    );
    expect(rehearsalState).toContain(
      "`20260812161500_atomic_project_signup_rejection`",
    );
    expect(rehearsalState).toContain(
      "`20260812220000_csf_meeting_permission_followups`",
    );
    expect(rehearsalState).toContain(
      "`20260813010000_atomic_ai_quota_receipts`",
    );
    expect(rehearsalState).toContain(
      "exact local isolated union replay passed all 292 migrations and 142 pgTAP files with 5,785 assertions and 84 CSF tables present",
    );
    expect(rehearsalState).toContain("`20260814051720` adds the service-only");
    expect(rehearsalState).toContain(
      "not been applied or deployed to any hosted database",
    );
    expect(rehearsalState).toContain(
      "`20260812193400_protect_staff_invite_issuer_capability`",
    );
    expect(rehearsalState).toContain(
      "`20260813013100_lock_project_lifecycle_transactions`",
    );
    expect(rehearsalState).toContain(
      "`20260813013000_reconcile_project_lifecycle_boundaries`",
    );
    expect(rehearsalState).toContain(
      "external Vercel 100-deployment-per-day project cap",
    );
    expect(rehearsalState).toContain("deployment is Ready but stale");
    expect(rehearsalState).toContain(
      "They have not been re-established for either hosted 273 or repository 292",
    );
    expect(rehearsalState).toContain(
      "seven-argument metadata RPC exists, the old four-argument overload is absent",
    );
    expect(rehearsalState).toContain(
      "only `service_role` can execute the current RPC",
    );
    expect(rehearsalState).toContain("Google OAuth and Picker are connected");
    expect(rehearsalState).toContain("`A1:Q518`");
    expect(rehearsalState).toContain(
      "passed the metadata RPC and appended 85 stored preview rows",
    );
    expect(rehearsalState).toContain(
      "failed while sealing because the caller summary wrongly stated the reserved derived `rows` key",
    );
    expect(rehearsalState).toContain("one failed preview job");
    expect(rehearsalState).toContain("zero term applications were committed");
    expect(rehearsalState).toContain("No names or email addresses");
    expect(rehearsalState).toContain(
      "current root gitlink is `cdbeb59e6cc086e8794ec8b35157ab043f65c01c`",
    );
    expect(rehearsalState).toContain(
      "locally known private `origin/development` still ends at `605342ca8a3f2d83c4a7b40abf60ba03b9f12b5b`",
    );
    expect(rehearsalState).toContain(
      "current target is not contained there and remains a local-only, private-first release blocker",
    );
    expect(rehearsalState).not.toContain(
      "Preview failed before reading or importing rows because the seven-argument RPC was missing",
    );
    expect(rehearsalState).toContain("Production was not changed");

    const cutover = between(
      operatorGuide,
      "## Production cutover checklist",
      "## Related references",
    );
    expect(cutover).toContain(
      "Replay the ordered migration ledger through `20260815110000`",
    );
    expect(cutover).toContain(
      "`scripts/production-cutover-preflight.sql` with the reviewed Production read-only URL",
    );
    expect(cutover).toContain("exact 236-row baseline");
    expect(cutover).toContain("full 57-migration transition");
    expect(cutover).toContain("preflight on the 293-row target");
  });

  test("production cutover baseline tracks the exact pending migration range", () => {
    expect(productionCutoverRunbook).toContain(
      "Production was last verified read-only at 236 ordered migrations through `20260811001500`",
    );
    expect(productionCutoverRunbook).toContain(
      "current repository release candidate has exactly 318 ordered migrations through `20260818040246_generalize_private_plugin_storage_and_publish_dvhs_csf_1_1_0`",
    );
    expect(productionCutoverRunbook).toContain(
      "read-only preflight pins an exact 82-migration tail",
    );
    expect(productionCutoverRunbook).toContain(
      "current-school-year staff authority",
    );
    expect(productionCutoverRunbook).toContain(
      "server-only rich link preview storage",
    );
    expect(productionCutoverRunbook).toContain(
      "source-attested DVHS CSF `1.1.0` publication",
    );
    expect(productionCutoverRunbook).toContain(
      "Hosted Development database parity",
    );
    expect(productionCutoverRunbook).toContain(
      "fresh full 318-migration replay",
    );
    expect(productionCutoverRunbook).not.toContain("38 pending migrations");
    expect(productionCutoverRunbook).not.toContain("exactly 38 pending");
    expect(testingAndRelease).not.toContain(
      "repository branch each have 273 ordered migrations",
    );
    expect(productionCutoverRunbook).toContain(
      "both the hosted and Production release gates remain open",
    );
    const preflightRunbook = between(
      productionCutoverRunbook,
      "## Preflight",
      "## Rehearsal",
    );
    expect(preflightRunbook).toMatch(
      /set -euo pipefail[\s\S]*?psql -X "\$PRODUCTION_READONLY_URL"[\s\S]*?\| tee preflight-/u,
    );
    const rehearsalRunbook = between(
      productionCutoverRunbook,
      "## Rehearsal",
      "## Backup",
    );
    expect(rehearsalRunbook).toMatch(
      /set -euo pipefail[\s\S]*?supabase link --project-ref <branch-ref>[\s\S]*?supabase db push --linked --dry-run[\s\S]*?time supabase db push --linked --yes 2>&1 \| tee rehearsal\.log/u,
    );
    const backupRunbook = between(
      productionCutoverRunbook,
      "## Backup",
      "## The window",
    );
    expect(backupRunbook).toContain("set -euo pipefail");
    expect(productionCutoverRunbook).toContain(
      "only D6 has the script's explicit reviewed-transition acceptance path",
    );
    expect(productionCutoverRunbook).not.toContain(
      "passes, or each deviation is adjudicated in writing",
    );
    expect(productionCutoverRunbook).not.toContain(
      "Its 271-migration ledger proves ordered application",
    );
    expect(productionCutoverRunbook).not.toContain("174 pending migrations");
    expect(productionCutoverRunbook).not.toContain(
      "repository ledger is at 223",
    );
    expect(productionCutoverRunbook).not.toContain(
      "T1–T7 run only on the 286 shape",
    );
    expect(productionCutoverRunbook).not.toContain(
      "expect exactly 174 pending",
    );
    expect(productionCutoverRunbook).toContain("Production remains untouched");
    expect(productionCutoverRunbook).toContain(
      "No release may proceed until hosted Development exact-SHA browser and provider gates are green",
    );
  });

  test("AUD-036 states the exact nine-function and publication-race scope", () => {
    const aud036 = between(cleanupRegister, "| AUD-036", "| AUD-037");

    expect(aud036).toContain(
      "`20260813013200_recheck_csf_activity_partner_authorization_under_lock.sql`",
    );
    expect(aud036).toContain(
      "`20260813013300_close_csf_representative_and_publication_races.sql`",
    );
    expect(aud036).toContain("Nine service-only CSF transactions");
    expect(aud036).toContain("representative assignment and revocation");
    expect(aud036).toContain("same advisory and term row locks");
    expect(aud036).toContain(
      "split 47+26 assertion autocommit dblink pgTAP suite",
    );
    expect(aud036).toContain(
      "exact 292-migration/142-file replay passed 5,785 assertions",
    );
    expect(aud036).toContain("Hosted Development acceptance remains pending");
  });

  test("AUD-037 keeps the private caller wording open without claiming a root fix", () => {
    const aud037 = between(
      cleanupRegister,
      "| AUD-037",
      "### Integrated project/auth findings",
    );

    expect(aud037).toContain("CSF plugin (private repo)");
    expect(aud037).toContain("Repository-side scope is closed");
    expect(aud037).toContain(
      "supabase/tests/contracts/csf_activity_partner_authorization_lock_source.test.ts",
    );
    expect(aud037).toContain("private plugin repository");
    expect(aud037).toContain("Not fixable from this repository");
  });

  test("CLEAN-022 is source-complete locally but release-blocked without overstating acceptance", () => {
    const clean022 = between(cleanupRegister, "| CLEAN-022", "| AUD-030");

    expect(clean022).toContain(
      "`20260813020000_cancellation_preserves_unknown_delivery_outcomes.sql`",
    );
    expect(clean022).toContain(
      "Cancellation replays recompute current ambiguous-delivery and unexpired processing-lease counts under the campaign lock",
    );
    expect(clean022).toContain(
      "settlement reserve plus the minimum provider window before acknowledging a scheduler reservation or advancing fairness",
    );
    expect(clean022).toContain(
      "Source-complete at the repository-local/source-contract level, but not publishable",
    );
    expect(clean022).toContain("root gitlink commit `8419171d`");
    expect(clean022).toContain("`cdbeb59e6cc086e8794ec8b35157ab043f65c01c`");
    expect(clean022).toContain("`49266bf`");
    expect(clean022).toContain("`cdbeb59e`");
    expect(clean022).toContain("`communications-actions.ts` types the outcome");
    expect(clean022).toContain("(`CsfCancellationOutcome`");
    expect(clean022).toContain(
      "`components/CsfCommunicationsActions.tsx` closes the cancel dialog only for the `clean` outcome",
    );
    expect(clean022).toContain(
      "accessible `ActionStatus` polite status region",
    );
    expect(clean022).toContain(
      "`components/CsfCommunicationsCampaigns.tsx` hosts that dialog per campaign card",
    );
    expect(clean022).not.toContain(
      "`lib/plugins/private/plugins/dvhs-csf/communications-actions.ts`:",
    );
    expect(clean022).toContain(
      "`lib/plugins/private/plugins/dvhs-csf/services/communications-actions.test.ts`",
    );
    expect(clean022).toContain(
      "exact `cdbeb59e` target is local-only and not contained in the locally known private `origin/development`",
    );
    expect(clean022).toContain(
      "strict root release check must fail until the private commit merges first",
    );
    expect(clean022).toContain(
      "full exact-tree local isolated replay, Docker-backed verification, hosted Development acceptance, provider/browser gates, and Production remain unverified and pending",
    );
    expect(clean022).toContain(
      "does not imply deployment or runtime database acceptance",
    );
    expect(clean022).not.toContain("full local isolated replay passed");
    expect(clean022).not.toContain(
      "private officer-message dependency remains pending",
    );
    expect(clean022).not.toContain("is not fully closed");
  });

  test("the integrated private cancellation module backs the CLEAN-022 source-completion claims", () => {
    expect(csfCommunicationsActions).toContain(
      'export type CsfCancellationOutcome =\n  "clean" | "ambiguous" | "leased" | "ambiguous_and_leased";',
    );
    expect(csfCommunicationsActions).toContain(
      "cancellationOutcome: cancellationOutcome(cancellation)",
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("closes after a clean cancellation"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      "shouldCloseCancelCampaignDialog",
    );
    expect(csfCommunicationsActionsTest).toContain(
      "uses warning toast styling for attention outcomes and success for clean outcomes",
    );
    expect(csfCommunicationsActionsTest).toContain(
      "keeps the empty polite status region mounted and out of footer spacing",
    );

    expect(csfCommunicationsActionsTest).toContain(
      'describe("CSF campaign cancellation result"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("reports a clean cancellation only when no work remains ambiguous or leased"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'cancellationOutcome: "clean"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      "Campaign cancelled. Outstanding work was settled; no retry was scheduled.",
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("reports deliveries that remain queued and under review without recipient data"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'cancellationOutcome: "ambiguous"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      "1 delivery remains queued and under review because its provider outcome is uncertain. Do not retry it; reconcile it from provider evidence.",
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("reports attempts that remain leased and may still settle"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'cancellationOutcome: "leased"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      "2 delivery attempts are still leased and may still settle. Do not retry them; reload the campaign and review the resulting delivery outcomes.",
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("reports one ambiguous delivery and one leased attempt with exact combined grammar"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'test("reports plural ambiguous deliveries and leased attempts with exact combined grammar"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      'cancellationOutcome: "ambiguous_and_leased"',
    );
    expect(csfCommunicationsActionsTest).toContain(
      "Do not retry this outstanding work; reconcile uncertain outcomes from provider evidence and reload the campaign to review leased attempts after they settle.",
    );
    expect(csfCommunicationsActionsTest).toContain(
      "2 deliveries remain queued and under review because their provider outcomes are uncertain. 3 delivery attempts are still leased and may still settle.",
    );
  });

  test("the register records the current cross-branch AUD identifier drift", () => {
    const preamble = between(
      cleanupRegister,
      "# Repository cleanup register",
      "## Repository-owned P0–P2",
    );

    expect(preamble).toMatch(
      /`AUD-` identifiers are allocated per branch[\s\S]*Current `development` includes the merged #152, #158, #174, #177, #179, and #181 findings[\s\S]*open #180[\s\S]*retains `AUD-036` and `AUD-037`[\s\S]*merged meeting findings/u,
    );
  });

  test("the release pin is exact while hosted and Production gates remain open", () => {
    expect(testingAndRelease).toContain(
      "repository candidate has 318 ordered migrations through",
    );
    expect(productionCutoverRunbook).toContain(
      "typed read-only preflight pins an exact 82-migration tail",
    );
    expect(productionCutoverRunbook).toContain(
      "Executing it requires explicit action-time authorization",
    );
    const preflight = flow(
      readRepositoryFile("scripts/production-cutover-preflight.sql"),
    );
    expect(preflight).toContain("repository target 318");
    expect(preflight).toContain("exact 82-row tail");
  });

  test("testing and release states the exact nine-function and publication scope", () => {
    expect(testingAndRelease).toContain(
      "closes the CSF activity and partner-club stale-authority",
    );
    for (const operation of [
      "csf_create_activity",
      "csf_update_activity",
      "csf_set_activity_status",
      "csf_link_activity_project",
      "csf_set_partner_club_status",
      "csf_set_partner_club_term_status",
      "csf_upsert_partner_club_policy",
      "csf_assign_partner_representative",
      "csf_revoke_partner_representative",
    ]) {
      expect(testingAndRelease).toContain(`\`${operation}\``);
    }
    expect(testingAndRelease).toContain("**Intentional behavior change:**");
    expect(testingAndRelease).toContain(
      "never as proof that the write did not happen",
    );
    expect(testingAndRelease).toContain(
      "Activity publication now takes the term-close advisory and term row locks",
    );
  });
});
