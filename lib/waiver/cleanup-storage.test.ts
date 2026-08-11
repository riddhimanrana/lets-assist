import { describe, expect, mock, test } from "bun:test";

import {
  collectWaiverStoragePaths,
  removeWaiverStorageObjects,
} from "./cleanup-storage";

describe("collectWaiverStoragePaths", () => {
  test("includes legacy, uploaded-document, and multi-signer object paths once", () => {
    expect(
      collectWaiverStoragePaths([
        {
          signature_storage_path: "legacy/signature.png",
          upload_storage_path: "offline/signed-waiver.pdf",
          signature_payload: {
            signers: [
              { method: "draw", data: "multi/drawn.png" },
              { method: "upload", data: "multi/uploaded.jpg" },
              { method: "typed", data: "Volunteer Name" },
              { method: "draw", data: "data:image/png;base64,ignored" },
              { method: "draw", data: "multi/drawn.png" },
            ],
          },
        },
      ]),
    ).toEqual({
      signaturePaths: [
        "legacy/signature.png",
        "offline/signed-waiver.pdf",
        "multi/drawn.png",
        "multi/uploaded.jpg",
      ],
      uploadPaths: [],
    });
  });
});

describe("removeWaiverStorageObjects", () => {
  test("removes both private signature assets and uploaded waiver documents", async () => {
    const remove = mock(async () => ({ error: null }));

    const result = await removeWaiverStorageObjects(remove, {
      signaturePaths: ["signature.png"],
      uploadPaths: ["signed-waiver.pdf"],
    });

    expect(result).toEqual({});
    expect(remove).toHaveBeenNthCalledWith(1, "waiver-signatures", [
      "signature.png",
    ]);
    expect(remove).toHaveBeenNthCalledWith(2, "waiver-signatures", [
      "signed-waiver.pdf",
    ]);
  });

  test("fails closed and does not continue after a storage deletion error", async () => {
    const remove = mock(async (bucket: string) => ({
      error:
        bucket === "waiver-signatures"
          ? { message: "storage unavailable" }
          : null,
    }));

    const result = await removeWaiverStorageObjects(remove, {
      signaturePaths: ["signature.png"],
      uploadPaths: ["signed-waiver.pdf"],
    });

    expect(result).toEqual({
      error: "Failed to delete waiver signature assets",
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
