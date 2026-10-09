import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/app/admin/actions", () => ({
  checkSuperAdmin: async () => ({ isAdmin: true, userId: "operator" }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("Archived activation must fail before any provider write");
  },
}));

const {
  upsertPluginCatalogControl,
  upsertOrganizationPluginEntitlement,
  bulkUpsertOrganizationPluginEntitlements,
} = await import("./catalog-entitlements");

test("an operator cannot restore an archived offering through catalog controls", async () => {
  const result = await upsertPluginCatalogControl({
    key: " DV-SPEECH-DEBATE ",
    name: "Speech and Debate",
    visibility: "private",
    isActive: true,
    latestVersion: "2.0.3",
    privateCodebase: true,
  });
  expect(result.success).toBe(false);
  expect(result.error).toContain("archived");
});

test("single and bulk grants cannot activate archived reference code", async () => {
  for (const result of [
    await upsertOrganizationPluginEntitlement({
      organizationId: "fictional-organization",
      pluginKey: "dv-speech-debate",
      status: "active",
    }),
    await bulkUpsertOrganizationPluginEntitlements({
      organizationIdentifiers: "fictional-organization",
      pluginKey: "dv-speech-debate",
      status: "active",
    }),
  ]) {
    expect(result.success).toBe(false);
    expect(result.error).toContain("archived");
  }
});
