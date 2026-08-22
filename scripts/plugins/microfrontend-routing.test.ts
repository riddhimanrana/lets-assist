import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRouting } from "@vercel/microfrontends/next/testing";

const configPath = resolve("microfrontends.json");
const targetsPath = resolve("lib/plugins/application-deployment-targets.json");

test("only version-independent health and namespaced assets use static child routing", () => {
  expect(() =>
    validateRouting(configPath, {
      "lets-assist-csf": [
        "/api/plugins/dvhs-csf/health",
        "/vc-ap-5431dc/_next/static/chunks/app/access-proof.js",
      ],
    }),
  ).not.toThrow();
});

test("organization application paths are absent from static project routing", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const routes = config.applications["lets-assist-csf"].routing.flatMap(
    (entry: { paths: string[] }) => entry.paths,
  );
  expect(routes).not.toContain(
    "/organization/:organizationId/plugins/dvhs-csf/access-proof",
  );
  expect(routes).toContain("/vc-ap-5431dc/:path*");
});

test("the committed routing config names only the expected projects", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  expect(Object.keys(config.applications).sort()).toEqual([
    "lets-assist",
    "lets-assist-csf",
  ]);

  const targets = JSON.parse(readFileSync(targetsPath, "utf8"));
  expect(targets["dvhs-csf"].routingApplication).toBe("lets-assist-csf");
  expect(targets["dvhs-csf"].projectName).toBe("lets-assist-csf");
  expect(
    config.applications[targets["dvhs-csf"].routingApplication],
  ).toBeTruthy();
});
