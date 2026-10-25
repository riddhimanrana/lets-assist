import { beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let user: { id: string } | null = { id: "fictional-account" };
let show = true;
const promptReads: unknown[][] = [];
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user }),
}));
mock.module("@/lib/plugins/resolve-platform-surfaces", () => ({
  resolvePlatformDashboardCards: async () => [],
}));
mock.module("@/lib/feedback/platform-prompt", () => ({
  getPlatformRatingPromptState: async (...args: unknown[]) => {
    promptReads.push(args);
    return show;
  },
}));
mock.module("./_components/dashboard-data", () => ({
  loadVolunteerDashboardData: async () => ({ user, uiCertificates: [] }),
}));
function ViewBoundary() {
  return null;
}
function PromptBoundary() {
  return null;
}
mock.module("./_components/VolunteerDashboardView", () => ({
  VolunteerDashboardView: ViewBoundary,
}));
mock.module("@/components/feedback/PlatformRatingPrompt", () => ({
  PlatformRatingPrompt: PromptBoundary,
}));
const { default: Page } = await import("./page");
beforeEach(() => {
  user = { id: "fictional-account" };
  show = true;
  promptReads.length = 0;
});
test("dashboard passes an eligible own-hours prompt into the view", async () => {
  const tree = await Page();
  expect(tree.type).toBe(ViewBoundary);
  expect(tree.props.ratingPrompt.type).toBe(PromptBoundary);
  expect(tree.props.ratingPrompt.props).toEqual({
    show: true,
    userId: user!.id,
    contextKind: "volunteer_hours",
    contextId: user!.id,
  });
  expect(promptReads).toEqual([
    [user!.id, { contextKind: "volunteer_hours", contextId: user!.id }],
  ]);
});
test("dashboard never mounts an ineligible prompt", async () => {
  show = false;
  expect((await Page()).props.ratingPrompt).toBeNull();
});
test("dashboard does not look up or mount a prompt without an account", async () => {
  user = null;
  expect((await Page()).props.ratingPrompt).toBeNull();
  expect(promptReads).toHaveLength(0);
});
