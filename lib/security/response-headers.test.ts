import { expect, test } from "bun:test";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { securityResponseHeaders } from "./response-headers";
import nextConfig from "../../next.config";

for (const path of [
  "/",
  "/login",
  "/projects/fixture",
  "/api/webhooks/stripe",
  "/organization/fixture/plugins/csf",
  "/certificate-preview.pdf",
]) {
  test(`Next applies the baseline to ${path}`, async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://lets-assist.com${path}`,
      nextConfig,
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("permissions-policy")).toContain(
      "camera=(self)",
    );
  });
}
test("HTTPS persistence is restricted to hosted environments", async () => {
  for (const hosted of [true, false]) {
    const response = await unstable_getResponseFromNextConfig({
      url: "http://localhost:3000/login",
      nextConfig: { headers: () => securityResponseHeaders(hosted) },
    });
    expect(response.headers.has("strict-transport-security")).toBe(hosted);
  }
});
