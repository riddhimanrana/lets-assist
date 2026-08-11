import assert from "node:assert/strict";
import test from "node:test";
import {
  hoursEmailSettlement,
  hoursPublicationOutcome,
} from "./hours-publication-delivery";

test("database acceptance remains accepted when all delivery work settles", () => {
  assert.equal(hoursPublicationOutcome("accepted", false), "accepted");
});

test("unresolved delivery work outranks a database replay", () => {
  assert.equal(hoursPublicationOutcome("replayed", true), "partial");
});

test("accepted provider work settles with its bounded provider identity", () => {
  assert.deepEqual(
    hoursEmailSettlement({
      outcome: "accepted",
      success: true,
      skipped: false,
      phase: "provider_response",
      messageId: "synthetic-message-id",
      transport: "resend",
      data: { id: "synthetic-message-id" },
    }),
    {
      state: "accepted",
      providerMessageId: "synthetic-message-id",
      safeCode: null,
      accepted: true,
      partial: false,
    },
  );
});

test("pre-send refusal is the only provider failure kept retryable", () => {
  const settlement = hoursEmailSettlement({
    outcome: "retryable_pre_send",
    success: false,
    skipped: false,
    phase: "transport_setup",
    code: "resend_client_setup_failed",
    status: null,
    error: "provider client setup failed",
  });

  assert.equal(settlement.state, "retryable_failure");
  assert.equal(settlement.partial, true);
});

test("definitive rejection is durable but never retried automatically", () => {
  const settlement = hoursEmailSettlement({
    outcome: "definitive_failure",
    success: false,
    skipped: false,
    phase: "provider_response",
    code: "validation_error",
    status: 422,
    error: "provider rejected the request",
  });

  assert.equal(settlement.state, "definitive_failure");
  assert.equal(settlement.safeCode, "validation_error");
});

test("unknown provider outcome stays unknown and unretryable", () => {
  const settlement = hoursEmailSettlement({
    outcome: "unknown_outcome",
    success: false,
    skipped: false,
    phase: "provider_request",
    code: "provider_request_failed",
    status: null,
    error: "provider outcome is unknown",
  });

  assert.equal(settlement.state, "unknown_outcome");
  assert.equal(settlement.partial, true);
});

test("intentional skips are surfaced as partial publication delivery", () => {
  const settlement = hoursEmailSettlement({
    outcome: "skipped",
    success: false,
    skipped: true,
    phase: "transport_setup",
    code: "transport_not_configured",
    reason: "Email service not configured",
  });

  assert.equal(settlement.state, "skipped");
  assert.equal(settlement.accepted, false);
  assert.equal(settlement.partial, true);
});
