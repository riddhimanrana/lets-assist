import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { statisticsReadFailure } from "./statistics-read-result";

const restores: Array<() => void> = [];
function capture() {
  const calls: unknown[][] = [];
  const spy = spyOn(console, "error").mockImplementation((...args) => {
    calls.push(args);
  });
  restores.push(() => spy.mockRestore());
  return calls;
}
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe("statistics diagnostics use the existing privacy boundary", () => {
  for (const [scope, event, code] of [
    ["reports", "Report statistics read failed", "42501"],
    ["moderation", "Moderation statistics read failed", "PGRST205"],
  ] as const) {
    test(`${scope} records a reviewed event and code without provider context`, () => {
      const calls = capture();
      const result = statisticsReadFailure(scope, {
        code,
        message: "fictional-private@example.test",
        details: { roster: ["Fictional private participant"] },
      });
      expect(calls).toEqual([
        [event, { error_kind: "Error", error_code: code }],
      ]);
      expect(result.error).toContain("Please try again.");
      expect(result.error).not.toContain("fictional-private");
    });
  }
  test("unknown codes and private thrown messages cannot escape", () => {
    const calls = capture();
    statisticsReadFailure("reports", {
      code: "fictional-private@example.test",
      message: "Fictional private message",
    });
    statisticsReadFailure("moderation", new Error("Fictional private message"));
    expect(calls).toEqual([
      ["Report statistics read failed", { error_kind: "Error" }],
      ["Moderation statistics read failed", { error_kind: "Error" }],
    ]);
  });
  test("diagnostics never evaluate a provider code getter", () => {
    const calls = capture();
    const error = Object.defineProperty({}, "code", {
      get() {
        throw new Error("Fictional private getter must not run");
      },
    });
    expect(() => statisticsReadFailure("reports", error)).not.toThrow();
    expect(calls).toEqual([
      ["Report statistics read failed", { error_kind: "Error" }],
    ]);
  });
});
