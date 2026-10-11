import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const childScenario = process.env.LETS_ASSIST_ATTENDEES_SCENARIO;
if (childScenario) {
  const runtime = await import("./usePublicAttendees.fixture");
  mock.module("react", () => runtime.attendeeReact);
  mock.module("@/lib/supabase/client", () => runtime.attendeeClient);
  mock.module("@/lib/safe-console", () => ({ safeConsole: { error() {} } }));
  test(`isolated scenario: ${childScenario}`, runtime.runAttendeeScenario);
} else {
  for (const scenario of [
    "participant",
    "manager",
    "restricted",
    "error-retry",
    "stale",
  ]) {
    test(`roster hook preserves authorization and loading lifecycle: ${scenario}`, () => {
      const result = spawnSync(
        process.execPath,
        ["test", fileURLToPath(import.meta.url)],
        {
          encoding: "utf8",
          timeout: 20000,
          env: { ...process.env, LETS_ASSIST_ATTENDEES_SCENARIO: scenario },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    }, 25000);
  }
}
