import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const checkScript = join(import.meta.dir, "check-private-submodules.mjs");
const expectedOrigin =
  "https://github.com/riddhimanrana/lets-assist-plugins.git";
const fixtureRoots: string[] = [];

type FixtureOptions = {
  checkoutDrift?: boolean;
  developmentRef?: "contained" | "missing" | "uncontained";
};

function runGit(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function commitFile(
  repository: string,
  relativePath: string,
  contents: string,
  message: string,
) {
  const path = join(repository, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  runGit(repository, "add", relativePath);
  runGit(repository, "commit", "-m", message);
  return runGit(repository, "rev-parse", "HEAD");
}

function createFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "private-submodule-check-"));
  fixtureRoots.push(root);
  runGit(root, "init");
  runGit(root, "config", "user.email", "fixture@example.test");
  runGit(root, "config", "user.name", "Fixture");

  const privateRepository = join(root, "lib/plugins/private");
  mkdirSync(privateRepository, { recursive: true });
  runGit(privateRepository, "init");
  runGit(privateRepository, "config", "user.email", "fixture@example.test");
  runGit(privateRepository, "config", "user.name", "Fixture");
  runGit(privateRepository, "remote", "add", "origin", expectedOrigin);

  const baseCommit = commitFile(
    privateRepository,
    "registry.ts",
    "export const registry = {};\n",
    "base",
  );
  const targetCommit = commitFile(
    privateRepository,
    "feature.ts",
    "export const feature = true;\n",
    "target",
  );
  const developmentRef = options.developmentRef ?? "contained";
  if (developmentRef !== "missing") {
    runGit(
      privateRepository,
      "update-ref",
      "refs/remotes/origin/development",
      developmentRef === "contained" ? targetCommit : baseCommit,
    );
  }

  const gitlinkCommit = options.checkoutDrift ? baseCommit : targetCommit;
  runGit(privateRepository, "checkout", "--detach", targetCommit);
  writeFileSync(
    join(root, ".gitmodules"),
    `[submodule "lib/plugins/private"]\n\tpath = lib/plugins/private\n\turl = ${expectedOrigin}\n`,
  );
  runGit(root, "add", ".gitmodules");
  runGit(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${gitlinkCommit},lib/plugins/private`,
  );
  runGit(root, "submodule", "init", "lib/plugins/private");
  runGit(root, "submodule", "absorbgitdirs", "lib/plugins/private");

  return root;
}

function runCheck(root: string, strict = true) {
  const result = spawnSync(
    "node",
    [checkScript, ...(strict ? ["--strict"] : [])],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "protocol.https.allow",
        GIT_CONFIG_VALUE_0: "never",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("private submodule strict publication check", () => {
  test("passes an exact detached gitlink contained by the local development ref without network access", () => {
    const result = runCheck(createFixture());

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "committed gitlink is contained in the locally known origin/development history",
    );
  });

  test("fails an exact detached gitlink not contained by local development", () => {
    const result = runCheck(createFixture({ developmentRef: "uncontained" }));

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Publish and merge the private commit to private origin/development before publishing the root gitlink",
    );
    expect(result.output).toContain("uses local refs only and does not fetch");
  });

  test("fails when the checkout drifts from the committed gitlink", () => {
    const result = runCheck(createFixture({ checkoutDrift: true }));

    expect(result.status).toBe(1);
    expect(result.output).toContain("index gitlink");
    expect(result.output).toContain(
      "does not match checked-out submodule HEAD",
    );
  });

  test("fails actionably when local origin/development is missing", () => {
    const result = runCheck(createFixture({ developmentRef: "missing" }));

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Missing locally known private ref origin/development",
    );
    expect(result.output).toContain(
      "Update that local remote-tracking ref after the private-first merge",
    );
    expect(result.output).toContain("does not fetch");
  });

  test("preserves the non-strict exact-gitlink behavior for local work", () => {
    const result = runCheck(
      createFixture({ developmentRef: "uncontained" }),
      false,
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "check passed with non-blocking drift warnings allowed",
    );
  });
});
