import { describe, expect, it } from "vitest";

import { isProtectedPath } from "@/lib/supabase/proxy";

describe("isProtectedPath", () => {
  it("keeps organization browsing public", () => {
    expect(isProtectedPath("/organization")).toBe(false);
    expect(isProtectedPath("/organization/some-org")).toBe(false);
    expect(isProtectedPath("/organization/join")).toBe(false);
  });

  it("still protects organization creation routes", () => {
    expect(isProtectedPath("/organization/create")).toBe(true);
    expect(isProtectedPath("/organization/create/step-2")).toBe(true);
  });

  it("still protects other authenticated areas", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/account/profile")).toBe(true);
  });
});