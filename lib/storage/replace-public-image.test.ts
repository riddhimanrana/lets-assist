import { describe, expect, test } from "bun:test";
import {
  replacePublicImage,
  type ImageReferenceCommit,
} from "./replace-public-image";
const ownerId = "11111111-1111-4111-8111-111111111111";
const base = "https://storage.example.test/storage/v1/object/public/avatars/";
const oldKey = `${ownerId}-123.jpg`;
function fixture(commitResult: ImageReferenceCommit = "committed") {
  const calls: string[] = [];
  let uploadError = false;
  let removeError = false;
  const storage = {
    upload: async (key: string) => {
      calls.push(`upload:${key}`);
      return { error: uploadError };
    },
    remove: async (keys: string[]) => {
      calls.push(`remove:${keys.join()}`);
      return { error: removeError };
    },
    getPublicUrl: (key: string) => ({ data: { publicUrl: base + key } }),
  };
  return {
    calls,
    setUploadError: () => {
      uploadError = true;
    },
    setRemoveError: () => {
      removeError = true;
    },
    run: (image: Buffer | null = Buffer.from("synthetic-encoded-raster")) =>
      replacePublicImage({
        bucket: "avatars",
        ownerId,
        previousUrl: base + oldKey,
        image,
        storage,
        commit: async () => {
          calls.push("commit");
          return commitResult;
        },
      }),
  };
}
describe("public image replacement ordering", () => {
  test("upload, confirmed reference, then old object deletion", async () => {
    const state = fixture();
    const result = await state.run();
    expect(result.success).toBe(true);
    expect(result.cleanupPending).toBe(false);
    expect(state.calls[0]).toStartWith("upload:");
    expect(state.calls[1]).toBe("commit");
    expect(state.calls[2]).toBe(`remove:${oldKey}`);
  });
  test("upload failure preserves the reference and old object", async () => {
    const state = fixture();
    state.setUploadError();
    const result = await state.run();
    expect(result.success).toBe(false);
    expect(state.calls).toHaveLength(1);
  });
  test("refused compare-and-swap removes only the new candidate", async () => {
    const state = fixture("refused");
    const result = await state.run();
    expect(result.success).toBe(false);
    expect(result.cleanupPending).toBe(false);
    expect(state.calls[2]).toBe(state.calls[0].replace("upload:", "remove:"));
    expect(state.calls).not.toContain(`remove:${oldKey}`);
  });
  test("unknown database outcome retains both objects for reconciliation", async () => {
    const state = fixture("unknown");
    const result = await state.run();
    expect(result.success).toBe(false);
    expect(result.cleanupPending).toBe(true);
    expect(state.calls).toHaveLength(2);
  });
  test("failed predecessor cleanup does not misreport the accepted update", async () => {
    const state = fixture();
    state.setRemoveError();
    const result = await state.run();
    expect(result.success).toBe(true);
    expect(result.cleanupPending).toBe(true);
  });
  test("explicit removal clears the reference before deleting storage", async () => {
    const state = fixture();
    const result = await state.run(null);
    expect(result.success).toBe(true);
    expect(state.calls).toEqual(["commit", `remove:${oldKey}`]);
  });
});
