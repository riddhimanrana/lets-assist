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

function jobBlock(name: string, nextName?: string) {
  const start = workflow.indexOf(`  ${name}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = nextName
    ? workflow.indexOf(`  ${nextName}:\n`, start)
    : workflow.length;
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("private plugin CI credential", () => {
  test("uses one repository-scoped SSH secret instead of a reusable access token", () => {
    expect(workflow).not.toContain("PRIVATE_SUBMODULE_TOKEN");
    expect(workflow).toContain(
      "PRIVATE_SUBMODULE_SSH_KEY: ${{ secrets.PRIVATE_SUBMODULE_SSH_KEY }}",
    );
    expect(
      occurrences("ssh-key: ${{ secrets.PRIVATE_SUBMODULE_SSH_KEY }}"),
    ).toBe(2);
    expect(occurrences("persist-credentials: false")).toBeGreaterThanOrEqual(4);
  });

  test("resolves and checks out the exact committed private gitlink", () => {
    expect(
      occurrences(
        'echo "sha=$(git rev-parse HEAD:lib/plugins/private)" >> "$GITHUB_OUTPUT"',
      ),
    ).toBe(2);
    expect(occurrences("repository: riddhimanrana/lets-assist-plugins")).toBe(
      2,
    );
    expect(
      occurrences("ref: ${{ steps.private-plugin-gitlink.outputs.sha }}"),
    ).toBe(2);
    expect(occurrences("path: lib/plugins/private")).toBe(2);
  });

  test("registers the separately checked-out repository as the declared submodule", () => {
    expect(occurrences("git submodule init")).toBe(2);
    expect(
      occurrences(
        "git -C lib/plugins/private remote set-url origin https://github.com/riddhimanrana/lets-assist-plugins.git",
      ),
    ).toBe(2);
    expect(occurrences("git submodule absorbgitdirs lib/plugins/private")).toBe(
      2,
    );
  });

  test("keeps the strict detached-gitlink validation enabled", () => {
    expect(workflow).not.toContain("PRIVATE_SUBMODULE_ALLOW_DETACHED_GITLINK");
    expect(occurrences("bun run plugin:submodules:check:strict")).toBe(2);
  });

  test("fetches complete private history before each strict containment check", () => {
    const jobs = [
      jobBlock("quality", "db-replay-validation"),
      jobBlock("db-replay-validation"),
    ];

    for (const job of jobs) {
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
    }
  });
});
