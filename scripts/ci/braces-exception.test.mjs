import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptBracesFinding,
  assertReviewedBracesInputs,
  BRACES_EXCEPTION,
  fileHash,
} from "../security/braces-exception.mjs";
import {
  auditPackageGraphs,
  parseAuditReport,
} from "../security/audit-package-graphs.mjs";

const directories = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const advisory = {
  id: 1240992,
  url: BRACES_EXCEPTION.advisory,
  title: "Synthetic braces advisory",
  severity: "high",
  vulnerable_versions: "<=3.0.3",
};
function fixture(version = "3.0.3") {
  const root = mkdtempSync(join(tmpdir(), "braces-policy-"));
  directories.push(root);
  const graphs = Object.keys(BRACES_EXCEPTION.graphHashes).map((label) => ({
    label,
    directory: join(root, label),
  }));
  for (const graph of graphs) {
    mkdirSync(graph.directory, { recursive: true });
    writeFileSync(
      join(graph.directory, "bun.lock"),
      `{"packages":{"braces":["braces@${version}"]}}`,
    );
  }
  const policy = {
    ...BRACES_EXCEPTION,
    sourceHashes: {},
    graphHashes: Object.fromEntries(
      graphs.map((graph) => [
        graph.label,
        fileHash(join(graph.directory, "bun.lock")),
      ]),
    ),
  };
  return {
    root,
    graphs,
    graph: graphs[0],
    finding: { ...advisory, package: "braces" },
    policy,
    environment: {},
    now: new Date("2026-10-07T00:00:00Z"),
    checkInputs: () => {},
  };
}

test("the reviewed advisory stays visible and passes only within the expiry", () => {
  expect(acceptBracesFinding(fixture())).toBe(true);
  const expired = fixture();
  expired.now = new Date(BRACES_EXCEPTION.expiresAt);
  expect(() => acceptBracesFinding(expired)).toThrow("expired");
  expired.now = new Date(NaN);
  expect(() => acceptBracesFinding(expired)).toThrow("expired");
});
test("another advisory or package never inherits acceptance", () => {
  const value = fixture();
  expect(
    acceptBracesFinding({
      ...value,
      finding: {
        ...value.finding,
        url: "https://github.com/advisories/GHSA-other",
      },
    }),
  ).toBe(false);
  expect(
    acceptBracesFinding({
      ...value,
      finding: { ...value.finding, package: "other" },
    }),
  ).toBe(false);
});
test("a changed lockfile, resolved version, or graph inventory requires review", () => {
  const value = fixture();
  writeFileSync(join(value.graph.directory, "bun.lock"), "changed");
  expect(() => acceptBracesFinding(value)).toThrow("Lockfile changed");
  expect(() => acceptBracesFinding(fixture("3.0.2"))).toThrow(
    "resolved version",
  );
  const added = fixture();
  added.graphs.push({ label: "new-app", directory: added.root });
  expect(() => acceptBracesFinding(added)).toThrow("inventory changed");
  const sdk = fixture();
  sdk.graph = sdk.graphs[1];
  expect(() => acceptBracesFinding(sdk)).toThrow("unreviewed package graph");
});
test("operator overrides and new application imports revoke acceptance", () => {
  const value = fixture();
  expect(() =>
    assertReviewedBracesInputs(
      value.root,
      { VC_MICROFRONTENDS_CONFIG_FILE_NAME: "" },
      value.policy,
      () => [],
    ),
  ).toThrow("absent");
  mkdirSync(join(value.root, "app"));
  writeFileSync(
    join(value.root, "app/new.ts"),
    'import matcher from "micromatch";',
  );
  expect(() =>
    assertReviewedBracesInputs(value.root, {}, value.policy, () => [
      "app/new.ts",
    ]),
  ).toThrow("Unreviewed glob");
  writeFileSync(join(value.root, "config.ts"), "reviewed input");
  value.policy.sourceHashes = {
    "config.ts": fileHash(join(value.root, "config.ts")),
  };
  expect(() =>
    assertReviewedBracesInputs(value.root, {}, value.policy, () => []),
  ).not.toThrow();
  writeFileSync(join(value.root, "config.ts"), "changed input");
  expect(() =>
    assertReviewedBracesInputs(value.root, {}, value.policy, () => []),
  ).toThrow("requires review");
});
test("malformed and unknown audit JSON fails closed", () => {
  for (const output of [
    "unavailable",
    "null",
    "[]",
    '{"error":"registry failed"}',
    '{"braces":[]}',
    '{"braces":[{}]}',
  ])
    expect(() => parseAuditReport(output)).toThrow();
});
test("accepted risk cannot hide another finding or a registry failure", () => {
  const value = fixture();
  const logs = [];
  const graph = value.graph;
  const run = (stdout, status = 1) =>
    auditPackageGraphs([graph], {
      environment: {},
      log: (line) => logs.push(line),
      spawn: () => ({ status, stdout }),
      acceptFinding: ({ finding }) => finding.url === advisory.url,
    });
  run(JSON.stringify({ braces: [advisory] }));
  expect(logs.join("\n")).toContain("ACCEPTED RISK until");
  expect(logs.join("\n")).not.toContain("PASS:");
  expect(() =>
    run(
      JSON.stringify({
        braces: [
          advisory,
          {
            ...advisory,
            url: "https://github.com/advisories/GHSA-new-finding",
          },
        ],
      }),
    ),
  ).toThrow("Dependency audit failed");
  expect(() => run("{}", 1)).toThrow("Dependency audit failed");
  expect(() => run(JSON.stringify({ braces: [advisory] }), 2)).toThrow(
    "Dependency audit failed",
  );
});
