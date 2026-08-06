import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const platformSeed = readFileSync(
  new URL("../../scripts/local-dev/seed-platform.mjs", import.meta.url),
  "utf8",
);

test("DVHS CSF partner-club fixtures contain only synthetic contact details", () => {
  expect(platformSeed).not.toContain("sandralei@gmail.com");
  expect(platformSeed).not.toContain('contact_name: "Sandra Lei"');
  expect(platformSeed).toContain('contact_email: "quailrun.csf@example.test"');
});
