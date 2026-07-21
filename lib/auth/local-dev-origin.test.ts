import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("local browser verification origin", () => {
  test("permits only the loopback hostname required by local browser tests", () => {
    const source = readFileSync(join(import.meta.dir, "../../next.config.ts"), "utf8");

    expect(source).toContain('allowedDevOrigins: ["127.0.0.1"]');
    expect(source).not.toMatch(/allowedDevOrigins:\s*\[[^\]]*["']\*["']/);
    expect(source).not.toMatch(/allowedDevOrigins:\s*\[[^\]]*https?:\/\//);
  });

  test("the login fallback cannot place credentials in the URL", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../app/login/LoginClient.tsx"),
      "utf8",
    );

    expect(source).toContain(
      '<form method="post" onSubmit={form.handleSubmit(onSubmit)}',
    );
  });

  test("the CSF workflow gate verifies the Let’s Assist port", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../scripts/local-dev/test-dvhs-csf-workflows.mjs"),
      "utf8",
    );

    expect(source).toContain('"http://localhost:3001"');
    expect(source).not.toContain('"http://localhost:3000"');
  });
});
