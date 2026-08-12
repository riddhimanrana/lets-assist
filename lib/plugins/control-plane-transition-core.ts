export type PluginInstallSnapshot = {
  id: string;
  enabled: boolean;
  installedVersion: string;
  configuration: Record<string, unknown>;
  updatedAt: string;
  installLifecycleComplete: boolean;
};

export type PluginControlPlaneTransition =
  | {
      kind: "install_or_enable";
      targetVersion: string;
      configuration?: Record<string, unknown>;
    }
  | { kind: "disable" }
  | { kind: "uninstall" }
  | {
      kind: "config_update";
      configuration: Record<string, unknown>;
      /** Install revision read by the editing surface; stale writes fail closed. */
      expectedUpdatedAt?: string;
    }
  | { kind: "version_update"; targetVersion: string };

export type PluginLifecycleInvocation =
  | { hook: "install"; config: Record<string, unknown> }
  | { hook: "enable"; config: Record<string, unknown> }
  | { hook: "disable"; config: Record<string, unknown> }
  | { hook: "uninstall"; config: Record<string, unknown> }
  | {
      hook: "config_update";
      config: Record<string, unknown>;
      previousConfig: Record<string, unknown>;
    }
  | {
      hook: "version_update";
      config: Record<string, unknown>;
      previousVersion: string;
      newVersion: string;
    };

export type PluginInstallMutation = {
  enabled?: boolean;
  installedVersion?: string;
  configuration?: Record<string, unknown>;
  versionUpdated?: boolean;
};

export type PluginControlPlaneAuditAction =
  | "install.created"
  | "install.updated"
  | "install.enabled"
  | "install.disabled"
  | "install.config_changed"
  | "install.version_updated"
  | "install.removed";

export type PluginControlPlaneCallbacks = {
  runLifecycle: (
    invocation: PluginLifecycleInvocation,
  ) => Promise<{ success: boolean; error?: string }>;
  createInstall: (input: {
    enabled: true;
    installedVersion: string;
    configuration: Record<string, unknown>;
  }) => Promise<void>;
  updateInstall: (mutation: PluginInstallMutation) => Promise<void>;
  removeInstall: () => Promise<void>;
};

export type PluginControlPlaneTransitionResult = {
  success: boolean;
  changed: boolean;
  actions: PluginControlPlaneAuditAction[];
  error?: string;
};

export class PluginControlPlaneConcurrencyError extends Error {
  constructor(
    message = "Plugin install state changed concurrently; retry the operation.",
  ) {
    super(message);
    this.name = "PluginControlPlaneConcurrencyError";
  }
}

/**
 * Extra audit detail for one control-plane action, merged alongside the
 * transition kind.
 *
 * For `install.removed`, this deliberately does NOT assert
 * `pluginDataRetained: true`. The platform's own DELETE only ever removes
 * `organization_plugin_installs`, but `onUninstall` is an arbitrary plugin
 * hook that runs first, with the service role, and nothing constrains what
 * it does to `plugin_data` — the platform cannot certify a guarantee about
 * code it does not control. The two facts below are ones the platform
 * actually controls and can certify: its own row removal happened, and it
 * did not invoke the separate erasure path
 * (`onDataDelete`/`runPluginDataDelete`) as part of this transition.
 */
export function pluginControlPlaneAuditDetails(
  action: PluginControlPlaneAuditAction,
  context?: { configuration?: Record<string, unknown> },
): Record<string, unknown> {
  if (action === "install.removed") {
    return {
      platformInstallRowRemoved: true,
      pluginDataDeletionNotRequested: true,
      // A boolean fact, never the configuration content itself — the
      // configuration blob can hold plugin-defined values that should not
      // be persisted verbatim into an audit log.
      configurationRemoved: Boolean(
        context?.configuration && Object.keys(context.configuration).length > 0,
      ),
    };
  }
  return {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inverseLifecycleInvocation(
  invocation: PluginLifecycleInvocation,
): PluginLifecycleInvocation {
  switch (invocation.hook) {
    case "install":
      return { hook: "uninstall", config: invocation.config };
    case "uninstall":
      return { hook: "install", config: invocation.config };
    case "enable":
      return { hook: "disable", config: invocation.config };
    case "disable":
      return { hook: "enable", config: invocation.config };
    case "config_update":
      return {
        hook: "config_update",
        config: invocation.previousConfig,
        previousConfig: invocation.config,
      };
    case "version_update":
      return {
        hook: "version_update",
        config: invocation.config,
        previousVersion: invocation.newVersion,
        newVersion: invocation.previousVersion,
      };
  }
}

async function compensateLifecycle(
  completed: PluginLifecycleInvocation[],
  callbacks: PluginControlPlaneCallbacks,
) {
  const errors: string[] = [];
  for (const invocation of [...completed].reverse()) {
    const inverse = inverseLifecycleInvocation(invocation);
    try {
      const result = await callbacks.runLifecycle(inverse);
      if (!result.success) {
        errors.push(
          `${inverse.hook}: ${result.error ?? "unknown lifecycle error"}`,
        );
      }
    } catch (error) {
      errors.push(`${inverse.hook}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

async function runLifecycleSequence(
  invocations: PluginLifecycleInvocation[],
  callbacks: PluginControlPlaneCallbacks,
): Promise<
  | { success: true; completed: PluginLifecycleInvocation[] }
  | { success: false; error: string }
> {
  const completed: PluginLifecycleInvocation[] = [];
  for (const invocation of invocations) {
    let result: { success: boolean; error?: string };
    try {
      result = await callbacks.runLifecycle(invocation);
    } catch (error) {
      result = { success: false, error: errorMessage(error) };
    }

    if (!result.success) {
      const compensationErrors = await compensateLifecycle(
        completed,
        callbacks,
      );
      const compensationSuffix = compensationErrors.length
        ? ` Compensation also failed: ${compensationErrors.join("; ")}`
        : "";
      return {
        success: false,
        error: `Plugin ${invocation.hook} lifecycle failed: ${result.error ?? "unknown lifecycle error"}.${compensationSuffix}`,
      };
    }
    completed.push(invocation);
  }
  return { success: true, completed };
}

async function persistAfterLifecycle(
  completed: PluginLifecycleInvocation[],
  callbacks: PluginControlPlaneCallbacks,
  persist: () => Promise<void>,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await persist();
    return { success: true };
  } catch (error) {
    // The adapter serializes control-plane transitions before lifecycle hooks
    // run. A stale optimistic write therefore represents an out-of-band state
    // change, not a competing lifecycle transition we should preserve.
    const compensationErrors = await compensateLifecycle(completed, callbacks);
    const compensationSuffix = compensationErrors.length
      ? ` Lifecycle compensation also failed: ${compensationErrors.join("; ")}`
      : "";
    return {
      success: false,
      error: `Failed to persist plugin install state: ${errorMessage(error)}.${compensationSuffix}`,
    };
  }
}

export async function applyPluginControlPlaneTransition(input: {
  current: PluginInstallSnapshot | null;
  transition: PluginControlPlaneTransition;
  callbacks: PluginControlPlaneCallbacks;
}): Promise<PluginControlPlaneTransitionResult> {
  const { current, transition, callbacks } = input;

  if (transition.kind === "install_or_enable") {
    if (!current) {
      const configuration = transition.configuration ?? {};
      const lifecycle = await runLifecycleSequence(
        [{ hook: "install", config: configuration }],
        callbacks,
      );
      if (!lifecycle.success)
        return { ...lifecycle, changed: false, actions: [] };

      const persisted = await persistAfterLifecycle(
        lifecycle.completed,
        callbacks,
        () =>
          callbacks.createInstall({
            enabled: true,
            installedVersion: transition.targetVersion,
            configuration,
          }),
      );
      if (!persisted.success)
        return { ...persisted, changed: false, actions: [] };
      return { success: true, changed: true, actions: ["install.created"] };
    }

    const invocations: PluginLifecycleInvocation[] = [];
    const actions: PluginControlPlaneAuditAction[] = [];
    if (!current.installLifecycleComplete) {
      invocations.push({ hook: "install", config: current.configuration });
      actions.push("install.updated");
    }
    if (current.installedVersion !== transition.targetVersion) {
      invocations.push({
        hook: "version_update",
        config: current.configuration,
        previousVersion: current.installedVersion,
        newVersion: transition.targetVersion,
      });
      actions.push("install.version_updated");
    }
    if (!current.enabled && current.installLifecycleComplete) {
      invocations.push({ hook: "enable", config: current.configuration });
    }
    if (!current.enabled) {
      actions.push("install.enabled");
    }
    if (invocations.length === 0) {
      return { success: true, changed: false, actions: [] };
    }

    const lifecycle = await runLifecycleSequence(invocations, callbacks);
    if (!lifecycle.success)
      return { ...lifecycle, changed: false, actions: [] };
    const persisted = await persistAfterLifecycle(
      lifecycle.completed,
      callbacks,
      () =>
        callbacks.updateInstall({
          enabled: true,
          installedVersion: transition.targetVersion,
          versionUpdated: current.installedVersion !== transition.targetVersion,
        }),
    );
    if (!persisted.success)
      return { ...persisted, changed: false, actions: [] };
    return { success: true, changed: true, actions };
  }

  if (!current) {
    if (transition.kind === "uninstall") {
      // A repeat uninstall (lost response, retried request, double click)
      // observes no install row and has nothing left to do. Refusing here
      // would be a false error for an already-satisfied request; silently
      // "succeeding" while rerunning the uninstall hook or re-emitting
      // install.removed would be worse, since neither happened. Report the
      // one thing that is true: no change.
      return { success: true, changed: false, actions: [] };
    }
    return {
      success: false,
      changed: false,
      actions: [],
      error: "Plugin is not installed for this organization.",
    };
  }

  if (transition.kind === "disable") {
    if (!current.enabled) return { success: true, changed: false, actions: [] };
    const lifecycle = await runLifecycleSequence(
      [{ hook: "disable", config: current.configuration }],
      callbacks,
    );
    if (!lifecycle.success)
      return { ...lifecycle, changed: false, actions: [] };
    const persisted = await persistAfterLifecycle(
      lifecycle.completed,
      callbacks,
      () => callbacks.updateInstall({ enabled: false }),
    );
    if (!persisted.success)
      return { ...persisted, changed: false, actions: [] };
    return { success: true, changed: true, actions: ["install.disabled"] };
  }

  if (transition.kind === "uninstall") {
    const lifecycle = await runLifecycleSequence(
      [{ hook: "uninstall", config: current.configuration }],
      callbacks,
    );
    if (!lifecycle.success)
      return { ...lifecycle, changed: false, actions: [] };
    const persisted = await persistAfterLifecycle(
      lifecycle.completed,
      callbacks,
      callbacks.removeInstall,
    );
    if (!persisted.success)
      return { ...persisted, changed: false, actions: [] };
    return { success: true, changed: true, actions: ["install.removed"] };
  }

  if (transition.kind === "config_update") {
    if (
      transition.expectedUpdatedAt !== undefined &&
      transition.expectedUpdatedAt !== current.updatedAt
    ) {
      return {
        success: false,
        changed: false,
        actions: [],
        error:
          "Plugin settings changed after this screen loaded. Reload and try again.",
      };
    }
    const lifecycle = await runLifecycleSequence(
      [
        {
          hook: "config_update",
          config: transition.configuration,
          previousConfig: current.configuration,
        },
      ],
      callbacks,
    );
    if (!lifecycle.success)
      return { ...lifecycle, changed: false, actions: [] };
    const persisted = await persistAfterLifecycle(
      lifecycle.completed,
      callbacks,
      () =>
        callbacks.updateInstall({ configuration: transition.configuration }),
    );
    if (!persisted.success)
      return { ...persisted, changed: false, actions: [] };
    return {
      success: true,
      changed: true,
      actions: ["install.config_changed"],
    };
  }

  const invocations: PluginLifecycleInvocation[] = [];
  const actions: PluginControlPlaneAuditAction[] = [];
  if (!current.installLifecycleComplete) {
    invocations.push({ hook: "install", config: current.configuration });
    actions.push("install.updated");
  }
  if (current.installedVersion !== transition.targetVersion) {
    invocations.push({
      hook: "version_update",
      config: current.configuration,
      previousVersion: current.installedVersion,
      newVersion: transition.targetVersion,
    });
    actions.push("install.version_updated");
  }
  if (!current.enabled && current.installLifecycleComplete) {
    invocations.push({ hook: "enable", config: current.configuration });
  }
  if (!current.enabled) {
    actions.push("install.enabled");
  }
  if (invocations.length === 0) {
    return { success: true, changed: false, actions: [] };
  }

  const lifecycle = await runLifecycleSequence(invocations, callbacks);
  if (!lifecycle.success) return { ...lifecycle, changed: false, actions: [] };
  const persisted = await persistAfterLifecycle(
    lifecycle.completed,
    callbacks,
    () =>
      callbacks.updateInstall({
        enabled: true,
        installedVersion: transition.targetVersion,
        versionUpdated: current.installedVersion !== transition.targetVersion,
      }),
  );
  if (!persisted.success) return { ...persisted, changed: false, actions: [] };
  return { success: true, changed: true, actions };
}
