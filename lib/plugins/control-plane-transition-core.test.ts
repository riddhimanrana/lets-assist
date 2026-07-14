import { describe, expect, test } from "bun:test";

import {
  applyPluginControlPlaneTransition,
  PluginControlPlaneConcurrencyError,
  type PluginControlPlaneCallbacks,
  type PluginInstallSnapshot,
  type PluginLifecycleInvocation,
} from "./control-plane-transition-core";

const currentInstall: PluginInstallSnapshot = {
  id: "install-1",
  enabled: true,
  installedVersion: "1.0.0",
  configuration: { mode: "old" },
  updatedAt: "2026-07-11T00:00:00.000Z",
  installLifecycleComplete: true,
};

function lifecycleLabel(invocation: PluginLifecycleInvocation) {
  if (invocation.hook === "config_update") {
    return `lifecycle:${invocation.hook}:${String(invocation.config.mode)}`;
  }
  if (invocation.hook === "version_update") {
    return `lifecycle:${invocation.hook}:${invocation.previousVersion}->${invocation.newVersion}`;
  }
  return `lifecycle:${invocation.hook}`;
}

function callbacks(options?: {
  failLifecycle?: (invocation: PluginLifecycleInvocation) => boolean;
  failPersistence?: "create" | "update" | "remove";
}) {
  const events: string[] = [];
  const implementation: PluginControlPlaneCallbacks = {
    runLifecycle: async (invocation) => {
      events.push(lifecycleLabel(invocation));
      if (options?.failLifecycle?.(invocation)) {
        return { success: false, error: "hook failed" };
      }
      return { success: true };
    },
    createInstall: async () => {
      events.push("persist:create");
      if (options?.failPersistence === "create") throw new Error("create failed");
    },
    updateInstall: async () => {
      events.push("persist:update");
      if (options?.failPersistence === "update") throw new Error("update failed");
    },
    removeInstall: async () => {
      events.push("persist:remove");
      if (options?.failPersistence === "remove") throw new Error("remove failed");
    },
  };
  return { events, implementation };
}

describe("plugin control-plane lifecycle ordering", () => {
  test("a failed install hook never creates an enabled install row", async () => {
    const harness = callbacks({
      failLifecycle: (invocation) => invocation.hook === "install",
    });
    const result = await applyPluginControlPlaneTransition({
      current: null,
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: harness.implementation,
    });

    expect(result.success).toBe(false);
    expect(result.changed).toBe(false);
    expect(harness.events).toEqual(["lifecycle:install"]);
  });

  test("a new install is persisted only after its install hook succeeds", async () => {
    const harness = callbacks();
    const result = await applyPluginControlPlaneTransition({
      current: null,
      transition: {
        kind: "install_or_enable",
        targetVersion: "1.0.0",
        configuration: { mode: "new" },
      },
      callbacks: harness.implementation,
    });

    expect(result).toMatchObject({
      success: true,
      changed: true,
      actions: ["install.created"],
    });
    expect(harness.events).toEqual(["lifecycle:install", "persist:create"]);
  });

  test("re-enabling an existing install runs enable, never install", async () => {
    const harness = callbacks();
    const result = await applyPluginControlPlaneTransition({
      current: { ...currentInstall, enabled: false },
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: harness.implementation,
    });

    expect(result).toMatchObject({
      success: true,
      actions: ["install.enabled"],
    });
    expect(harness.events).toEqual(["lifecycle:enable", "persist:update"]);
  });

  test("a legacy install without lifecycle evidence is initialized exactly once", async () => {
    const harness = callbacks();
    const result = await applyPluginControlPlaneTransition({
      current: { ...currentInstall, installLifecycleComplete: false },
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: harness.implementation,
    });

    expect(result).toMatchObject({
      success: true,
      changed: true,
      actions: ["install.updated"],
    });
    expect(harness.events).toEqual(["lifecycle:install", "persist:update"]);
  });

  test("a disabled legacy install uses install initialization instead of enable", async () => {
    const harness = callbacks();
    const result = await applyPluginControlPlaneTransition({
      current: {
        ...currentInstall,
        enabled: false,
        installLifecycleComplete: false,
      },
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: harness.implementation,
    });

    expect(result.actions).toEqual(["install.updated", "install.enabled"]);
    expect(harness.events).toEqual(["lifecycle:install", "persist:update"]);
  });

  test("disable and uninstall hooks veto state changes", async () => {
    for (const transition of [{ kind: "disable" }, { kind: "uninstall" }] as const) {
      const harness = callbacks({
        failLifecycle: (invocation) => invocation.hook === transition.kind,
      });
      const result = await applyPluginControlPlaneTransition({
        current: currentInstall,
        transition,
        callbacks: harness.implementation,
      });

      expect(result.success).toBe(false);
      expect(harness.events).toEqual([`lifecycle:${transition.kind}`]);
    }
  });

  test("disable and uninstall persist only after their hooks succeed", async () => {
    const disableHarness = callbacks();
    const disabled = await applyPluginControlPlaneTransition({
      current: currentInstall,
      transition: { kind: "disable" },
      callbacks: disableHarness.implementation,
    });
    expect(disabled.success).toBe(true);
    expect(disableHarness.events).toEqual(["lifecycle:disable", "persist:update"]);

    const uninstallHarness = callbacks();
    const uninstalled = await applyPluginControlPlaneTransition({
      current: currentInstall,
      transition: { kind: "uninstall" },
      callbacks: uninstallHarness.implementation,
    });
    expect(uninstalled.success).toBe(true);
    expect(uninstallHarness.events).toEqual(["lifecycle:uninstall", "persist:remove"]);
  });

  test("config persistence failure invokes the inverse config hook", async () => {
    const harness = callbacks({ failPersistence: "update" });
    const result = await applyPluginControlPlaneTransition({
      current: currentInstall,
      transition: { kind: "config_update", configuration: { mode: "new" } },
      callbacks: harness.implementation,
    });

    expect(result.success).toBe(false);
    expect(result.changed).toBe(false);
    expect(harness.events).toEqual([
      "lifecycle:config_update:new",
      "persist:update",
      "lifecycle:config_update:old",
    ]);
  });

  test("a disabled version update runs both hooks before one state mutation", async () => {
    const harness = callbacks();
    const result = await applyPluginControlPlaneTransition({
      current: { ...currentInstall, enabled: false },
      transition: { kind: "version_update", targetVersion: "2.0.0" },
      callbacks: harness.implementation,
    });

    expect(result).toMatchObject({
      success: true,
      changed: true,
      actions: ["install.version_updated", "install.enabled"],
    });
    expect(harness.events).toEqual([
      "lifecycle:version_update:1.0.0->2.0.0",
      "lifecycle:enable",
      "persist:update",
    ]);
  });

  test("a later lifecycle failure compensates earlier successful hooks", async () => {
    const harness = callbacks({
      failLifecycle: (invocation) => invocation.hook === "enable",
    });
    const result = await applyPluginControlPlaneTransition({
      current: { ...currentInstall, enabled: false },
      transition: { kind: "version_update", targetVersion: "2.0.0" },
      callbacks: harness.implementation,
    });

    expect(result.success).toBe(false);
    expect(harness.events).toEqual([
      "lifecycle:version_update:1.0.0->2.0.0",
      "lifecycle:enable",
      "lifecycle:version_update:2.0.0->1.0.0",
    ]);
  });

  test("a failed install insert invokes uninstall compensation", async () => {
    const harness = callbacks({ failPersistence: "create" });
    const result = await applyPluginControlPlaneTransition({
      current: null,
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: harness.implementation,
    });

    expect(result.success).toBe(false);
    expect(harness.events).toEqual([
      "lifecycle:install",
      "persist:create",
      "lifecycle:uninstall",
    ]);
  });

  test("a stale optimistic write compensates lifecycle side effects", async () => {
    const events: string[] = [];
    const result = await applyPluginControlPlaneTransition({
      current: { ...currentInstall, enabled: false },
      transition: { kind: "install_or_enable", targetVersion: "1.0.0" },
      callbacks: {
        runLifecycle: async (invocation) => {
          events.push(lifecycleLabel(invocation));
          return { success: true };
        },
        createInstall: async () => undefined,
        updateInstall: async () => {
          events.push("persist:update");
          throw new PluginControlPlaneConcurrencyError();
        },
        removeInstall: async () => undefined,
      },
    });

    expect(result.success).toBe(false);
    expect(events).toEqual([
      "lifecycle:enable",
      "persist:update",
      "lifecycle:disable",
    ]);
  });
});
