import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isDevelopmentReleaseCommitMessage,
  shouldRunVercelBuild,
} from "./vercel-build-policy.mjs";

const repositoryRoot = join(import.meta.dir, "..");

function readRepositoryFile(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("Vercel build policy", () => {
  test("holds Production Git pushes and builds explicit non-Git deployments", () => {
    expect(
      shouldRunVercelBuild({ branch: "main", commitMessage: "release" }),
    ).toBe(false);
    expect(
      shouldRunVercelBuild({ branch: undefined, commitMessage: undefined }),
    ).toBe(true);
  });

  test("skips feature branches before dependency installation", () => {
    expect(
      shouldRunVercelBuild({
        branch: "codex/csf-record-connection",
        commitMessage: "fix(csf): connect the selected record",
      }),
    ).toBe(false);
  });

  test("skips ordinary Development commits", () => {
    expect(
      shouldRunVercelBuild({
        branch: "development",
        commitMessage: "fix(csf): polish member connection",
      }),
    ).toBe(false);
  });

  test("builds an explicitly marked Development release", () => {
    expect(
      shouldRunVercelBuild({
        branch: "development",
        commitMessage:
          "release(csf): scale candidate [deploy-development]\n\nReviewed tree",
      }),
    ).toBe(true);
  });

  test("builds a merged CSF integration branch", () => {
    expect(
      shouldRunVercelBuild({
        branch: "development",
        commitMessage:
          "Merge pull request #445 from riddhimanrana/codex/csf-integration-20260901\n\nCSF release candidate",
      }),
    ).toBe(true);
  });

  test("uses only the exact first line for Development release selection", () => {
    expect(
      isDevelopmentReleaseCommitMessage(
        "fix(csf): ordinary change\n\n[deploy-development]",
      ),
    ).toBe(false);
    expect(
      isDevelopmentReleaseCommitMessage(
        "fix(csf): ordinary change\n\nMerge pull request #445 from riddhimanrana/codex/csf-integration-20260901",
      ),
    ).toBe(false);
    expect(
      isDevelopmentReleaseCommitMessage(
        "Merge pull request #445 from riddhimanrana/codex/csf-integration",
      ),
    ).toBe(false);
  });

  test("does not treat an arbitrary pull request merge as an integration release", () => {
    expect(
      shouldRunVercelBuild({
        branch: "development",
        commitMessage:
          "Merge pull request #446 from riddhimanrana/codex/csf-copy-polish\n\nCopy fix",
      }),
    ).toBe(false);
  });

  test("uses Vercel's zero-to-skip and one-to-build exit contract", () => {
    const script = join(repositoryRoot, "scripts/vercel-build-policy.mjs");
    const run = (commitMessage: string) =>
      spawnSync("node", [script], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          VERCEL_GIT_COMMIT_MESSAGE: commitMessage,
          VERCEL_GIT_COMMIT_REF: "development",
        },
      });

    const skipped = run("ordinary commit");
    const built = run("release [deploy-development]");

    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain("skip this Git revision");
    expect(built.status).toBe(1);
    expect(built.stdout).toContain("continue");
  });

  test("keeps repository and hosted acceptance controls on one marker", () => {
    const vercel = JSON.parse(readRepositoryFile("vercel.json")) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
      ignoreCommand?: string;
    };
    const acceptance = readRepositoryFile(
      ".github/workflows/csf-hosted-development-acceptance.yml",
    );
    const deploymentGuide = readRepositoryFile(
      "docs/development/deployment.md",
    );

    expect(vercel.git?.deploymentEnabled).toEqual({
      "*": false,
      development: true,
      main: false,
    });
    expect(vercel.ignoreCommand).toBe("node scripts/vercel-build-policy.mjs");
    expect(acceptance).toContain("isDevelopmentReleaseCommitMessage");
    expect(acceptance).toContain("needs: release-selection");
    expect(deploymentGuide).toMatch(/one\s+integration pull request/u);
    expect(deploymentGuide).toMatch(/one\s+Production pull\s+request/u);
  });

  test("keeps the root runtime on the Node 22 line used by Vercel", () => {
    const packageJson = JSON.parse(readRepositoryFile("package.json")) as {
      engines?: { node?: string };
    };
    const pinnedVersion = readRepositoryFile(".node-version").trim();

    expect(pinnedVersion).toMatch(/^22\.[0-9]+\.[0-9]+$/u);
    expect(packageJson.engines?.node).toBe(">=22.22.0 <23");
  });
});
