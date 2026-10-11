import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scenarios = [
  ["flip-cycle", "the headline word flips every 2500ms and cleans up"],
  ["flip-hidden", "the headline word holds still while the tab is hidden"],
  ["flip-hidden-mount", "a headline opened in a hidden tab starts no timer"],
  ["flip-reduced", "reduced motion gets a plain word, also mid-flip"],
  ["flip-short", "zero or one word never starts a timer"],
  [
    "flip-effect-replay",
    "headline effect cleanup/setup retains one timer and listener pair",
  ],
  ["qr-cycle", "the scanner goes idle, detected, idle on its schedule"],
  ["qr-hidden", "a hidden tab clears the detection and both timers"],
  ["qr-hidden-mount", "a scanner opened in a hidden tab starts no timer"],
  ["qr-reduced", "reduced motion gets a still scanner with no cycle"],
  ["qr-steps", "leaving view and rapid step changes leave nothing behind"],
  [
    "qr-effect-replay",
    "scanner effect cleanup/setup resets idle without duplicate timers",
  ],
] as const;

const childScenario = process.env.LETS_ASSIST_MOTION_SCENARIO;
if (childScenario) {
  const runtime = await import("./landing-motion-runtime.fixture");
  mock.module("react", () => runtime.motionReact);
  test(`isolated motion scenario: ${childScenario}`, async () => {
    const fixture = await import("./landing-motion-lifecycle.fixture");
    await fixture.runMotionScenario();
  });
} else {
  for (const [scenario, behaviour] of scenarios) {
    test(`landing motion lifecycle: ${behaviour}`, () => {
      const result = spawnSync(
        process.execPath,
        ["test", fileURLToPath(import.meta.url)],
        {
          encoding: "utf8",
          timeout: 20000,
          env: { ...process.env, LETS_ASSIST_MOTION_SCENARIO: scenario },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    }, 25000);
  }
}
