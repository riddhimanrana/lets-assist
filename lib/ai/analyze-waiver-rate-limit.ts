import { consumeAiQuota } from "@/lib/ai/rate-limit";

export const ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const ANALYZE_WAIVER_USER_LIMIT = 10;
export const ANALYZE_WAIVER_IP_LIMIT = 30;

export function consumeAnalyzeWaiverQuota(userId: string, requestIp: string) {
  return consumeAiQuota({
    feature: "analyze-waiver",
    windowSeconds: ANALYZE_WAIVER_RATE_LIMIT_WINDOW_SECONDS,
    buckets: [
      {
        scope: "user",
        identifier: userId,
        limit: ANALYZE_WAIVER_USER_LIMIT,
      },
      {
        scope: "ip",
        identifier: requestIp,
        limit: ANALYZE_WAIVER_IP_LIMIT,
      },
    ],
  });
}
