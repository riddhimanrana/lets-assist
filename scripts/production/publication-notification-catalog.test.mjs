import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { publicationNotificationDefinitions } from "./publication-notification-catalog.mjs";

const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(
  fileURLToPath(new URL("../../", import.meta.url)),
);

test("514 pins every publication function and preserves the preceding catalog", () => {
  assert.equal(versions.length, 514);
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 513));
  assert.equal(publicationNotificationDefinitions.length, 8);
  for (const [
    signature,
    digest,
    service,
  ] of publicationNotificationDefinitions) {
    assert.ok(current.includes(`('${signature}','${digest}',${service})`));
    assert.ok(!preceding.includes(signature));
  }
  assert.match(current, /SELECT count\(\*\) = 37 AND/u);
  assert.match(preceding, /SELECT count\(\*\) = 29 AND/u);
  assert.ok(current.includes("p.proowner = 'postgres'::regrole"));
  assert.ok(
    current.includes("md5(pg_get_functiondef(p.oid)) = expected.digest"),
  );
  assert.ok(current.includes("a.grantee='postgres'::regrole"));
  assert.ok(
    current.includes(
      "NOT has_function_privilege('authenticated',p.oid,'EXECUTE')",
    ),
  );
});

test("514 requires exact private outbox relations and installed publication triggers", () => {
  const current = acceptedCatalogQuery(source, versions);
  for (const fragment of [
    "count(*)=2 AND bool_and(runtime_denied AND digest=CASE relname",
    "bb442786fe77c77ce3adae4aa0e84ac8",
    "31fbae5b2e33bf8be6fa203c76489430",
    "csf_announcements_publication_notifications",
    "csf_activities_publication_notifications",
    "t.tgfoid=to_regprocedure('plugin_data.csf_record_publication_notifications()')",
    "t.tgenabled='O' AND t.tgtype=21 AND NOT t.tgisinternal",
    "t.tgconstraint=0 AND t.tgqual IS NULL AND octet_length(t.tgargs)=0",
    "t.tgattr::text=a.attnum::text",
    "a.attname='organization_updates' AND NOT a.attisdropped",
    "a.atttypid='boolean'::regtype AND a.attnotnull",
    "pg_get_expr(d.adbin,d.adrelid)='true'",
  ])
    assert.ok(current.includes(fragment), fragment);
});

test("an altered 514 ledger cannot select the publication catalog", () => {
  const altered = [...versions];
  altered[513] = "20260914033118";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});
