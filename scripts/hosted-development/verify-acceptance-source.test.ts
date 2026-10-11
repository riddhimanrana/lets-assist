import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assertAcceptanceOnlyChanges,
  verifyAcceptanceSource,
} from "./verify-acceptance-source.mjs";

const accepted = "a".repeat(40);
const deployed = "b".repeat(40);
const workflowPath = ".github/workflows/csf-hosted-development-acceptance.yml";
const workflow = readFileSync(workflowPath, "utf8");

describe("acceptance build reuse", () => {
  test("accepts only the reviewed acceptance tooling paths", () => {
    expect(() => assertAcceptanceOnlyChanges([workflowPath])).not.toThrow();
    expect(() => assertAcceptanceOnlyChanges([])).not.toThrow();
  });

  for (const path of [
    "app/page.tsx",
    "lib/plugins/private",
    "package.json",
    "bun.lock",
    "vercel.json",
    "supabase/migrations/20260909100000_change.sql",
    "scripts/production/app-release-checks.mjs",
    "scripts/hosted-development/test-csf-load.mjs",
  ])
    test(`refuses build reuse after changing ${path}`, () => {
      expect(() => assertAcceptanceOnlyChanges([path])).toThrow(
        "Build reuse refused",
      );
    });

  test("verifies the checkout, ancestry, and every changed path", () => {
    const calls: string[][] = [];
    const result = verifyAcceptanceSource(
      { ACCEPTED_SHA: accepted, DEPLOYED_APP_SHA: deployed },
      (...args: string[]) => {
        calls.push(args);
        if (args[0] === "rev-parse") return accepted;
        if (args[0] === "diff") return `${workflowPath}\0`;
        return "";
      },
    );
    expect(result).toEqual({
      acceptedSha: accepted,
      deployedAppSha: deployed,
      changedToolingFiles: 1,
    });
    expect(calls[1]).toEqual([
      "merge-base",
      "--is-ancestor",
      deployed,
      accepted,
    ]);
    expect(calls[2]).toEqual([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      deployed,
      accepted,
      "--",
    ]);
  });

  test("refuses missing SHA and a different checkout", () => {
    expect(() => verifyAcceptanceSource({}, () => accepted)).toThrow(
      "must be explicit",
    );
    expect(() =>
      verifyAcceptanceSource(
        { ACCEPTED_SHA: accepted, DEPLOYED_APP_SHA: deployed },
        () => deployed,
      ),
    ).toThrow("checkout differs");
  });

  test("checks reuse before provider checks and binds both alias probes to the built SHA", () => {
    expect(
      workflow.indexOf("Verify unchanged application before build reuse"),
    ).toBeLessThan(workflow.indexOf("Require successful Vercel deployment"));
    expect(
      workflow.match(/ACCEPTED_SHA: \$\{\{ env.DEPLOYED_APP_SHA \}\}/gu),
    ).toHaveLength(2);
  });
});

describe("Supabase environment-specific check selection", () => {
  const url = "https://supabase.com/dashboard/project/fictional-development";
  const query = workflow
    .match(/'\[\n([\s\S]*?)' \\\n\s+<<< "\$\{checks_json\}"/u)?.[0]
    .split("' \\\n")[0]
    .slice(1);
  function state(checks: object[]) {
    if (!query) throw new Error("Workflow check selector missing");
    return execFileSync(
      "jq",
      ["-r", "--arg", "expected_details_url", url, query],
      {
        input: JSON.stringify({ check_runs: checks }),
        encoding: "utf8",
      },
    ).trim();
  }
  const check = (id: number, conclusion: string, details_url = url) => ({
    id,
    name: "Supabase Preview",
    app: { slug: "supabase" },
    status: "completed",
    conclusion,
    details_url,
  });

  test("later skipped Production check does not hide Development success", () => {
    expect(
      state([
        check(1, "success"),
        check(
          2,
          "skipped",
          "https://supabase.com/dashboard/project/production",
        ),
      ]),
    ).toBe("success");
  });
  test("latest failure in the same environment defeats older success", () => {
    expect(state([check(1, "success"), check(2, "failure")])).toBe("failure");
  });
  test("pending, missing, wrong-app, and wrong-project checks do not pass", () => {
    expect(state([])).toBe("pending");
    expect(
      state([{ ...check(2, ""), status: "in_progress" }, check(1, "success")]),
    ).toBe("pending");
    expect(
      state([{ ...check(1, "success"), app: { slug: "untrusted" } }]),
    ).toBe("pending");
    expect(
      state([
        check(
          1,
          "success",
          "https://supabase.com/dashboard/project/production",
        ),
      ]),
    ).toBe("pending");
  });
});
