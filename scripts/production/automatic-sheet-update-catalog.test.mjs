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
  applicationContactDefinitions,
  automaticSheetDefinitions,
  automaticSheetUpdatesPosture,
} from "./automatic-sheet-update-catalog.mjs";
import { matchingTabDefinitions } from "./matching-tab-catalog.mjs";

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

test("reviewed automatic-update and merge ledgers retain automatic-update checks", () => {
  const versions = expectedVersions(root);
  assert.equal(versions.length, 498);
  for (const accepted of [
    versions.slice(0, 466),
    versions.slice(0, 467),
    versions.slice(0, 468),
    versions,
  ]) {
    assert.ok(
      acceptedCatalogQuery(source, accepted).includes(
        "csf_prepare_automatic_application_profiles",
      ),
    );
  }
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 465)).includes(
      "csf_prepare_automatic_application_profiles",
    ),
  );
  assert.throws(() =>
    acceptedCatalogQuery(source, [...versions.slice(0, -1), "20260908090509"]),
  );
});

test("matching-tab upgrade pins new and renamed helpers without changing older catalogs", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260908141739_csf_workbook_matching_tab_authorization.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const bodies = [...sql.matchAll(/AS \$\$([\s\S]*?)\$\$;/gu)];
  assert.equal(bodies.length, 5);
  for (const [, body] of bodies) {
    const digest = createHash("md5").update(body).digest("hex");
    assert.ok(matchingTabDefinitions.some((entry) => entry[2] === digest));
  }
  const query = automaticSheetUpdatesPosture(workerRelationSnapshotQuery, true);
  assert.ok(query.includes("count(*)=28"));
  assert.ok(query.includes("8ea2de3577ed4ae18571aa1a8df986b2"));
  assert.ok(query.includes("csf_workbook_matching_tab_scope_request"));
  assert.ok(
    !automaticSheetUpdatesPosture(workerRelationSnapshotQuery).includes(
      "csf_inherit_matching_class_tab_authorization",
    ),
  );
  assert.ok(
    !acceptedCatalogQuery(
      source,
      expectedVersions(root).slice(0, 467),
    ).includes("csf_inherit_matching_class_tab_authorization"),
  );
});

test("application contact capture pins each changed body only for its reviewed ledger", () => {
  const versions = expectedVersions(root);
  const current = acceptedCatalogQuery(source, versions.slice(0, 478));
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 477));
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260910004059_csf_import_application_profile_contacts.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const bodies = [
    ...sql.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION plugin_data\.([a-z_]+)\([\s\S]*?AS (\$(?:function)?\$)([\s\S]*?)\2;/gu,
    ),
  ];
  assert.equal(bodies.length, 3);
  assert.equal(applicationContactDefinitions.length, bodies.length);
  for (const [, name, , body] of bodies) {
    const expected = applicationContactDefinitions.find(([signature]) =>
      signature.startsWith(`plugin_data.${name}(`),
    );
    assert.ok(expected, name);
    assert.equal(
      expected[2],
      createHash("md5").update(body).digest("hex"),
      name,
    );
    const [signature, digest, bodyDigest, service] = expected;
    assert.ok(
      current.includes(
        `('${signature}','${digest}','${bodyDigest}',${service})`,
      ),
    );
    assert.ok(!preceding.includes(bodyDigest));
    const original = automaticSheetDefinitions.find(
      ([value]) => value === signature,
    );
    if (original) {
      assert.ok(preceding.includes(original[2]));
      assert.ok(!current.includes(original[2]));
    } else {
      assert.equal(service, false);
      assert.ok(!preceding.includes(signature));
    }
  }
  assert.ok(
    current.includes("actual.service_execute=expected.service_execute"),
  );
  assert.ok(
    current.includes(
      "NOT actual.anon_execute AND NOT actual.authenticated_execute",
    ),
  );
  assert.equal(
    automaticSheetUpdatesPosture(workerRelationSnapshotQuery, true),
    automaticSheetUpdatesPosture(workerRelationSnapshotQuery, true, false),
  );
});
