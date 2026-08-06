import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("email service modules", () => {
  test("the public module retains types, classification, and dispatch", () => {
    const core = read("services/email.ts");
    expect(core).toContain("export function classifyProviderError");
    expect(core).toContain('export { sendEmail } from "./email-send";');
  });

  test("provider classification and dispatch both meet the service budget", () => {
    for (const path of ["services/email.ts", "services/email-send.ts"]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
