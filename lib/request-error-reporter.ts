import type { flushLogs, logError } from "./logger";

/** Never inspect request URLs, headers, cookies, bodies, or provider error text. */
export async function reportRequestError(
  error: unknown,
  context: { method: string; routeType: string; routerKind: string },
  sink?: { logError: typeof logError; flushLogs: typeof flushLogs },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reporter = sink ?? (await import("./logger"));
    reporter.logError("Unhandled server request failure", error, {
      request_method: context.method,
      route_type: context.routeType,
      router_kind: context.routerKind,
    });
    await Promise.race([
      reporter.flushLogs(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // Telemetry failure must not replace the original application failure.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
