import { describe, expect, test } from "bun:test";

import {
  SIGNED_WAIVER_SIZE_MESSAGE,
  SIGNED_WAIVER_STORAGE_MESSAGE,
  SIGNED_WAIVER_TYPE_MESSAGE,
  SIGNED_WAIVER_UNREADABLE_MESSAGE,
  SIGNED_WAIVER_UPLOAD_ACCEPT,
  SIGNED_WAIVER_UPLOAD_MAX_BYTES,
  shouldSendWaiverWithSlot,
  signedWaiverUploadFailureMessage,
  signedWaiverUploadProblem,
} from "./upload-limits";

describe("signed waiver upload limits", () => {
  test("accepts the three types the server stores", () => {
    for (const type of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
    ]) {
      expect(signedWaiverUploadProblem({ type, size: 1024 })).toBeNull();
    }
  });

  test("refuses other image types, documents, and untyped files", () => {
    for (const type of [
      "image/heic",
      "image/gif",
      "image/webp",
      "text/html",
      "",
    ]) {
      expect(signedWaiverUploadProblem({ type, size: 1024 })).toBe(
        SIGNED_WAIVER_TYPE_MESSAGE,
      );
    }
  });

  test("refuses a file over the limit and states the limit", () => {
    expect(
      signedWaiverUploadProblem({
        type: "application/pdf",
        size: SIGNED_WAIVER_UPLOAD_MAX_BYTES,
      }),
    ).toBeNull();
    expect(
      signedWaiverUploadProblem({
        type: "application/pdf",
        size: SIGNED_WAIVER_UPLOAD_MAX_BYTES + 1,
      }),
    ).toBe(SIGNED_WAIVER_SIZE_MESSAGE);
    expect(SIGNED_WAIVER_SIZE_MESSAGE).toContain("10 MB");
  });

  test("the picker does not offer every image type", () => {
    expect(SIGNED_WAIVER_UPLOAD_ACCEPT).not.toContain("image/*");
    expect(SIGNED_WAIVER_UPLOAD_ACCEPT.split(",")).toEqual(
      expect.arrayContaining(["application/pdf", "image/png", "image/jpeg"]),
    );
  });

  test("each server refusal has its own sentence", () => {
    expect(signedWaiverUploadFailureMessage("type")).toBe(
      SIGNED_WAIVER_TYPE_MESSAGE,
    );
    expect(signedWaiverUploadFailureMessage("size")).toBe(
      SIGNED_WAIVER_SIZE_MESSAGE,
    );
    expect(signedWaiverUploadFailureMessage("invalid")).toBe(
      SIGNED_WAIVER_UNREADABLE_MESSAGE,
    );
    expect(signedWaiverUploadFailureMessage("storage")).toBe(
      SIGNED_WAIVER_STORAGE_MESSAGE,
    );
    expect(signedWaiverUploadFailureMessage(undefined)).toBe(
      SIGNED_WAIVER_STORAGE_MESSAGE,
    );
  });
});

describe("multi-slot guest sign-up waiver carry", () => {
  /** Replays the client loop against scripted per-slot outcomes. */
  function slotsThatCarriedTheWaiver(
    outcomes: Array<{ success: boolean; token?: string }>,
  ): boolean[] {
    let continuationToken: string | undefined;
    return outcomes.map((outcome) => {
      const sent = shouldSendWaiverWithSlot(continuationToken);
      if (outcome.success && outcome.token) continuationToken = outcome.token;
      return sent;
    });
  }

  test("the waiver is sent once when the first slot succeeds", () => {
    expect(
      slotsThatCarriedTheWaiver([
        { success: true, token: "t" },
        { success: true, token: "t" },
        { success: true, token: "t" },
      ]),
    ).toEqual([true, false, false]);
  });

  test("the waiver keeps travelling until a slot succeeds", () => {
    expect(
      slotsThatCarriedTheWaiver([
        { success: false },
        { success: false },
        { success: true, token: "t" },
        { success: true, token: "t" },
      ]),
    ).toEqual([true, true, true, false]);
  });

  test("a success with no continuation token does not strand later slots", () => {
    expect(
      slotsThatCarriedTheWaiver([{ success: true }, { success: true }]),
    ).toEqual([true, true]);
  });
});
