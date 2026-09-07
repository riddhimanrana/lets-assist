const ROUTES = {
  member: ["home", "profile", "activities"],
  officer: ["home", "applications", "classes"],
};

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

export function passesHostedReadRouteBudgets(rows) {
  const expected = new Set(
    Object.entries(ROUTES).flatMap(([role, routes]) =>
      routes.map((route) => `${role}:${route}`),
    ),
  );
  if (rows.length !== expected.size) return false;
  for (const row of rows) {
    if (
      !expected.delete(`${row.role}:${row.route}`) ||
      !Number.isInteger(row.requests) ||
      row.requests <= 0 ||
      !Number.isFinite(row.p95Ms) ||
      row.p95Ms < 0 ||
      row.p95Ms > 2500 ||
      !Number.isFinite(row.p99Ms) ||
      row.p99Ms < 0 ||
      row.p99Ms > 5000
    )
      return false;
  }
  return expected.size === 0;
}

/** Retain only fixed route labels, timings, and bounded outcome categories. */
export function createHostedReadMetrics() {
  const groups = new Map();
  return {
    /** @param {{ role: string, routeIndex: number, durationMs: number, status?: unknown, failure?: unknown }} input */
    record({ role, routeIndex, durationMs, status, failure }) {
      const route =
        Object.hasOwn(ROUTES, role) && Number.isInteger(routeIndex)
          ? ROUTES[role][routeIndex]
          : null;
      if (!route || !Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error("Invalid hosted request metric.");
      }
      const key = `${role}:${route}`;
      const group = groups.get(key) ?? {
        role,
        route,
        timings: [],
        outcomes: {},
      };
      const outcome = failure
        ? failure === "timeout"
          ? "timeout"
          : "request_failure"
        : Number.isInteger(status) && status >= 100 && status <= 599
          ? `http_${status}`
          : "invalid_status";
      group.timings.push(durationMs);
      group.outcomes[outcome] = (group.outcomes[outcome] ?? 0) + 1;
      groups.set(key, group);
    },
    summarize() {
      return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, group]) => ({
          role: group.role,
          route: group.route,
          requests: group.timings.length,
          p50Ms: percentile(group.timings, 0.5),
          p95Ms: percentile(group.timings, 0.95),
          p99Ms: percentile(group.timings, 0.99),
          outcomes: { ...group.outcomes },
        }));
    },
  };
}
