import assert from "node:assert/strict";
import test from "node:test";

import { validateOrganizationAutojoinDomain } from "./domain-policy";

test("normalizes valid institutional domains", () => {
  assert.deepEqual(validateOrganizationAutojoinDomain(" School.K12.US "), {
    ok: true,
    domain: "school.k12.us",
  });
});

test("rejects invalid and public-provider domains", () => {
  for (const domain of [
    "gmail.com",
    "Outlook.com",
    "localhost",
    "-school.example.org",
    "school..example.org",
    "https://school.example.org",
  ]) {
    assert.equal(validateOrganizationAutojoinDomain(domain).ok, false, domain);
  }
});
