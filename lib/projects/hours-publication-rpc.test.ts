import assert from "node:assert/strict";
import test from "node:test";
import { executeReplaySafeHoursPublicationRpc } from "./hours-publication-rpc";

type Receipt = { outcome: "accepted" | "replayed"; receiptId: string };

function isReceipt(value: unknown): value is Receipt {
  return (
    !!value &&
    typeof value === "object" &&
    "receiptId" in value &&
    typeof value.receiptId === "string" &&
    "outcome" in value &&
    (value.outcome === "accepted" || value.outcome === "replayed")
  );
}

test("a lost committed RPC response recovers through the same durable receipt", async () => {
  let calls = 0;
  const result = await executeReplaySafeHoursPublicationRpc(async () => {
    calls++;
    if (calls === 1) {
      throw Object.assign(new Error("synthetic lost response"), {
        code: "PGRST000",
      });
    }
    return {
      data: { outcome: "replayed", receiptId: "receipt-1" },
      error: null,
    };
  }, isReceipt);

  assert.deepEqual(result, {
    publication: { outcome: "replayed", receiptId: "receipt-1" },
    attempts: 2,
    errorCode: null,
    invalidResponse: false,
  });
  assert.equal(calls, 2);
});

test("a valid first receipt never repeats the transaction call", async () => {
  let calls = 0;
  const result = await executeReplaySafeHoursPublicationRpc(async () => {
    calls++;
    return {
      data: { outcome: "accepted", receiptId: "receipt-2" },
      error: null,
    };
  }, isReceipt);

  assert.equal(result.publication?.outcome, "accepted");
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test("a malformed success response gets one bounded receipt recovery attempt", async () => {
  let calls = 0;
  const result = await executeReplaySafeHoursPublicationRpc(async () => {
    calls++;
    return { data: { outcome: "accepted" }, error: null };
  }, isReceipt);

  assert.deepEqual(result, {
    publication: null,
    attempts: 2,
    errorCode: null,
    invalidResponse: true,
  });
  assert.equal(calls, 2);
});

test("a database rejection stays bounded and retains its safe error code", async () => {
  let calls = 0;
  const result = await executeReplaySafeHoursPublicationRpc(async () => {
    calls++;
    return { data: null, error: { code: "42501" } };
  }, isReceipt);

  assert.deepEqual(result, {
    publication: null,
    attempts: 2,
    errorCode: "42501",
    invalidResponse: false,
  });
  assert.equal(calls, 2);
});
