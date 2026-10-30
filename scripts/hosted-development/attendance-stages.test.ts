import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import AttendanceReporter from "./attendance-reporter.mjs";
import {
  ATTENDANCE_STAGES,
  hostedJourneyFailure,
  reportedStage,
} from "./attendance-stages.mjs";

const spec = readFileSync(
  new URL(
    "../../tests/e2e/attendance/paper-attendance.spec.ts",
    import.meta.url,
  ),
  "utf8",
);
const secret = "fixture-secret-not-for-output";
const generic =
  "Hosted attendance guest journey: failed (ATTENDANCE_JOURNEY_FAILED).";

function reportFailure(result: Record<string, unknown>) {
  const output: string[] = [];
  const reporter = new AttendanceReporter({}, (line: string) =>
    output.push(line),
  );
  reporter.onBegin();
  reporter.onStdOut(secret);
  reporter.onStdErr(secret);
  reporter.onTestEnd({ title: secret }, { status: "failed", ...result });
  reporter.onEnd({ status: "failed" });
  return output;
}

describe("hosted attendance stage codes", () => {
  test("the stages are a closed, ordered list of fixed codes", () => {
    expect(Object.isFrozen(ATTENDANCE_STAGES)).toBe(true);
    ATTENDANCE_STAGES.forEach((stage, index) => {
      expect(stage).toMatch(/^S\d{2}_[A-Z_]+$/u);
      expect(stage.slice(1, 3)).toBe(String(index + 1).padStart(2, "0"));
    });
    expect(new Set(ATTENDANCE_STAGES).size).toBe(ATTENDANCE_STAGES.length);
    expect(() => hostedJourneyFailure("S99_UNKNOWN")).toThrow(
      "Unknown hosted attendance stage.",
    );
    expect(() => hostedJourneyFailure(`S02_SIGN_IN ${secret}`)).toThrow();
  });

  test("the journey assigns every phase once, in order, at fixed boundaries", () => {
    const assigned = [
      ...spec.matchAll(/(?:let )?stage = "([A-Z0-9_]+)";/gu),
    ].map((match) => match[1]);
    expect(assigned).toEqual(ATTENDANCE_STAGES.slice(0, -1));
    // Cleanup is reported only after a successful journey, outside `finally`.
    expect(spec).toContain(
      '  if (env.hosted && cleanupFailed)\n    throw new Error(hostedJourneyFailure("S17_CLEANUP"));',
    );
    // The stage is never built from runtime values.
    expect(spec).not.toMatch(/stage = (?!")/u);
    expect(spec).not.toMatch(
      /hostedJourneyFailure\((?!stage\)|"S17_CLEANUP"\))/u,
    );
  });
});

describe("hosted attendance reporter stage output", () => {
  test("prints a known stage from its exact fixed failure only", () => {
    for (const stage of ATTENDANCE_STAGES)
      for (const message of [
        hostedJourneyFailure(stage),
        `Error: ${hostedJourneyFailure(stage)}`,
      ]) {
        const output = reportFailure({
          errors: [{ message, stack: secret }],
          attachments: [{ path: secret, body: secret }],
        });
        expect(output).toEqual([
          "Hosted attendance acceptance started.",
          `Hosted attendance guest journey: failed at ${stage} (ATTENDANCE_JOURNEY_FAILED).`,
          "Hosted attendance acceptance failed.",
        ]);
      }
  });

  test("a soft cleanup error beside one fixed failure keeps that stage", () => {
    expect(
      reportedStage([
        { message: hostedJourneyFailure("S07_MOBILE_REVIEW") },
        { message: `Error: Fictional fixture cleanup\n${secret}` },
      ]),
    ).toBe("S07_MOBILE_REVIEW");
  });

  const fixed = hostedJourneyFailure("S02_SIGN_IN");
  const rejected: Record<string, unknown>[] = [
    { errors: [{ message: fixed.replace("S02_SIGN_IN", "S99_UNKNOWN") }] },
    { errors: [{ message: fixed.replace("S02_SIGN_IN", "s02_sign_in") }] },
    { errors: [{ message: fixed.replace("S02_SIGN_IN", `S02_${secret}`) }] },
    {
      errors: [
        { message: fixed.replace("S02_SIGN_IN", `S02_SIGN_IN ${secret}`) },
      ],
    },
    { errors: [{ message: `${fixed} ${secret}` }] },
    { errors: [{ message: `${secret} ${fixed}` }] },
    { errors: [{ message: `${fixed}\n${secret}` }] },
    { errors: [{ message: `TimeoutError: ${fixed}` }] },
    {
      errors: [
        { message: `goto https://dev.lets-assist.com/?token=${secret}` },
      ],
    },
    { errors: [{ message: secret, stack: fixed }] },
    { errors: [{ value: fixed }] },
    { errors: [{ message: { toString: () => fixed } }] },
    { errors: fixed },
    { errors: [null, 7, fixed] },
    {
      errors: [
        { message: fixed },
        { message: hostedJourneyFailure("S09_PUBLISH") },
      ],
    },
    { error: { message: fixed } },
    { attachments: [{ name: fixed, path: secret }] },
    {},
  ];
  for (const [index, result] of rejected.entries())
    test(`falls back to the generic failure for rejected input ${index + 1}`, () => {
      const output = reportFailure(result);
      expect(output[1]).toBe(generic);
      expect(output.join("\n")).not.toContain(secret);
      expect(output.join("\n")).not.toContain("https:");
      expect(output.join("\n")).not.toContain("S02_SIGN_IN");
    });
});
