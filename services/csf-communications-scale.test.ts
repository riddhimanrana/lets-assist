import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import type { SendEmailResult } from "./email";

const worker = await import("./csf-communications-worker");

const ORGANIZATION_ID = "cf100000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "cf400000-0000-4000-8000-000000000001";
const TOTAL_ATTEMPTS = 1_000;

function coordinate(index: number) {
  const suffix = String(index + 1).padStart(12, "0");
  const attemptId = `cf900000-0000-4000-8000-${suffix}`;
  const deliveryId = `cfa00000-0000-4000-8000-${suffix}`;
  const recipientSnapshotId = `cf800000-0000-4000-8000-${suffix}`;
  const idempotencyKey = `csf-att-${String(index + 1).padStart(64, "0")}-1`;
  return {
    attemptId,
    deliveryId,
    recipientSnapshotId,
    idempotencyKey,
  };
}

describe("1,000-message fake provider load", () => {
  test("settles every attempt within the target with no duplicate send", async () => {
    const pending = Array.from({ length: TOTAL_ATTEMPTS }, (_, index) => {
      const item = coordinate(index);
      return {
        attemptId: item.attemptId,
        campaignId: CAMPAIGN_ID,
        deliveryId: item.deliveryId,
        recipientSnapshotId: item.recipientSnapshotId,
        attemptNumber: 1,
        providerIdempotencyKey: item.idempotencyKey,
        requestPayloadHash: "e".repeat(64),
        leaseExpiresAt: "2032-04-01T10:02:00.000Z",
      };
    });
    const byAttempt = new Map(
      pending.map((claim, index) => [claim.attemptId, { claim, index }]),
    );
    const settlements = new Map<string, string>();
    const sentKeys = new Set<string>();
    let cursor = 0;
    let active = 0;
    let maximumActive = 0;
    let virtualNow = 0;
    const waitForProviderStart = worker.createCsfProviderStartLimiter({
      startsPerSecond: 8,
      now: () => virtualNow,
      wait: async (milliseconds) => {
        virtualNow += milliseconds;
      },
    });

    const plugin = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "csf_claim_communication_dispatch_batch") {
          const batchSize = Number(args.p_batch_size);
          const claims = pending.slice(cursor, cursor + batchSize);
          cursor += claims.length;
          return {
            data: { claimedCount: claims.length, claims },
            error: null,
          };
        }
        if (fn === "csf_authorize_communication_dispatch") {
          const item = byAttempt.get(String(args.p_attempt_id));
          if (!item) return { data: null, error: { message: "not found" } };
          const { claim, index } = item;
          return {
            data: {
              authorized: true,
              coordinate: {
                organizationId: ORGANIZATION_ID,
                campaignId: CAMPAIGN_ID,
                recipientSnapshotId: claim.recipientSnapshotId,
                attemptId: claim.attemptId,
                attemptNumber: 1,
                contentHash: "c".repeat(64),
                recipientSnapshotHash: "d".repeat(64),
                deliveryRequirement: "transactional",
                topicKey: null,
              },
              providerPayload: {
                from: "CSF Scale <scale@local.test>",
                to: `member-${index + 1}@local.test`,
                subject: "Synthetic scale message",
                text: "Synthetic message body.",
                type: "transactional",
                idempotencyKey: claim.providerIdempotencyKey,
              },
              requestPayloadHash: claim.requestPayloadHash,
              providerIdempotencyKey: claim.providerIdempotencyKey,
            },
            error: null,
          };
        }
        if (fn === "csf_settle_communication_dispatch_attempt") {
          const attemptId = String(args.p_attempt_id);
          if (settlements.has(attemptId)) {
            return { data: null, error: { message: "duplicate settlement" } };
          }
          settlements.set(attemptId, String(args.p_outcome));
          return {
            data: { attemptState: String(args.p_outcome) },
            error: null,
          };
        }
        return { data: null, error: { message: "unsupported rpc" } };
      },
    };

    const fakeProvider = async (
      payload: Parameters<
        NonNullable<
          Parameters<typeof worker.runCsfDispatchWorker>[1]["sendProviderRequest"]
        >
      >[0],
    ): Promise<SendEmailResult> => {
      const key = payload.idempotencyKey ?? "";
      if (sentKeys.has(key)) throw new Error("duplicate provider send");
      sentKeys.add(key);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const numericId = Number.parseInt(key.slice(-66, -2), 10);
      if (numericId % 20 === 0) {
        return {
          outcome: "retryable_pre_send",
          success: false,
          skipped: false,
          phase: "provider_response",
          code: "rate_limit_exceeded",
          status: 429,
          retryAfterSeconds: 60,
          error: "provider refused the request before acceptance",
        };
      }
      return {
        outcome: "accepted",
        success: true,
        skipped: false,
        phase: "provider_response",
        messageId: `fake-${numericId}`,
        transport: "resend",
        data: { id: `fake-${numericId}` },
      };
    };

    const startedAt = performance.now();
    while (cursor < pending.length) {
      await worker.runCsfDispatchWorker(plugin, {
        organizationId: ORGANIZATION_ID,
        workerId: "scale-worker",
        batchSize: 125,
        concurrency: 5,
        waitForProviderStart,
        sendProviderRequest: fakeProvider,
      });
    }
    const wallMilliseconds = performance.now() - startedAt;

    expect(sentKeys.size).toBe(TOTAL_ATTEMPTS);
    expect(settlements.size).toBe(TOTAL_ATTEMPTS);
    expect(
      Array.from(settlements.values()).filter(
        (outcome) => outcome === "accepted",
      ),
    ).toHaveLength(950);
    expect(
      Array.from(settlements.values()).filter(
        (outcome) => outcome === "retryable_failure",
      ),
    ).toHaveLength(50);
    expect(maximumActive).toBeLessThanOrEqual(5);
    expect(virtualNow).toBeLessThanOrEqual(10 * 60 * 1_000);
    expect(wallMilliseconds).toBeLessThan(10 * 60 * 1_000);
  });
});
