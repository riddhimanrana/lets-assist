import { safeErrorAttributes, sanitizeLogRecord } from "./log-privacy";

type ConsoleLevel = "debug" | "info" | "log" | "warn" | "error";

/** Browser and server diagnostics share the same data boundary. */
function emit(level: ConsoleLevel, args: unknown[]): void {
  try {
    const attributes: Record<string, unknown> = Object.create(null);
    for (const value of args) {
      if (!value || typeof value !== "object") continue;
      // Do not evaluate arbitrary getters or serialize nested provider data.
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
      )) {
        if ("value" in descriptor) attributes[key] = descriptor.value;
      }
      if (value instanceof Error)
        Object.assign(attributes, safeErrorAttributes(value));
      else if (Object.hasOwn(attributes, "code")) {
        attributes.error_code = attributes.code;
      }
    }
    const event = sanitizeLogRecord(
      typeof args[0] === "string" ? args[0] : "Unregistered application event",
      attributes,
    );
    console[level](event.body, event.attributes);
  } catch {
    // Diagnostics must never interrupt a user operation or fall back to raw data.
  }
}

export const safeConsole = Object.freeze({
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  log: (...args: unknown[]) => emit("log", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
});
