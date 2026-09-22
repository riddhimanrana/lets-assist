import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
function deferred() {
  let resolve!: (value: unknown[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const calls: Array<{ key: string; options: Record<string, unknown> }> = [];
let reads: Record<string, ReturnType<typeof deferred>> = {};
mock.module("@/lib/plugins/resolve-plugin-behaviors", () => ({
  resolveOrganizationPluginBehaviorHook: (options: Record<string, unknown>) => {
    const key = String(options.hook);
    calls.push({ key, options });
    return reads[key].promise;
  },
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: (options: Record<string, unknown>) => {
    calls.push({ key: "plugins", options });
    return reads.plugins.promise;
  },
}));
const { loadOrganizationPluginNavigation } =
  await import("./plugin-navigation-read");
const input = {
  organizationId: "chapter-one",
  organizationSlug: "fictional-chapter",
  organizationName: "Fictional chapter",
  viewerRole: "staff" as const,
  viewerUserId: "actor-one",
  userId: "actor-one",
  userEmail: "fictional@example.test",
  searchParams: { tab: "csf-applications", csf_application_term: "term-one" },
};
beforeEach(() => {
  calls.length = 0;
  reads = {
    "organization.tabs": deferred(),
    "organization.navigation.overrides": deferred(),
    plugins: deferred(),
  };
});

test("independent navigation reads all start before any one resolves", async () => {
  const pending = loadOrganizationPluginNavigation(input);
  expect(calls.map(({ key }) => key)).toEqual(Object.keys(reads));
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  type Navigation = Awaited<
    ReturnType<typeof loadOrganizationPluginNavigation>
  >;
  const plugins: Navigation["plugins"] = [];
  const overrides: Navigation["overrides"] = [];
  const tabs: Navigation["tabs"] = [];
  reads.plugins.resolve(plugins);
  reads["organization.navigation.overrides"].resolve(overrides);
  await Promise.resolve();
  expect(settled).toBe(false);
  reads["organization.tabs"].resolve(tabs);
  const result = await pending;
  expect(result.tabs).toBe(tabs);
  expect(result.overrides).toBe(overrides);
  expect(result.plugins).toBe(plugins);
  for (const { options } of calls) {
    expect(options.organizationId).toBe(input.organizationId);
    expect(options.viewerUserId).toBe(input.viewerUserId);
  }
  expect(calls[0].options.hookInput).toEqual({
    searchParams: input.searchParams,
  });
  expect(calls[1].options.hookInput).toBeUndefined();
  expect(calls[0].options.target).toEqual({
    userId: input.userId,
    userEmail: input.userEmail,
  });
  expect(calls[2].options.userRole).toBe("staff");
  for (const { options } of calls.slice(0, 2)) {
    expect(options.useAdminClient).toBe(true);
    expect(options.viewerRole).toBe(input.viewerRole);
    expect(options.organizationSlug).toBe(input.organizationSlug);
    expect(options.organizationName).toBe(input.organizationName);
    expect(options.target).toEqual({
      userId: input.userId,
      userEmail: input.userEmail,
    });
  }
});

test("a viewer without a current organization role starts no plugin reads", async () => {
  expect(
    await loadOrganizationPluginNavigation({ ...input, viewerRole: null }),
  ).toEqual({ tabs: [], overrides: [], plugins: [] });
  expect(calls).toHaveLength(0);
});

test("a failed access reader rejects the complete navigation result", async () => {
  const pending = loadOrganizationPluginNavigation(input);
  reads["organization.navigation.overrides"].reject(
    new Error("Access unavailable"),
  );
  reads["organization.tabs"].resolve([]);
  reads.plugins.resolve([]);
  await expect(pending).rejects.toThrow("Access unavailable");
});

test("another render reads access again with its own chapter and actor", async () => {
  for (const read of Object.values(reads)) read.resolve([]);
  await loadOrganizationPluginNavigation(input);
  await loadOrganizationPluginNavigation({
    ...input,
    organizationId: "chapter-two",
    viewerUserId: "actor-two",
    userId: "actor-two",
    viewerRole: "member",
  });
  expect(calls).toHaveLength(6);
  for (const { options } of calls.slice(3)) {
    expect(options.organizationId).toBe("chapter-two");
    expect(options.viewerUserId).toBe("actor-two");
  }
  expect(calls[5].options.userRole).toBe("member");
});
