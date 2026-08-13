import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { getExactProjectStatusTransitionReceipt } =
  await import("./status-transition-receipt");

const projectId = "f9400000-0000-4000-8000-000000000001";

describe("getExactProjectStatusTransitionReceipt", () => {
  test("accepts only transitions and replay states emitted by the SQL graph", () => {
    for (const receipt of [
      {
        outcome: "transitioned",
        projectId,
        previousStatus: "upcoming",
        status: "in-progress",
      },
      {
        outcome: "transitioned",
        projectId,
        previousStatus: "upcoming",
        status: "completed",
      },
      {
        outcome: "transitioned",
        projectId,
        previousStatus: "in-progress",
        status: "completed",
      },
      {
        outcome: "replayed",
        projectId,
        previousStatus: "in-progress",
        status: "in-progress",
      },
      {
        outcome: "replayed",
        projectId,
        previousStatus: "completed",
        status: "completed",
      },
    ] as const) {
      expect(getExactProjectStatusTransitionReceipt(receipt)).toEqual(receipt);
    }
  });

  test("rejects structurally valid receipts the SQL graph cannot emit", () => {
    for (const receipt of [
      {
        outcome: "transitioned",
        projectId,
        previousStatus: "completed",
        status: "in-progress",
      },
      {
        outcome: "transitioned",
        projectId,
        previousStatus: "cancelled",
        status: "completed",
      },
      {
        outcome: "replayed",
        projectId,
        previousStatus: "upcoming",
        status: "upcoming",
      },
      {
        outcome: "replayed",
        projectId,
        previousStatus: "cancelled",
        status: "cancelled",
      },
    ] as const) {
      expect(getExactProjectStatusTransitionReceipt(receipt)).toBeNull();
    }
  });
});
