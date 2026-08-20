import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRouting } from "@vercel/microfrontends/next/testing";

const configPath = resolve("microfrontends.json");

test("the CSF application path belongs to the flagged child project", () => {
  expect(() =>
    validateRouting(configPath, {
      "lets-assist-csf": [
        {
          path: "/organization/example/plugins/dvhs-csf/access-proof",
          flag: "dvhs-csf-application-runtime",
        },
      ],
    }),
  ).not.toThrow();
});

test("the committed routing config names only the expected projects", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  expect(Object.keys(config.applications).sort()).toEqual([
    "lets-assist",
    "lets-assist-csf",
  ]);
});
