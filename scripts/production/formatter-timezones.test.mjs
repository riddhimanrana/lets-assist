import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const zones = JSON.parse(
  readFileSync(
    new URL("../../lib/certificates/formatter-timezones.json", import.meta.url),
    "utf8",
  ),
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261014162331_enforce_formatter_certificate_timezones.sql",
    import.meta.url,
  ),
  "utf8",
);

test("database write and existing-row guards use the same reviewed formatter set", () => {
  assert.deepEqual(zones, [...new Set(zones)].sort());
  const lists = [...migration.matchAll(/ARRAY\[([\s\S]*?)\]::text\[\]/gu)].map(
    ([, values]) =>
      [...values.matchAll(/'([^']+)'/gu)].map(([, value]) => value),
  );
  assert.equal(lists.length, 2);
  for (const list of lists) assert.deepEqual(list, zones);
  for (const zone of zones) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat("en-US", { timeZone: zone }),
    );
    assert.ok(zone.length <= 100);
  }
  for (const zone of ["Factory", "localtime", "posixrules", "right/UTC"]) {
    assert.ok(!zones.includes(zone));
    assert.throws(() => new Intl.DateTimeFormat("en-US", { timeZone: zone }));
  }
  assert.ok(zones.includes("Asia/Kolkata"));
  assert.ok(zones.includes("US/Eastern"));
  assert.ok(zones.includes("UTC"));
  assert.ok(!zones.includes("CST6CDT"));
});
