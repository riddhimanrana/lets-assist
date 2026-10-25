import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const distDir of [
  "",
  ".next-csf-isolated/cron-probe",
  ".next-csf-isolated/browser-app",
]) {
  test(`Next startup advisory policy for ${distDir || "the normal app"}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        'const config=(await import("./next.config.ts")).default; console.log(JSON.stringify({policy:config.experimental.agentUpgrade}));',
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          NEXT_DIST_DIR: distDir,
          CSF_BROWSER_SKIP_BUILD_TYPECHECK: "0",
          VERCEL_GIT_COMMIT_SHA: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      policy: distDir ? false : "security",
    });
  });
}
