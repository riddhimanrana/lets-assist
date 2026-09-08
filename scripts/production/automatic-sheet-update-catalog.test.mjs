import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptedCatalogQuery,
  workerRelationSnapshotQuery,
} from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  automaticSheetDefinitions,
  automaticSheetUpdatesPosture,
} from "./automatic-sheet-update-catalog.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260908090508_csf_sheet_automatic_update_authorization.sql",
    import.meta.url,
  ),
  "utf8",
);

test("automatic update catalog pins every added or replaced function body", () => {
  const bodies = [
    ...migration.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION plugin_data\.([a-z_]+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/gu,
    ),
  ];
  assert.equal(bodies.length, 23);
  assert.equal(automaticSheetDefinitions.length, bodies.length);
  for (const [, name, body] of bodies) {
    const expected = automaticSheetDefinitions.find(([signature]) =>
      signature.startsWith(`plugin_data.${name}(`),
    );
    assert.ok(expected, name);
    assert.equal(
      expected[2],
      createHash("md5").update(body).digest("hex"),
      name,
    );
  }
});

test("automatic update catalog checks missing objects, exact grants, tables, and audit uniqueness", () => {
  const query = automaticSheetUpdatesPosture(workerRelationSnapshotQuery);
  assert.ok(!query.includes("to_regclass('app_private."));
  for (const clause of [
    "actual.signature IS NOT NULL",
    "actual.relname IS NOT NULL",
    "'acl',p.proacl::text",
    "'definition',pg_get_functiondef(p.oid)",
    "NOT actual.anon_execute AND NOT actual.authenticated_execute",
    "actual.service_execute=expected.service_execute",
    "csf_sheet_automatic_update_authorizations",
    "csf_automatic_import_approvals",
    "csf_automatic_import_approval_rows",
    "actual.runtime_denied=expected.runtime_denied",
    "csf_sheet_automatic_update_request_receipt",
    "i.indisunique AND i.indisvalid AND i.indisready AND i.indislive",
  ])
    assert.ok(query.includes(clause), clause);
});

test("only the exact automatic-update ledger receives the new release checks", () => {
  const versions = expectedVersions(root);
  assert.equal(versions.length, 466);
  assert.ok(
    acceptedCatalogQuery(source, versions).includes(
      "csf_prepare_automatic_application_profiles",
    ),
  );
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 465)).includes(
      "csf_prepare_automatic_application_profiles",
    ),
  );
  assert.throws(() =>
    acceptedCatalogQuery(source, [...versions.slice(0, -1), "20260908090509"]),
  );
});
