import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the preflight permits only the architecture catalog's reviewed client definers", () => {
  const read = (name: string) =>
    readFileSync(new URL(name, import.meta.url), "utf8");
  const architecture = read("./audit-supabase-architecture.sh");
  const preflight = read("./production-cutover-preflight.sql");
  const reviewedAudit = architecture.slice(
    architecture.indexOf("unexpected_security_definer_exec="),
    architecture.indexOf("public_client_function_acl_drift="),
  );
  const expected = [
    ...reviewedAudit.matchAll(
      /pg_catalog\.to_regprocedure\('([^']+)'\)::oid,\s*'(anon|authenticated)'::text/gu,
    ),
  ].map((match) => [match[1], match[2]]);
  const aclBlock = preflight.slice(
    preflight.indexOf("T5  Public read-model and function ACL posture"),
    preflight.indexOf("T6  Exact target relation ACL"),
  );
  const clientFunctions = [
    ...aclBlock.matchAll(/\('([^']+\([^']*\))',\s*'(anon|authenticated)'\)/gu),
  ].map((match) => [match[1], match[2]]);
  const definerBlock = aclBlock.slice(
    aclBlock.indexOf("reviewed_security_definer(signature"),
    aclBlock.indexOf("actual AS ("),
  );
  const definerSignatures = new Set(
    [...definerBlock.matchAll(/'(public\.[^']+)'/gu)].map((match) => match[1]),
  );
  expect(expected.length).toBeGreaterThan(0);
  expect(
    clientFunctions.filter(([signature]) => definerSignatures.has(signature)),
  ).toEqual(expected);
});
