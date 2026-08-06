import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

describe("AI dependency boundaries", () => {
  test("provider-utils resolves the reviewed Undici security override", () => {
    const probe = spawnSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        `
          import { createRequire } from "node:module";
          const providerRequire = createRequire(
            new URL("./node_modules/@ai-sdk/provider-utils/package.json", import.meta.url),
          );
          const undici = providerRequire("undici");
          const { version } = providerRequire("undici/package.json");
          const agent = new undici.Agent();
          if (version !== "7.29.0") throw new Error(\`unexpected Undici version: \${version}\`);
          for (const name of ["fetch", "Agent"]) {
            if (typeof undici[name] !== "function") throw new Error(\`missing Undici export: \${name}\`);
          }
          for (const name of ["dispatch", "close", "destroy"]) {
            if (typeof agent[name] !== "function") throw new Error(\`missing Agent method: \${name}\`);
          }
          await agent.close();
        `,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(probe.status, probe.stderr).toBe(0);
  });
});
