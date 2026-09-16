import { createHash } from "node:crypto";

// A migration may carry data, but only data someone reviewed. The old contract
// was a regex refusing every `plugin_data.` write in the forward-migration SQL,
// which was never true of the controller: prepareMigration has no runtime DML
// guard. It was a test-only assertion, and it was too broad to survive the
// first migration that legitimately seeds its own metadata.
//
// This replaces it with an exact allowlist. Each entry names the migration, the
// target table, the operation, and the sha256 of the whole statement, so
// editing the statement or aiming it at another table fails the contract.
// Whitespace is collapsed first, so the same statement hashes the same whether
// it is read from the migration file or from the SQL the controller assembles.
export const reviewedMigrationDataWrites = [
  {
    migration: "20260917090000",
    table: "plugin_data.csf_role_permissions",
    operation: "INSERT",
    statement:
      "f5a3c23308950af1e6b28fa0ce92296b0bf9a51cbbbafb2a23f2978128dd23da",
    why: "Grants edit_application_records to roles that already hold decide_applications or review_application_checks, keyed on the enabled capability rather than on a role label, and ON CONFLICT DO NOTHING so an existing disabled row stays disabled.",
  },
  {
    migration: "20260917100000",
    table: "plugin_data.csf_retention_identity_inventory",
    operation: "INSERT",
    statement:
      "bcb60bba426e33003e33a0f1ca4f3aa6340d40fca9f30bb02b13d67dfe029ef2",
    why: "Static retention metadata: the inventory of identity-bearing columns retirement has to cover. Describes the schema, carries no student data.",
  },
  {
    migration: "20260917100000",
    table: "plugin_data.csf_retention_reference_policy",
    operation: "INSERT",
    statement:
      "f5fd94fee0dea2034255555798826955a30ebfbae430a87642eeee8082dc2eee",
    why: "Static retention metadata: the per-reference disposition retirement applies. Schema description, not student data.",
  },
  {
    migration: "20260917150000",
    table: "plugin_data.csf_retention_identity_inventory",
    operation: "INSERT",
    statement:
      "c96df27b5a394403a193e938c1733fe3c25217082b4ab7983738f14387401f8e",
    why: "Extends the same inventory to the officer course-correction records 1300 adds.",
  },
  {
    migration: "20260917150000",
    table: "plugin_data.csf_retention_reference_policy",
    operation: "INSERT",
    statement:
      "a1651ec40a62172a02cb69ecee2150d2b9b4c837f0a904dcb6a1bef400b8442f",
    why: "Extends the same reference policy to those records.",
  },
];

// Nothing in this list may ever be written by a migration, reviewed or not.
// Installation state decides whether the plugin is on for an organization, and
// the rest are the student's own record.
export const prohibitedMigrationWriteTargets = [
  "public.organization_plugin_installs",
  "public.organization_members",
  "plugin_data.csf_profiles",
  "plugin_data.csf_profile_accounts",
  "plugin_data.csf_term_applications",
  "plugin_data.csf_term_memberships",
  "plugin_data.csf_point_submissions",
  "plugin_data.csf_meeting_attendance",
  "plugin_data.csf_application_decision_stages",
];

// Tag-matched, so a write cannot hide inside a DO block or a function body that
// happens to use a named dollar tag.
const stripDollarQuoted = (sql) =>
  sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/gu, "");

// The controller's own ledger write is what it exists to do; it is not
// migration data.
const LEDGER_TABLE = "supabase_migrations.schema_migrations";

export function topLevelDataWrites(sql) {
  return [
    ...stripDollarQuoted(sql).matchAll(
      /^[ \t]*(INSERT INTO|UPDATE|DELETE FROM)\s+([\w.]+)[\s\S]*?;$/gmu,
    ),
  ]
    .map((match) => ({
      operation: match[1].split(" ")[0],
      table: match[2],
      statement: createHash("sha256")
        .update(match[0].replace(/\s+/gu, " ").trim())
        .digest("hex"),
    }))
    .filter((write) => write.table !== LEDGER_TABLE);
}

// Returns the writes that are not reviewed. Empty means the SQL carries only
// data someone signed off on.
export function unreviewedDataWrites(sql) {
  return topLevelDataWrites(sql).filter(
    (write) =>
      !reviewedMigrationDataWrites.some(
        (entry) =>
          entry.table === write.table &&
          entry.operation === write.operation &&
          entry.statement === write.statement,
      ),
  );
}

// Statement hashes are exact only against a single migration file. The SQL the
// controller assembles concatenates many files, where dollar-tag pairing can
// straddle a boundary and shift a statement's extent. For assembled SQL the
// contract is the table set: only tables the allowlist reviews, never a
// prohibited one.
export const reviewedDataWriteTables = [
  ...new Set(reviewedMigrationDataWrites.map((entry) => entry.table)),
].sort();

export function unreviewedWriteTables(sql) {
  return [
    ...new Set(
      topLevelDataWrites(sql)
        .map((write) => write.table)
        .filter((table) => !reviewedDataWriteTables.includes(table)),
    ),
  ].sort();
}

export function prohibitedDataWrites(sql) {
  return topLevelDataWrites(sql).filter((write) =>
    prohibitedMigrationWriteTargets.includes(write.table),
  );
}
