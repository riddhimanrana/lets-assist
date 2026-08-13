import { consumeAiQuota } from "@/lib/ai/rate-limit";
import {
  PARSE_PROJECT_IP_LIMIT,
  PARSE_PROJECT_RATE_LIMIT_WINDOW_SECONDS,
  PARSE_PROJECT_USER_LIMIT,
} from "@/lib/ai/parse-project-rate-limit-config";

export type ParseProjectQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
};

export async function consumeParseProjectQuota(
  userId: string,
  requestIp: string | null,
): Promise<ParseProjectQuotaResult> {
  return consumeAiQuota({
    feature: "parse-project",
    windowSeconds: PARSE_PROJECT_RATE_LIMIT_WINDOW_SECONDS,
    buckets: [
      { scope: "user", identifier: userId, limit: PARSE_PROJECT_USER_LIMIT },
      ...(requestIp
        ? [
            {
              scope: "ip",
              identifier: requestIp,
              limit: PARSE_PROJECT_IP_LIMIT,
            },
          ]
        : []),
    ],
  });
}
