import assert from "node:assert/strict";
import test from "node:test";

import { captureIsolatedReleaseInventory } from "./capture-isolated-release-inventory.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";

const objects = [
  {
    identity: "function:plugin_data.reviewed_fixture()",
    digest: "a".repeat(32),
  },
];
const target = () => ({ dbUrl: "postgresql://localhost:55322/postgres" });
const success = () => ({ status: 0, stdout: JSON.stringify(objects) });

test("the live isolated target guard runs before any database process", () => {
  let invoked = false;
  assert.throws(() =>
    captureIsolatedReleaseInventory({
      target() {
        throw new Error("Isolated target rejected");
      },
      run() {
        invoked = true;
      },
    }),
  );
  assert.equal(invoked, false);
});

test("metadata capture restores only the existing local fixture helpers and does not accept the catalog", () => {
  const manifest = captureIsolatedReleaseInventory({
    target,
    run(command, args, options) {
      assert.equal(command, "psql");
      assert.deepEqual(args, [
        target().dbUrl,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ]);
      assert.ok(options.input.startsWith("BEGIN;\n"));
      assert.ok(options.input.endsWith("ROLLBACK;"));
      assert.equal(
        (options.input.match(/DROP FUNCTION IF EXISTS/gu) ?? []).length,
        7,
      );
      assert.doesNotMatch(
        options.input,
        /CASCADE|COMMIT|DROP (?:TABLE|SCHEMA)/u,
      );
      assert.match(options.input, /SELECT coalesce\(json_agg\(row\)/u);
      assert.equal(options.timeout, 60_000);
      return success();
    },
  });
  assert.deepEqual(manifest.objects, objects);
  assert.equal(manifest.ledger, ledgerDigest(expectedVersions(process.cwd())));
  assert.equal(manifest.format, 1);
});

test("query failures do not retain SQL errors or connection values", () => {
  for (const response of [
    { status: 1, stderr: "Sensitive connection detail" },
    { status: null, error: new Error("Sensitive connection detail") },
  ])
    assert.throws(
      () => captureIsolatedReleaseInventory({ target, run: () => response }),
      { message: "The owned isolated inventory query failed." },
    );
});

test("malformed output, extra fields, duplicate identities, and fixture helpers fail closed", () => {
  for (const stdout of [
    "not json",
    "[]",
    "null",
    JSON.stringify([...objects, ...objects]),
    JSON.stringify([{ ...objects[0], value: "must not enter an artifact" }]),
    JSON.stringify([{ ...objects[0], digest: "bad" }]),
    JSON.stringify([{ ...objects[0], digest: ["a".repeat(32)] }]),
    JSON.stringify([
      {
        ...objects[0],
        identity: "function:plugin_data.csf_seed_reset_synthetic_import(uuid)",
      },
    ]),
  ])
    assert.throws(() =>
      captureIsolatedReleaseInventory({
        target,
        run: () => ({ status: 0, stdout }),
      }),
    );
});
