import {
  observedWorkers as workers,
  workerMaximumRunSeconds,
} from "./worker-keys.mjs";
const day = 86_400_000;
function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === keys.sort().join()
  );
}
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function instant(value) {
  return typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value)
    ? Date.parse(value)
    : NaN;
}
// This checks an operator's bounded evidence receipt, not provider configuration.
export function verifyWorkerMonitoringPolicy(input, scope, now = Date.now()) {
  const policy = input;
  if (
    !exact(policy, [
      "worker",
      "environment",
      "sourceSha",
      "scheduler",
      "scheduleEnabled",
      "expectedEverySeconds",
      "staleAfterSeconds",
      "maxRunSeconds",
      "verifiedAt",
      "validUntil",
      "changeRecord",
      "reviewedBy",
      "alerting",
    ]) ||
    !workers.includes(policy.worker) ||
    !["development", "production"].includes(policy.environment) ||
    !/^[a-f0-9]{40}$/u.test(policy.sourceSha ?? "") ||
    !["vercel", "github-actions"].includes(policy.scheduler) ||
    typeof policy.scheduleEnabled !== "boolean" ||
    !integer(policy.expectedEverySeconds, 30, 604800) ||
    !integer(policy.staleAfterSeconds, 60, 1209600) ||
    !integer(policy.maxRunSeconds, 1, workerMaximumRunSeconds(policy.worker)) ||
    !/^https:\/\/github\.com\/riddhimanrana\/lets-assist\/(?:issues|pull)\/[1-9][0-9]*$/u.test(
      policy.changeRecord ?? "",
    ) ||
    !/^[a-zA-Z0-9_-]{1,39}$/u.test(policy.reviewedBy ?? "") ||
    !exact(policy.alerting, [
      "owner",
      "destination",
      "missedRunTestedAt",
      "validUntil",
    ]) ||
    !/^[a-zA-Z0-9_-]{1,39}$/u.test(policy.alerting.owner ?? "") ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(policy.alerting.destination ?? "")
  )
    throw new Error("Monitoring evidence has an invalid shape.");
  if (
    policy.worker !== scope.worker ||
    policy.environment !== scope.environment ||
    policy.sourceSha !== scope.sourceSha
  )
    throw new Error(
      "Monitoring evidence does not match this worker deployment.",
    );
  const verified = instant(policy.verifiedAt);
  const expiry = instant(policy.validUntil);
  const alertTest = instant(policy.alerting.missedRunTestedAt);
  const alertExpiry = instant(policy.alerting.validUntil);
  if (
    ![now, verified, expiry, alertTest, alertExpiry].every(Number.isFinite) ||
    verified > now ||
    expiry <= now ||
    expiry <= verified ||
    expiry - verified > 7 * day ||
    policy.staleAfterSeconds < policy.expectedEverySeconds ||
    alertTest > verified ||
    now - alertTest > 30 * day ||
    alertExpiry <= now ||
    alertExpiry - alertTest > 30 * day
  )
    throw new Error(
      "Monitoring evidence or missed-run alert test is expired or inconsistent.",
    );
  return policy;
}
export function requireWorkerActivationMonitoring(
  input,
  scope,
  now = Date.now(),
) {
  const policy = verifyWorkerMonitoringPolicy(input, scope, now);
  if (!policy.scheduleEnabled)
    throw new Error(
      "Activation requires an enabled schedule and tested missed-run alert evidence.",
    );
  return policy;
}
