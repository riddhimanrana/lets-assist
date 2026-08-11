import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const footerSource = readFileSync(
  new URL("./Footer.tsx", import.meta.url),
  "utf8",
);

test("mobile and desktop footers use the product company identity", () => {
  expect(footerSource).not.toContain("© {currentYear} Riddhiman Rana");
  expect(
    footerSource.match(/© \{currentYear\} Tulip Coaching LLC/g),
  ).toHaveLength(2);
});
