import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

function readRepositoryFile(name: string) {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

/**
 * Prose wraps at 80 columns, so a quoted label routinely straddles a newline.
 * Collapsing whitespace lets the contract be about the words the operator reads
 * rather than about where the paragraph happens to break.
 */
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

function expectInOrder(text: string, labels: string[]) {
  let cursor = 0;
  for (const label of labels) {
    const nextIndex = text.indexOf(label, cursor);
    expect(nextIndex).toBeGreaterThanOrEqual(cursor);
    cursor = nextIndex + label.length;
  }
}

const operatorGuide = flow(readDoc("dvhs-fall-2026-operator-guide.md"));
const officerRunbook = flow(readDoc("officer-runbook.md"));
const productContract = flow(readDoc("product-contract.md"));
const testingAndRelease = flow(readDoc("testing-and-release.md"));
const productionCutoverRunbook = flow(
  readRepositoryFile("docs/development/production-cutover-runbook.md"),
);

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

const APPLICATIONS: LabelContract[] = [
  {
    component: "CsfApplicationsWorkspaceSupporting.tsx",
    labels: ["Application checks"],
  },
  {
    component: "CsfApplicationsWorkspaceReview.tsx",
    labels: [
      "Application history",
      "Decision preflight",
      "Decision record",
      "Term membership",
      "Approval blocked",
    ],
  },
  {
    component: "CsfApplicationReviewDialog.tsx",
    labels: [
      "Record decision",
      "Review notes",
      "Request changes",
      "Approve application",
      "Reject",
      "Decision already saved; reload required",
      "Decision request conflict; reload required",
      "Reload application",
    ],
  },
];

const SERVICE_AND_POINTS: LabelContract[] = [
  {
    component: "CsfFormControls.tsx",
    labels: ["Save draft", "Publish activity"],
  },
  {
    component: "CsfServiceActivitiesView.tsx",
    labels: ["Published"],
  },
  {
    component: "CsfServicePointsView.tsx",
    labels: ["Point submissions", "CSF point awards"],
  },
  {
    component: "CsfSubmissionReviewDialog.tsx",
    labels: [
      "Review",
      "Awarded points",
      "Review notes",
      "Request changes",
      "Reject",
      "Approve award",
    ],
  },
  {
    component: "CsfPointCorrectionDialog.tsx",
    labels: ["Update and resubmit"],
  },
];

const POSTS: LabelContract[] = [
  {
    component: "CsfPostComposeDialog.tsx",
    labels: [
      "Save as draft",
      "Publish now",
      "Schedule for later",
      "Post saved",
      "Publish post",
      "Schedule post",
      "Also send this as an email",
      "Post saved; email not queued",
      "Post saved; email status unknown",
      "Email queued",
      "Email not queued",
      "Email queue status unknown",
    ],
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
      "Finalize content",
      "Snapshot audience",
      "Finalize & queue",
      "Recipient ledger",
      "Provider attempts",
      "This action does not call the email provider.",
    ],
  },
];

const STUDENT_JOURNEY: LabelContract[] = [
  {
    component: "CsfDashboardContentSection1Connect.tsx",
    labels: [
      "We found your CSF record — is this you?",
      "Yes, connect this record",
      "Not me",
      "Use this profile",
      "Add profile details",
      "Find my record",
    ],
  },
  {
    component: "CsfDirectInvitationAcceptForm.tsx",
    labels: ["Accept invitation"],
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

  test("applications preserve preflight, decision, and reload labels", () => {
    assertContract(APPLICATIONS);
  });

  test("activities and point reviews preserve their decision labels", () => {
    assertContract(SERVICE_AND_POINTS);
  });

  test("post persistence and email queue outcomes remain separate", () => {
    assertContract(POSTS);
  });

  test("communications sections, settings, and queueing", () => {
    assertContract(COMMUNICATIONS);
  });

  test("the student-facing claim screen", () => {
    assertContract(STUDENT_JOURNEY);
  });
});

describe("CSF operator documentation truthfulness guards", () => {
  test("the guide keeps the three student connection paths distinct", () => {
    const candidateSource = readComponent(
      "CsfDashboardContentSection1Connect.tsx",
    );
    expectInOrder(candidateSource, [
      "We found your CSF record — is this you?",
      "Not me",
      "Yes, connect this record",
    ]);
    expect(readComponent("CsfDirectInvitationAcceptForm.tsx")).toContain(
      "Accept invitation",
    );
    expectInOrder(candidateSource, ["Add profile details", "Find my record"]);

    const candidatePath = between(
      operatorGuide,
      "**Candidate claim",
      "**Direct student-specific invitation",
    );
    expectInOrder(candidatePath, [
      "We found your CSF record — is this you?",
      "Yes, connect this record",
      "Not me",
    ]);
    expect(candidatePath).not.toContain("Use this profile");

    const directPath = between(
      operatorGuide,
      "**Direct student-specific invitation",
      "**No automatic match",
    );
    expect(directPath).toContain("Accept invitation");

    const noMatchPath = between(
      operatorGuide,
      "**No automatic match",
      "Use this profile",
    );
    expectInOrder(noMatchPath, [
      "Add profile details",
      "Find my record",
      "Matches to review",
    ]);
  });

  test("organization creation is documented from the guarded route and form", () => {
    const page = readRepositoryFile("app/organization/create/page.tsx");
    const organizations = readRepositoryFile(
      "app/organization/OrganizationsDisplay.tsx",
    );
    const form = readRepositoryFile(
      "app/organization/create/OrganizationCreator.tsx",
    );
    const actions = readRepositoryFile("app/organization/create/actions.ts");
    expect(page).toContain('redirect("/login?redirect=/organization/create")');
    expect(page).toContain("Only Trusted Members can create organizations.");
    expect(organizations).toContain('href="/organization/create"');
    expect(organizations).toContain("Create Organization");
    for (const label of [
      "Organization Name *",
      "Username *",
      "Description *",
      "Website",
      "Organization Type *",
      "Create Organization",
    ]) {
      expect(form).toContain(label);
    }
    expect(form).toContain("router.push(`/organization/${data.username}`)");
    expect(actions).toContain('role: "admin"');

    const createPath = between(
      operatorGuide,
      "**Find or create the organization.",
      "**Entitle the plugin",
    );
    expectInOrder(createPath, [
      "**Organizations**",
      "**Create Organization**",
      "`/organization/create`",
      "**Organization Name** = `DVHigh CSF`",
      "**Username** = `dvhighcsf`",
      "**Description**",
      "**Website** = `https://www.dvhighcsf.org`",
      "**Organization Type**",
      "**Create Organization**",
      "`admin`",
      "`/organization/dvhighcsf`",
    ]);
  });

  test("plugin entitlement and install use the current routes and controls", () => {
    const controlPlane = readRepositoryFile(
      "app/admin/plugins/PluginControlPlane.tsx",
    );
    const organizationPlugins = readRepositoryFile(
      "app/organization/[id]/settings/OrganizationPluginSettings.tsx",
    );
    const pluginManifest = readComponent("../plugin-manifest.ts");
    for (const label of [
      "Access",
      "Organization access",
      "Starts at (optional)",
      "Ends at (optional)",
      "Force plugin for organization (managed install)",
      "Save entitlement",
    ]) {
      expect(controlPlane).toContain(label);
    }
    expect(pluginManifest).toContain('name: "DVHS CSF"');
    expect(pluginManifest).toContain("key: DVHS_CSF_PLUGIN_KEY");
    const organizationPluginLabels = flow(organizationPlugins);
    for (const label of [
      "Organization Plugins",
      "Open plugin marketplace",
      "Available to install",
      "Install",
      "This plugin requests access to:",
      "I approve installing this plugin and grant the requested access.",
      "Install Plugin",
    ]) {
      expect(organizationPluginLabels).toContain(label);
    }

    const entitlementPath = between(
      operatorGuide,
      "**Entitle the plugin",
      "**Install the plugin",
    );
    expectInOrder(entitlementPath, [
      "`/admin/plugins`",
      "**Catalog**",
      "**Catalog source of truth**",
      "**Access**",
      "**Organization access**",
      "**Organization** = `DVHigh CSF`",
      "**Plugin** = `DVHS CSF`",
      "**Status** = **Active**",
      "**Force plugin for organization (managed install)**",
      "**Save entitlement**",
    ]);

    const installPath = between(
      operatorGuide,
      "**Install the plugin",
      "**Create the graduating classes",
    );
    expectInOrder(installPath, [
      "`/organization/dvhighcsf/settings#organization-plugins`",
      "**Organization Plugins**",
      "**Open plugin marketplace**",
      "**Available to install**",
      "**DVHS CSF**",
      "**Install**",
      "**This plugin requests access to:**",
      "**I approve installing this plugin and grant the requested access.**",
      "**Install Plugin**",
    ]);
  });

  test("future semesters are prepared without changing the current term", () => {
    const createDialogs = readComponent("CsfClassTermCreateDialogs.tsx");
    const terms = readComponent("CsfClassTerms.tsx");
    const actions = readComponent("CsfClassTermActionsMenu.tsx");
    expect(flow(createDialogs)).toContain(
      "create its eight semester records automatically",
    );
    expect(terms).toContain("View semester history");
    for (const label of [
      "Term actions",
      "Edit term",
      "Term label",
      "Start date",
      "End date",
      "Applications open",
      "Applications close",
      "Sheet tab",
      "Status",
      "Save term",
      "Set as current",
    ]) {
      expect(actions).toContain(label);
    }

    const futurePath = between(
      operatorGuide,
      "**Prepare Spring 2027 and Fall 2027",
      "Steps 4",
    );
    expectInOrder(futurePath, [
      "**View semester history**",
      "**Spring 2027** (`S27`)",
      "**Fall 2027** (`F27`)",
      "**Term actions → Edit term**",
      "**Term label**",
      "**Start date**",
      "**End date**",
      "**Applications open**",
      "**Applications close**",
      "**Sheet tab**",
      "**Status**",
      "**Save term**",
      "**Set as current**",
    ]);
    expect(futurePath).toContain("do not select **Set as current**");
  });

  test("staff assignment has one navigation step", () => {
    expect(
      operatorGuide.match(/Open \*\*More → Staff access\*\*/gu)?.length ?? 0,
    ).toBe(1);
  });

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

  test("the application seed precedes class-history records and commit", () => {
    const sourceOrder = between(
      operatorGuide,
      "## Import the reviewed Fall 2026 starting records",
      "### Connect Google first",
    );
    expectInOrder(sourceOrder, [
      "`CSF Application - Spring 2026 (Responses)`",
      "**Applications** as the **Record type**",
      "Classes of 2027–2030",
      "**Historical records**",
    ]);
    expect(sourceOrder).toContain(
      "Do not first load a class-history sheet as **Student roster**",
    );
    expect(sourceOrder).toContain(
      "**Preview**, **Reconcile**, and **Commit** are separate boundaries",
    );
    expect(sourceOrder).toContain(
      "a clean preview neither imports rows nor authorizes a commit",
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
    expect(operatorGuide).toContain("Post saved; email not queued");
    expect(operatorGuide).toContain("Post saved; email status unknown");
    expect(operatorGuide).toContain(
      "Queued still does not mean sent or delivered",
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

  test("current status separates the repository ledger from hosted database and deployed code", () => {
    const migrations = readdirSync(join(repositoryRoot, "supabase/migrations"))
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(281);
    expect(migrations.at(-1)).toBe(
      "20260813012206_google_cap_effect_fencing.sql",
    );

    const currentState = between(
      testingAndRelease,
      "## Current hosted Development state",
      "## Historical August 11 hosted Development amendment",
    );
    expect(currentState).toContain(
      "repository branch has 281 ordered migrations through",
    );
    expect(currentState).toContain(
      "`20260812203500_close_plugin_data_browser_default_acl`",
    );
    expect(currentState).toContain(
      "`20260813012206_google_cap_effect_fencing`",
    );
    expect(currentState).toContain(
      "`20260812193400_protect_staff_invite_issuer_capability`",
    );
    expect(currentState).toContain(
      "Hosted Development Supabase remains at 273 ordered migrations through",
    );
    expect(currentState).toContain("The eight unmerged migrations are");
    expect(currentState).toContain("`20260813010000_atomic_ai_quota_receipts`");
    expect(currentState).toContain(
      "hosted Development database parity, application deployment, and provider acceptance have not been established",
    );
    expect(currentState).not.toContain(
      "repository and Development database ledgers match",
    );
    expect(currentState).toContain(
      "Production remains at 236 ordered migrations through `20260811001500`",
    );
    expect(currentState).toContain("45-migration cutover has not run");
    expect(currentState).toContain(
      "`20260812132725_csf_drive_metadata_compare_and_set_fence`",
    );
    expect(currentState).toContain(
      "Ready repository tree ended at 272 through",
    );
    expect(currentState).toContain(
      "external Vercel 100-deployment-per-day project cap",
    );
    expect(currentState).toContain("alias is not exact-current-code evidence");
    expect(currentState).toContain(
      "95 INFO, 0 WARN, and 0 ERROR security findings",
    );
    expect(currentState).toContain(
      "611 INFO, 0 WARN, and 0 ERROR performance findings",
    );
    expect(currentState).toContain("`dev.lets-assist.com`");
    expect(currentState).toContain(
      "`cf330e5faa844d63a2f41c8f0be4d1c727d51a47`",
    );
    expect(currentState).toContain(
      "seven-argument metadata RPC exists, its old four-argument overload is absent",
    );
    expect(currentState).toContain(
      "only `service_role` can execute the current RPC",
    );
    expect(currentState).toContain("Google OAuth and Picker are connected");
    expect(currentState).toContain("Spring 2026 application workbook");
    expect(currentState).toContain("`A1:Q518`");
    expect(currentState).toContain("inspected and mapped");
    expect(currentState).toContain(
      "passed the metadata RPC and appended 85 stored preview rows",
    );
    expect(currentState).toContain(
      "failed while sealing because the caller summary wrongly stated the reserved derived `rows` key",
    );
    expect(currentState).toContain("one failed preview job");
    expect(currentState).toContain("zero term applications were committed");
    expect(currentState).toContain("No names or email addresses");
    expect(currentState).toContain(
      "caller-summary correction and inactive-access hardening are combined in private development commit `605342c`",
    );
    expect(currentState).toContain(
      "root worktree's gitlink points to that exact commit locally",
    );
    expect(currentState).not.toContain(
      "Preview failed before reading or importing rows because the seven-argument RPC was missing",
    );
    expect(currentState).toContain("Production remains untouched");
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

  test("the Development rehearsal and cutover ledger carry the same current evidence", () => {
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
      "this repository has 281 through `20260813012206_google_cap_effect_fencing`",
    );
    expect(rehearsalState).toContain("The eight unmerged migrations are");
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
      "`20260812161500_atomic_project_signup_rejection`",
    );
    expect(rehearsalState).toContain(
      "`20260812193400_protect_staff_invite_issuer_capability`",
    );
    expect(rehearsalState).toContain(
      "external Vercel 100-deployment-per-day project cap",
    );
    expect(rehearsalState).toContain("deployment is Ready but stale");
    expect(rehearsalState).toContain(
      "They have not been re-established for either hosted 273 or repository 281",
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
      "caller-summary correction and inactive-access hardening are combined in private development commit `605342c`",
    );
    expect(rehearsalState).toContain(
      "root worktree's gitlink points to that exact commit locally",
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
      "Replay the ordered migration ledger through `20260813012206`",
    );
    expect(cutover).toContain(
      "`scripts/production-cutover-preflight.sql` with the reviewed Production read-only URL",
    );
    expect(cutover).toContain("exact 236-row baseline");
    expect(cutover).toContain("full 45-migration transition");
    expect(cutover).toContain("preflight on the 281-row target");
  });

  test("production cutover baseline tracks the exact pending migration range", () => {
    expect(productionCutoverRunbook).toContain(
      "Production has 236 ordered migrations through `20260811001500`",
    );
    expect(productionCutoverRunbook).toContain(
      "Hosted Development Supabase remains at 273 ordered migrations through `20260812152300`",
    );
    expect(productionCutoverRunbook).toContain(
      "this repository has 281 through `20260813012206_google_cap_effect_fencing`",
    );
    expect(productionCutoverRunbook).toContain(
      "The eight unmerged migrations have not been applied or deployed in hosted Development",
    );
    expect(productionCutoverRunbook).toContain(
      "`20260812193400_protect_staff_invite_issuer_capability`",
    );
    expect(productionCutoverRunbook).toContain(
      "repository ledger ended at 272 through `20260812132725`",
    );
    expect(productionCutoverRunbook).toContain(
      "Production therefore has exactly 45 pending migrations",
    );
    expect(productionCutoverRunbook).toContain(
      "external Vercel 100-deployment-per-day project cap",
    );
    expect(productionCutoverRunbook).toContain(
      "Neither hosted database parity nor application-deployment parity has been established",
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
      "expect exactly 174 pending",
    );
    expect(productionCutoverRunbook).toContain("Production remains untouched");
    expect(productionCutoverRunbook).toContain(
      "No release may proceed until hosted Development exact-SHA browser and provider gates are green",
    );
  });
});
