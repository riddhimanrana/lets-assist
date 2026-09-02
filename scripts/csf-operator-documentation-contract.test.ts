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
    component: "CsfClassInviteDialog.tsx",
    labels: [
      "Invite students",
      "Create code",
      "Regenerate code",
      "Disable code",
      "This class does not have an active code yet.",
    ],
  },
  {
    component: "CsfCohortMembersReviewQueue.tsx",
    labels: [
      "Record connections",
      "Review accounts waiting to connect to a student record in this class.",
      "First page",
    ],
  },
  {
    component: "CsfClassCodeEntryForm.tsx",
    labels: [
      "Join code",
      "6 letters and numbers; codes never use O, I, 0, or 1",
    ],
  },
  {
    component: "CsfResolveConnectionDialog.tsx",
    labels: [
      "Review account connection",
      "Review in Resolve",
      "Suggestions · advisory only",
      "Canonical evidence ready",
      "Review only",
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
      "Person",
      "Search members and organization accounts",
      "No eligible account matches that search.",
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
    labels: ["Set up a graduating class", "Add one semester"],
  },
  {
    component: "CsfClassTermActionsMenu.tsx",
    labels: ["Term actions", "Set as current"],
  },
  {
    component: "CsfTermsWorkspace.tsx",
    labels: ["Meeting schedule"],
  },
  {
    component: "CsfStartNextTermDialog.tsx",
    labels: ["Start next term"],
  },
  {
    component: "CsfTermsChapterRules.tsx",
    labels: ["Chapter rules"],
  },
  {
    component: "CsfCloseTermDialog.tsx",
    labels: ["Semester close preflight"],
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
      "Google Drive connection",
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
    component: "csf-review/panels/ApplicationReviewPanel.tsx",
    labels: [
      "Courses as imported",
      "Reported point totals",
      "Transcript",
      "Webstore receipt",
      "Reject",
      "Approve",
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
      "Also send this as an email",
      "Post saved",
      "Email queued",
    ],
  },
  {
    // The outcome alerts and submit-button states were extracted from the
    // compose dialog into this feedback component; the labels live here now.
    component: "CsfPostComposeFeedback.tsx",
    labels: [
      "Post saved",
      "Publish post",
      "Schedule post",
      "Post saved; email not queued",
      "Post saved; email status unknown",
      "Email queued",
      "Email not queued",
    ],
  },
  {
    component: "CsfPostPublicationResult.ts",
    labels: ["Email queue status unknown"],
  },
];

const COMMUNICATIONS: LabelContract[] = [
  {
    component: "CsfCommunicationsWorkspace.tsx",
    labels: ["Delivery issues"],
  },
  {
    component: "CsfCommunicationsSettings.tsx",
    labels: [
      "Communications settings",
      "Ready",
      "Needs provider setup",
      "Check communications setup",
    ],
  },
  {
    component: "CsfCommunicationsCampaigns.tsx",
    labels: [
      "Finalize content",
      "Review recipients",
      "Queue for sending",
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
      "Join a class",
      "That class code didn’t work",
      "Already have a CSF record?",
      "New to CSF?",
      "Sign in to continue",
      "Is this you?",
      "Yes, link this record",
      "No, change the name",
      "Find your CSF record",
      "Student name",
      "Find my record",
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
  test("members, account linking, and the review queue", () => {
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

  test("applications preserve the current evidence and decision labels", () => {
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

  test("the student-facing connect screen", () => {
    assertContract(STUDENT_JOURNEY);
  });
});

describe("CSF operator documentation truthfulness guards", () => {
  test("the guide documents the single class-code connection path", () => {
    // The product now has exactly one student connection surface: the connect
    // page behind a permanent class join code. Its source must still carry the
    // journey the guide narrates, in the same order.
    const connectSource = readComponent(
      "CsfDashboardContentSection1Connect.tsx",
    );
    for (const label of [
      "Join a class",
      "That class code didn’t work",
      "Already have a CSF record?",
      "New to CSF?",
      "Sign in to continue",
      "Is this you?",
      'idleLabel="Yes, link this record"',
      'triggerLabel="No, change the name"',
      "Find your CSF record",
      'idleLabel="Find my record"',
    ]) {
      expect(connectSource).toContain(label);
    }
    const codeEntrySource = readComponent("CsfClassCodeEntryForm.tsx");
    expect(codeEntrySource).toContain("Join code");
    // The 6-character alphabet excludes the lookalikes O/I/0/1 by contract.
    expect(codeEntrySource).toContain(
      'const CSF_CLASS_CODE_PATTERN = "[A-HJ-NP-Za-hj-np-z2-9]{6}"',
    );
    expect(codeEntrySource).toContain("pattern={CSF_CLASS_CODE_PATTERN}");

    // The guide walks the one path in operating order: share the code, the
    // student joins at /connect/<code>, unresolved joins land in the per-class
    // Needs attention queue, and Resolve gates Connect on canonical evidence.
    const codePath = between(
      operatorGuide,
      "## Share the class join code",
      "## Make a connected person an officer",
    );
    expectInOrder(codePath, [
      "**Invite students**",
      "**Create code**",
      "**Regenerate code**",
      "**Disable code**",
      "`/connect/<code>`",
      "**Join code**",
      "**Is this you?**",
      "**Yes, link this record**",
      "**Find my record**",
      "**Record connections**",
      "**Resolve**",
      "**Connect account**",
      "**Reject request**",
    ]);

    // The retired paths must not be resurrected in any operator document:
    // reusable class links, student-specific invitation links, the
    // profile-claim confirmation, and the org-level account-connections view.
    for (const doc of OPERATOR_DOCUMENTS) {
      for (const retired of [
        "reusable class link",
        "student-specific link",
        "Student link",
        "Class link",
        "Accept invitation",
        "We found your CSF record",
        "Yes, connect this record",
        "Needs account link",
        "Matches to review",
        "onboarding link",
      ]) {
        expect(doc).not.toContain(retired);
      }
    }
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
    // PluginControlPlane is now only the tab shell; the operator controls the
    // guide names live in the per-tab components it renders. Assert against that
    // whole surface so a label cannot pass by sitting in the shell alone.
    const controlPlane = [
      "app/admin/plugins/PluginControlPlane.tsx",
      "app/admin/plugins/PluginAccessControls.tsx",
      "app/admin/plugins/PluginDetails.tsx",
      "app/admin/plugins/PluginAdvancedControls.tsx",
    ]
      .map((file) => readRepositoryFile(file))
      .join("\n");
    const organizationPlugins = readRepositoryFile(
      "app/organization/[id]/settings/OrganizationPluginSettings.tsx",
    );
    const pluginManifest = readComponent("../plugin-manifest.ts");
    for (const label of [
      "Organization access",
      "Plugin key",
      "Active in catalog",
      "Latest version",
      "Starts at",
      "Ends at",
      "Platform controlled",
      "Save access",
      "Force install",
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
      "**Plugin details**",
      "**Plugin key**",
      "**Active in catalog**",
      "**Latest version**",
      "**Organization access**",
      "**Organization** = `DVHigh CSF`",
      "**Plugin** = `DVHS CSF`",
      "**Status** = **Active**",
      "**Platform controlled**",
      "**Save access**",
      "**Force install**",
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
});
