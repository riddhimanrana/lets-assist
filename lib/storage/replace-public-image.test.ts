import { describe, expect, test } from "bun:test";
import {
  replacePublicImage,
  type ImageReferenceCommit,
} from "./replace-public-image";
import type { PublicImageReservation } from "./public-image-lifecycle";
const ownerId = "11111111-1111-4111-8111-111111111111";
const base = "https://storage.example.test/storage/v1/object/public/avatars/";
const oldKey = `${ownerId}-123.jpg`;
function fixture(commitResult: ImageReferenceCommit = "committed") {
  const calls: string[] = [];
  let reservation: PublicImageReservation | undefined;
  let uploadError = false;
  let reserveError = false;
  const storage = {
    upload: async (key: string) => {
      calls.push(`upload:${key}`);
      return { error: uploadError };
    },
    remove: async () => {
      throw new Error("Inline deletion must never run");
    },
    getPublicUrl: (key: string) => ({ data: { publicUrl: base + key } }),
  };
  return {
    calls,
    get reservation() {
      return reservation;
    },
    setUploadError: () => {
      uploadError = true;
    },
    setReserveError: () => {
      reserveError = true;
    },
    run: (image: Buffer | null = Buffer.from("synthetic-encoded-raster")) =>
      replacePublicImage({
        actorId: ownerId,
        bucket: "avatars",
        ownerId,
        previousUrl: base + oldKey,
        image,
        storage,
        reserve: async (input) => {
          calls.push("reserve");
          if (reserveError) throw new Error("Unknown reservation");
          reservation = input;
        },
        commit: async () => {
          calls.push("commit");
          return commitResult;
        },
      }),
  };
}
describe("durable public image replacement", () => {
  test("reserves candidate and predecessor before upload or publication", async () => {
    const state = fixture();
    expect(await state.run()).toMatchObject({
      success: true,
      cleanupPending: true,
    });
    expect(state.calls[0]).toBe("reserve");
    expect(state.calls[1]).toBe(`upload:${state.reservation!.candidatePath}`);
    expect(state.calls[2]).toBe("commit");
    expect(state.reservation).toMatchObject({
      actorId: ownerId,
      ownerId,
      previousPath: oldKey,
      previousUrl: base + oldKey,
    });
  });
  test("unknown reservation prevents upload and reference mutation", async () => {
    const state = fixture();
    state.setReserveError();
    expect(await state.run()).toMatchObject({
      success: false,
      cleanupPending: false,
    });
    expect(state.calls).toEqual(["reserve"]);
  });
  test("uncertain upload already has a durable candidate intent", async () => {
    const state = fixture();
    state.setUploadError();
    expect(await state.run()).toMatchObject({
      success: false,
      cleanupPending: true,
    });
    expect(state.calls).toEqual([
      "reserve",
      `upload:${state.reservation!.candidatePath}`,
    ]);
  });
  for (const status of ["refused", "unknown"] as const)
    test(`${status} publication leaves deletion to reference-checked cleanup`, async () => {
      const state = fixture(status);
      expect(await state.run()).toMatchObject({
        success: false,
        cleanupPending: true,
      });
      expect(state.calls).toHaveLength(3);
      expect(state.reservation!.previousPath).toBe(oldKey);
      expect(state.reservation!.candidatePath).toBeString();
    });
  test("explicit removal reserves the predecessor before clearing its reference", async () => {
    const state = fixture();
    expect(await state.run(null)).toMatchObject({
      success: true,
      url: null,
      cleanupPending: true,
    });
    expect(state.calls).toEqual(["reserve", "commit"]);
    expect(state.reservation!.candidatePath).toBeNull();
  });
});
