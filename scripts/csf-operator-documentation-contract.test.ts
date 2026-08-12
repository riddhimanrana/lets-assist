import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The CSF operator documents quote the product's own control labels so an
 * officer can follow them click by click. A label that drifts in the plugin and
 * not in the document sends an operator hunting for a control that no longer
 * exists, which is exactly the failure these documents were rewritten to stop.
 *
 * This is a contract between two trees, so it asserts both directions: the
 * document still says the label, and the private plugin still renders it. It
 * deliberately checks only distinctive operator-facing strings -- a generic word
 * like "Settings" would pass against anything and prove nothing.
 *
 * Same shape as the private plugin's own source-contract tests
 * (`csf-communications-navigation.test.ts` and friends): read the file, assert
 * the exact string. No rendering, no fixtures, no database.
 */

const repositoryRoot = join(import.meta.dir, "..");
const pluginComponents = join(
  repositoryRoot,
  "lib/plugins/private/plugins/dvhs-csf/components",
);

if (!existsSync(pluginComponents)) {
  throw new Error(
    "The private plugin tree is missing. Run `bun run plugin:submodules:init` before this test; " +
      "the operator documentation contract cannot be checked against an absent source of truth.",
  );
}

function readDoc(name: string) {
  return readFileSync(join(repositoryRoot, "docs/csf", name), "utf8");
}

function readComponent(name: string) {
  return readFileSync(join(pluginComponents, name), "utf8");
}

/**
 * Prose wraps at 80 columns, so a quoted label routinely straddles a newline.
 * Collapsing whitespace lets the contract be about the words the operator reads
 * rather than about where the paragraph happens to break.
 */
function flow(text: string) {
  return text.replace(/\s+/gu, " ");
}

const operatorGuide = flow(readDoc("dvhs-fall-2026-operator-guide.md"));
const officerRunbook = flow(readDoc("officer-runbook.md"));
const productContract = flow(readDoc("product-contract.md"));

type LabelContract = {
  /** The component that renders it. */
  component: string;
  /** Exact operator-visible strings the documents quote. */
  labels: string[];
  /**
   * How the component spells it, when JSX escaping differs from prose.
   * Keyed by the document-side label.
   */
  sourceSpelling?: Record<string, string>;
};

const MEMBER_AND_ACCESS: LabelContract[] = [
  {
    component: "CsfProfileEditorDialogs.tsx",
    labels: [
      "Add member",
      "Add a student record",
      "Add student record",
      "Student record created.",
      "Account access comes next",
      "No active classes configured",
    ],
  },
  {
    component: "CsfAccountConnectionActions.tsx",
    labels: [
      "Class link",
      "Student link",
      "Create a reusable class link",
      "Create class link",
      "Reusable class link created.",
      "Create a student-specific link",
      "Create secure link",
      "Student-specific link is ready.",
      "Application form (optional)",
      "Student note",
      "Renew link",
      "Deactivate",
    ],
  },
  {
    component: "CsfInvitationDialogFields.tsx",
    labels: [
      "Unconnected student record",
      "Email on this student record",
      "Expires in days",
      "Internal label",
      "Link name",
    ],
  },
  {
    component: "CsfAccountConnectionsPanel.tsx",
    labels: [
      "Account connections",
      "Matches to review",
      "Student-specific links",
      "Reusable class links",
      "Student record search",
      "Search records",
      "First results",
      "More results",
      "First student records",
      "More student records",
      "Copy link",
      "Open link in new tab",
    ],
  },
  {
    component: "CsfAccountConnectionsModel.ts",
    labels: ["Recorded email changed"],
  },
  {
    component: "CsfResolveConnectionDialog.tsx",
    labels: [
      "Review account connection",
      "Review in Resolve",
      "Decision reason",
      "Reject request",
      "Connect account",
      "Connection unavailable",
      "Canonical identity evidence",
    ],
  },
];

const STAFF_ACCESS: LabelContract[] = [
  {
    component: "CsfStaffAccessWorkspace.tsx",
    labels: ["Officer roster", "Position seats"],
  },
  {
    component: "CsfStaffPositionDialogs.tsx",
    labels: [
      "Assign position",
      "Assign staff access",
      "CSF member profile",
      "Public title override",
      "Effective from",
      "Effective through",
      "Assign access",
      "Staff access assigned.",
      "Add position",
      "Add CSF position",
    ],
  },
  {
    component: "CsfPositionPermissionFields.tsx",
    labels: [
      "Capability changes to save",
      "Capabilities to grant",
      "Capabilities to remove",
    ],
  },
];

const CLASSES_AND_POLICY: LabelContract[] = [
  {
    component: "CsfClassTermCreateDialogs.tsx",
    labels: ["Set up graduating class", "Add one semester"],
  },
  {
    component: "CsfClassTermActionsMenu.tsx",
    labels: ["Term actions", "Set as current"],
  },
  {
    component: "CsfCohortHub.tsx",
    labels: ["Semesters & setup"],
    sourceSpelling: { "Semesters & setup": "Semesters &amp; setup" },
  },
  {
    component: "CsfPolicyPublicationControls.tsx",
    labels: ["Publish policy", "Publication reason"],
  },
];

const IMPORTS: LabelContract[] = [
  {
    component: "CsfGoogleSheetsConnectionPanel.tsx",
    labels: [
      "Google Sheets connection",
      "Reconnect required",
      "Not connected",
      "Switch or reconnect",
      "Switch account",
      "Recheck",
    ],
  },
  {
    component: "CsfSheetGoogleSource.tsx",
    labels: [
      "New Google Sheets import",
      "Start another import",
      "Record type",
      "Student roster",
      "Historical records",
      "Sheet tab",
      "Source range",
      "Header row",
      "A1 range",
      "Inspect columns",
      "Graduating class",
    ],
  },
  {
    component: "CsfSheetRangeInspection.tsx",
    labels: ["Column mapping", "Preview normalized rows"],
  },
  {
    component: "CsfSheetImportPreview.tsx",
    labels: [
      "Normalized snapshot",
      "Import blocked",
      "Recovery needed",
      "Verify source and commit",
      "Resume import",
      "Finish import",
    ],
  },
  {
    component: "CsfSheetPreviewRows.tsx",
    labels: ["Normalized rows"],
  },
  {
    component: "CsfImportRowPager.tsx",
    labels: ["First rows", "Previous rows", "Next rows"],
  },
];

const COMMUNICATIONS: LabelContract[] = [
  {
    component: "CsfCommunicationsWorkspace.tsx",
    labels: ["Delivery issues"],
  },
  {
    component: "CsfCommunicationsSettings.tsx",
    labels: ["Consent topic key", "Resend topic id"],
  },
  {
    component: "CsfCommunicationsCampaigns.tsx",
    labels: [
      "Finalize & queue",
      "This action does not call the email provider.",
    ],
  },
  {
    component: "CsfPostComposeDialog.tsx",
    labels: ["Also send this as an email"],
  },
];

const STUDENT_JOURNEY: LabelContract[] = [
  {
    component: "CsfDashboardContentSection1Connect.tsx",
    labels: [
      "We found your CSF record — is this you?",
      "Use this profile",
      "Not me",
    ],
  },
];

/** Every label must still be quoted by at least one operator document. */
const OPERATOR_DOCUMENTS = [operatorGuide, officerRunbook];

/**
 * Reports every drift in the group at once. Failing on the first mismatch would
 * hide the rest behind one rename, which is the opposite of useful when a label
 * sweep lands.
 */
function assertContract(group: LabelContract[]) {
  const drift: string[] = [];
  for (const { component, labels, sourceSpelling } of group) {
    const source = readComponent(component);
    for (const label of labels) {
      const rendered = sourceSpelling?.[label] ?? label;
      if (!source.includes(rendered)) {
        drift.push(
          `${component} no longer renders ${JSON.stringify(rendered)}`,
        );
      }
      if (!OPERATOR_DOCUMENTS.some((doc) => doc.includes(label))) {
        drift.push(`no operator document quotes ${JSON.stringify(label)}`);
      }
    }
  }
  expect(drift).toEqual([]);
}

describe("CSF operator documentation label contract", () => {
  test("members, account connections, and the review queue", () => {
    assertContract(MEMBER_AND_ACCESS);
  });

  test("staff access, position seats, and the capability preview", () => {
    assertContract(STAFF_ACCESS);
  });

  test("classes, semesters, and policy publication", () => {
    assertContract(CLASSES_AND_POLICY);
  });

  test("google connection and the import workspace", () => {
    assertContract(IMPORTS);
  });

  test("communications sections, settings, and queueing", () => {
    assertContract(COMMUNICATIONS);
  });

  test("the student-facing claim screen", () => {
    assertContract(STUDENT_JOURNEY);
  });
});

describe("CSF operator documentation truthfulness guards", () => {
  test("the capability preview is documented only where the UI renders it", () => {
    const dialogs = readComponent("CsfStaffPositionDialogs.tsx");
    // Only the edit dialog passes a baseline, so only editing can show a diff.
    expect(dialogs).toContain("<CsfPositionPermissionFields />");
    expect(dialogs).toContain("baselinePermissions");
    const fields = readComponent("CsfPositionPermissionFields.tsx");
    expect(fields).toContain(
      "{baselinePermissions ? (\n        <CsfPositionCapabilityPreview",
    );
    // The guide must not promise a diff on the create path.
    expect(operatorGuide).toContain(
      "**Add position** is a create form and shows no capability diff",
    );
  });

  test("the import progress strip is documented as derived, not navigable", () => {
    const overview = readComponent("CsfSheetImportOverview.tsx");
    expect(overview).toContain('aria-label="Import progress"');
    const controller = readComponent("CsfSheetImportWorkspaceController.ts");
    for (const stage of [
      "Source",
      "Scope",
      "Map",
      "Preview",
      "Reconcile",
      "Commit",
      "Result",
    ]) {
      expect(controller).toContain(`label: "${stage}"`);
    }
    expect(productContract).toContain(
      "The import workspace is not a step wizard.",
    );
    expect(productContract).not.toContain("### 12.2 Wizard steps");
    expect(operatorGuide).toContain("It is not a wizard");
  });

  test("row paging never stands in for whole-preview readiness", () => {
    const pager = readComponent("CsfImportRowPager.tsx");
    expect(pager).toContain(
      "Counts and import readiness describe the whole preview, not this page.",
    );
    expect(operatorGuide).toContain(
      "Counts and import readiness describe the whole preview, not this page.",
    );
  });

  test("queueing is never documented as delivery", () => {
    const campaigns = readComponent("CsfCommunicationsCampaigns.tsx");
    expect(campaigns).toContain(
      "This action does not call the email provider.",
    );
    expect(operatorGuide).toContain(
      "This action does not call the email provider.",
    );
    expect(operatorGuide).toContain(
      "Queued is not sent, and sent is not delivered",
    );
  });

  test("the Google connection is documented as bound to the acting user", () => {
    const importGoogle = readFileSync(
      join(
        repositoryRoot,
        "lib/plugins/private/plugins/dvhs-csf/server/actions/import-google.ts",
      ),
      "utf8",
    );
    // The binding is read for context.userId, so it is per-operator by construction.
    expect(importGoogle).toContain(
      "getGoogleOAuthConnectionForBinding(\n      context.userId,",
    );
    expect(operatorGuide).toContain(
      "**The connection is stored against the Let's Assist account that completed it.**",
    );
    expect(productContract).toContain(
      "cannot be completed on another operator's behalf",
    );
  });

  test("the recovery-seat floor is quoted from the migration, not paraphrased", () => {
    const migration = readFileSync(
      join(
        repositoryRoot,
        "supabase/migrations/20260811160000_dvhs_csf_recovery_seat_floor.sql",
      ),
      "utf8",
    );
    const revokeMessage =
      "This is the last active position that can still manage CSF staff access.";
    const updateMessage =
      "This change would leave no active position able to manage CSF staff access.";
    expect(migration).toContain(revokeMessage);
    expect(migration).toContain(updateMessage);
    expect(operatorGuide).toContain(revokeMessage);
    expect(operatorGuide).toContain(updateMessage);
  });

  test("coordinate uniqueness in the contract matches the shipped index", () => {
    const migration = readFileSync(
      join(
        repositoryRoot,
        "supabase/migrations/20260730001001_dvhs_csf_recovery_foundations.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX csf_sheet_import_rows_job_coordinate_idx",
    );
    expect(migration).toContain("(job_id, sheet_tab_name, row_number)");
    expect(productContract).toContain(
      "`csf_sheet_import_rows_job_coordinate_idx` is `UNIQUE (job_id, sheet_tab_name, row_number)`",
    );
    // The semantic invariant must survive the correction.
    expect(productContract).toContain(
      "`(organization, source, tab, row, row_hash, mapping_version)` is the semantic identity of a previewed source version.",
    );
    expect(productContract).toContain(
      "Recommitting the same resolved row returns the existing target result.",
    );
  });
});
