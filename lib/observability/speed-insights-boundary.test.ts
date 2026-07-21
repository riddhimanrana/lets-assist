import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8",
);

describe("Speed Insights deployment boundary", () => {
  test("does not load Vercel telemetry scripts during local or self-hosted runs", () => {
    expect(layoutSource).toContain(
      'const enableSpeedInsights = process.env.VERCEL === "1";',
    );
    expect(layoutSource).toContain(
      "{enableSpeedInsights ? <SpeedInsights /> : null}",
    );
    expect(layoutSource).not.toContain("\n            <SpeedInsights />");
  });
});
