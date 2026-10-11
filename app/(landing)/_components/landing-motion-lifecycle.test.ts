import { expect, test } from "bun:test";
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

for (const [scenario, behaviour] of scenarios) {
  test(`landing motion lifecycle: ${behaviour}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./landing-motion-lifecycle.fixture.tsx", import.meta.url),
        ),
        scenario,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 25000);
}
