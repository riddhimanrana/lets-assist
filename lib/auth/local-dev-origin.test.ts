import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("local browser verification origin", () => {
  test("permits only the loopback hostname required by local browser tests", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../next.config.ts"),
      "utf8",
    );

    expect(source).toContain('allowedDevOrigins: ["127.0.0.1"]');
    expect(source).not.toMatch(/allowedDevOrigins:\s*\[[^\]]*["']\*["']/);
    expect(source).not.toMatch(/allowedDevOrigins:\s*\[[^\]]*https?:\/\//);
  });

  test("the login fallback cannot place credentials in the URL", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../app/login/LoginClient.tsx"),
      "utf8",
    );

    // Bound the assertion to the credential form's own opening tag, whitespace
    // and line breaks included, rather than to one formatting of that JSX.
    const formTags = [...source.matchAll(/<form\b[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(formTags.length).toBe(1);

    const [credentialForm] = formTags;
    // A GET form would put the email and password in the query string.
    expect(credentialForm).toMatch(/\bmethod\s*=\s*"post"/u);
    expect(credentialForm).not.toMatch(/\bmethod\s*=\s*"get"/iu);
    // Submission is handled in JavaScript by the validated handler, so the
    // browser never serializes those fields into a URL.
    expect(credentialForm).toMatch(
      /\bonSubmit\s*=\s*\{\s*form\.handleSubmit\(\s*onSubmit\s*\)\s*\}/u,
    );
    // No action attribute at all: nothing can redirect the POST elsewhere.
    expect(credentialForm).not.toMatch(/\baction\s*=/u);

    // And no navigation anywhere in the client carries credentials.
    for (const navigation of [
      ...source.matchAll(/window\.location\.(?:assign|href|replace)[^;\n]*/gu),
      ...source.matchAll(/navigateAfterAuth\([^)]*\)/gu),
    ]) {
      expect(navigation[0]).not.toMatch(/password|data\.email/iu);
    }
  });

  test("the CSF isolated stack pins the Let’s Assist port", () => {
    const launcher = readFileSync(
      join(
        import.meta.dir,
        "../../scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
      ),
      "utf8",
    );
    const environmentContract = readFileSync(
      join(import.meta.dir, "../../scripts/local-dev/dv-local-env.mjs"),
      "utf8",
    );

    expect(launcher).toContain(
      'emit_app_env_value NEXT_PUBLIC_SITE_URL "http://localhost:3000"',
    );
    expect(launcher).toContain(
      'emit_app_env_value SITE_URL "http://localhost:3000"',
    );
    expect(launcher).toContain(
      'emit_app_env_value NEXT_PUBLIC_VERCEL_URL "localhost:3000"',
    );
    expect(environmentContract).toContain(
      'const CSF_ISOLATED_SITE_URL = "http://localhost:3000";',
    );
    expect(environmentContract).toContain(
      'const CSF_ISOLATED_VERCEL_URL = "localhost:3000";',
    );
  });

  test("the CSF workflow gate never assumes a default app origin", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../../scripts/local-dev/test-dvhs-csf-workflows.mjs",
      ),
      "utf8",
    );

    // A default origin is what previously let a real privacy failure be reported
    // as "app unavailable"; the route is only ever checked when explicitly asked.
    expect(source).not.toContain('"http://localhost:3001"');
    expect(source).not.toContain('"http://localhost:3000"');
    expect(source).not.toMatch(/CSF_APP_URL\s*\?\?/u);
    expect(source).toContain(
      "const appOrigin = process.env.CSF_APP_URL?.trim();",
    );
    expect(source).toContain("if (appOrigin) {");
    expect(source).toMatch(/fetch\(`\$\{appOrigin\}/u);
  });
});
