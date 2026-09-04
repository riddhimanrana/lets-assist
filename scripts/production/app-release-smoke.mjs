import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireSha } from "./app-release-checks.mjs";

export function validateStatus(payload, expectedSha) {
  requireSha(expectedSha);
  const checks = payload?.checks ?? [];
  const workers = checks.filter((check) => check.name === "workers");
  const details = workers[0]?.details;
  if (
    payload?.version !== expectedSha ||
    payload?.environment !== "production" ||
    payload?.deep !== true ||
    !Array.isArray(checks) ||
    checks.some((check) => check.critical && check.state === "fail") ||
    !checks.some(
      (check) => check.name === "database" && check.state === "pass",
    ) ||
    !checks.some(
      (check) => check.name === "environment" && check.state === "pass",
    ) ||
    !checks.some(
      (check) => check.name === "tables-deep" && check.state === "pass",
    ) ||
    workers.length !== 1 ||
    [
      "csfWorkbookRefresh",
      "csfImportCommit",
      "csfCommunications",
      "csfScheduledPostPublisher",
    ].some((flag) => details?.[flag] !== false)
  ) {
    throw new Error("App-only status or worker posture failed.");
  }
}

export async function smoke({ origin, expectedSha, bypass }, fetcher = fetch) {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.port ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    !(
      base.hostname === "lets-assist.com" ||
      /^[a-z0-9-]+\.vercel\.app$/u.test(base.hostname)
    )
  ) {
    throw new Error("Invalid app-only smoke origin.");
  }
  const request = async (path) => {
    try {
      return await fetcher(new URL(path, base), {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Cache-Control": "no-cache",
          ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
        },
      });
    } catch {
      throw new Error("App-only smoke transport failed.");
    }
  };
  const status = await request("/api/status?deep=1");
  if (status.status !== 200)
    throw new Error("Application status endpoint failed.");
  validateStatus(await status.json(), expectedSha);
  const login = await request("/login");
  if (login.status !== 200) throw new Error("Application login route failed.");
  await login.body?.cancel();
  const protectedRoute = await request(
    "/organization/dvhighcsf/plugins/dvhs-csf/dashboard",
  );
  const location = protectedRoute.headers.get("location");
  const target = location ? new URL(location, base) : null;
  if (
    ![302, 303, 307, 308].includes(protectedRoute.status) ||
    target?.origin !== base.origin ||
    target?.pathname !== "/login"
  ) {
    throw new Error("The CSF route did not require authentication.");
  }
  await protectedRoute.body?.cancel();
  return {
    status: "verified",
    login: "available",
    protectedRoute: "requires_authentication",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await smoke({
          origin: process.env.DEPLOYMENT_ORIGIN,
          expectedSha: process.env.RELEASE_SHA,
          bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        }),
      ),
    );
  } catch {
    console.error("App-only smoke failed. Response contents were suppressed.");
    process.exitCode = 1;
  }
}
