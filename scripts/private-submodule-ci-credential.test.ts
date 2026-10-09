import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(
  join(import.meta.dir, "..", ".github", "workflows", "ci.yml"),
  "utf8",
);

function occurrences(value: string) {
  return workflow.split(value).length - 1;
}

const jobIds = [
  ...workflow
    .slice(workflow.indexOf("\njobs:\n"))
    .matchAll(/^ {2}([A-Za-z][\w-]*):\s*$/gmu),
].map((match) => match[1]);

function jobBlock(name: string) {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = workflow.slice(start + marker.length);
  const next = /^ {2}[A-Za-z][\w-]*:\s*$/mu.exec(body);
  return next ? body.slice(0, next.index) : body;
}

// Every job that checks out the repository. The remaining jobs only compare the
// results of these and run no repository code.
const checkoutJobs = ["static", "unit", "build", "database", "browser"];
const resultOnlyJobs = ["quality", "db-replay-validation", "ci-gate"];

describe("private plugin CI credential", () => {
  test("every job either checks out the exact gitlink or runs no repository code", () => {
    expect([...checkoutJobs, ...resultOnlyJobs].sort()).toEqual(
      [...jobIds].sort(),
    );
    for (const name of checkoutJobs) {
      expect(jobBlock(name).split("uses: actions/checkout@").length - 1).toBe(
        2,
      );
    }
    for (const name of resultOnlyJobs) {
      const job = jobBlock(name);
      expect(job).not.toContain("uses:");
      expect(job).not.toContain("secrets.");
      expect(job).not.toMatch(/\b(?:bun|node|git|bash|sh) /u);
      expect(job.split("      - name: ").length - 1).toBe(1);
    }
  });

  test("uses one repository-scoped SSH secret instead of a reusable access token", () => {
    expect(workflow).not.toContain("PRIVATE_SUBMODULE_TOKEN");
    expect(workflow).toContain(
      "PRIVATE_SUBMODULE_SSH_KEY: ${{ secrets.PRIVATE_SUBMODULE_SSH_KEY }}",
    );
    expect(
      occurrences("ssh-key: ${{ secrets.PRIVATE_SUBMODULE_SSH_KEY }}"),
    ).toBe(checkoutJobs.length);
    expect(occurrences("persist-credentials: false")).toBe(
      2 * checkoutJobs.length,
    );
    // No checkout may keep a credential: there are exactly as many checkouts
    // as there are credential opt-outs.
    expect(occurrences("uses: actions/checkout@")).toBe(
      occurrences("persist-credentials: false"),
    );
  });

  test("resolves and checks out the exact committed private gitlink", () => {
    expect(
      occurrences(
        'echo "sha=$(git rev-parse HEAD:lib/plugins/private)" >> "$GITHUB_OUTPUT"',
      ),
    ).toBe(checkoutJobs.length);
    expect(occurrences("repository: riddhimanrana/lets-assist-plugins")).toBe(
      checkoutJobs.length,
    );
    expect(
      occurrences("ref: ${{ steps.private-plugin-gitlink.outputs.sha }}"),
    ).toBe(checkoutJobs.length);
    expect(occurrences("path: lib/plugins/private")).toBe(checkoutJobs.length);
  });

  test("registers the separately checked-out repository as the declared submodule", () => {
    expect(occurrences("git submodule init")).toBe(checkoutJobs.length);
    expect(
      occurrences(
        "git -C lib/plugins/private remote set-url origin https://github.com/riddhimanrana/lets-assist-plugins.git",
      ),
    ).toBe(checkoutJobs.length);
    expect(occurrences("git submodule absorbgitdirs lib/plugins/private")).toBe(
      checkoutJobs.length,
    );
  });

  test("keeps the strict detached-gitlink validation enabled", () => {
    expect(workflow).not.toContain("PRIVATE_SUBMODULE_ALLOW_DETACHED_GITLINK");
    expect(occurrences("bun run plugin:submodules:check:strict")).toBe(
      checkoutJobs.length,
    );
  });

  test("fetches complete private history before each strict containment check", () => {
    for (const job of checkoutJobs.map((name) => jobBlock(name))) {
      const checkoutStart = job.indexOf(
        "      - name: Checkout exact private plugin gitlink\n",
      );
      const normalizeStart = job.indexOf(
        "      - name: Normalize private plugin remote metadata\n",
      );
      const strictStart = job.indexOf(
        "      - name: Validate exact private plugin gitlink\n",
      );

      expect(checkoutStart).toBeGreaterThanOrEqual(0);
      expect(normalizeStart).toBeGreaterThan(checkoutStart);
      expect(strictStart).toBeGreaterThan(normalizeStart);

      const privateCheckout = job.slice(checkoutStart, normalizeStart);
      expect(privateCheckout).toContain("          fetch-depth: 0\n");
      expect(privateCheckout).toContain(
        "          persist-credentials: false\n",
      );

      const strictCheck = job.slice(strictStart);
      expect(strictCheck).toContain(
        "        run: bun run plugin:submodules:check:strict\n",
      );

      // The strict check runs before any other repository command in the job.
      const firstRepositoryCommand = job.search(/run: (?:bun|node) /u);
      expect(firstRepositoryCommand).toBe(
        job.indexOf("run: bun run plugin:submodules:check:strict"),
      );
      expect(job).toContain(
        "PRIVATE_SUBMODULE_SSH_KEY: ${{ secrets.PRIVATE_SUBMODULE_SSH_KEY }}",
      );
      expect(job.split("persist-credentials: false").length - 1).toBe(2);
    }
  });
});
