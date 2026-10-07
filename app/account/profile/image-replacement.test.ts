import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import sharp from "sharp";
const userId = "11111111-1111-4111-8111-111111111111";
const base = "https://storage.example.test/storage/v1/object/public/avatars/";
const oldKey = `${userId}-123.jpg`;
let savedUrl: string | null = base + oldKey;
let uploadFails = false;
let commitFails = false;
let conflict = false;
let metadataUrl: unknown;
const calls: string[] = [];
const client = {
  auth: {
    getUser: async () => ({
      data: { user: { id: userId, user_metadata: {} } },
      error: null,
    }),
    updateUser: async ({ data }: { data: { avatar_url: unknown } }) => {
      metadataUrl = data.avatar_url;
      return { error: null };
    },
  },
  from: () => {
    let patch: { avatar_url?: string | null } | undefined;
    const query = {
      upsert: async () => ({ error: null }),
      update: (value: typeof patch) => {
        patch = value;
        return query;
      },
      select: () => query,
      eq: () => query,
      is: () => query,
      single: async () => ({ data: { avatar_url: savedUrl }, error: null }),
      maybeSingle: async () => {
        calls.push("commit");
        if (commitFails)
          return { data: null, error: new Error("Synthetic database failure") };
        if (conflict) return { data: null, error: null };
        if (patch?.avatar_url !== undefined) savedUrl = patch.avatar_url;
        return { data: { id: userId }, error: null };
      },
    };
    return query;
  },
  storage: {
    from: () => ({
      upload: async (
        key: string,
        bytes: Buffer,
        options: { contentType: string },
      ) => {
        calls.push(`upload:${key}`);
        expect(options.contentType).toBe("image/webp");
        expect((await sharp(bytes).metadata()).format).toBe("webp");
        return {
          error: uploadFails ? new Error("Synthetic upload failure") : null,
        };
      },
      remove: async (keys: string[]) => {
        calls.push(`remove:${keys.join()}`);
        return { error: null };
      },
      getPublicUrl: (key: string) => ({ data: { publicUrl: base + key } }),
    }),
  },
};
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/utils/moderation-helpers", () => ({
  checkOffensiveLanguage: async () => null,
}));
const { completeOnboarding, removeProfilePicture } = await import("./actions");
const png = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "red" },
})
  .png()
  .toBuffer();
const form = () => {
  const data = new FormData();
  data.set("avatarUrl", `data:image/png;base64,${png.toString("base64")}`);
  return data;
};
beforeEach(() => {
  calls.length = 0;
  savedUrl = base + oldKey;
  uploadFails = false;
  commitFails = false;
  conflict = false;
  metadataUrl = undefined;
});
afterAll(() => mock.restore());
describe("profile image action", () => {
  test("publishes a decoded immutable image before deleting its predecessor", async () => {
    const result = await completeOnboarding(form());
    expect(result).toMatchObject({ success: true });
    expect(savedUrl).not.toBe(base + oldKey);
    expect(metadataUrl).toBe(savedUrl);
    expect(calls[0]).toStartWith("upload:");
    expect(calls[1]).toBe("commit");
    expect(calls[2]).toBe(`remove:${oldKey}`);
  });
  test("upload failure preserves the old image and metadata", async () => {
    uploadFails = true;
    const result = await completeOnboarding(form());
    expect(result.error).toBeDefined();
    expect(savedUrl).toBe(base + oldKey);
    expect(metadataUrl).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
  test("unknown database commit retains both images", async () => {
    commitFails = true;
    expect((await completeOnboarding(form())).error).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(savedUrl).toBe(base + oldKey);
  });
  test("concurrent image edit discards only this request's candidate", async () => {
    conflict = true;
    expect((await completeOnboarding(form())).error).toBeDefined();
    expect(savedUrl).toBe(base + oldKey);
    expect(calls[2]).toBe(calls[0].replace("upload:", "remove:"));
  });
  test("corrupt media never reaches storage", async () => {
    const data = new FormData();
    data.set("avatarUrl", "data:image/png;base64,YmFk");
    expect((await completeOnboarding(data)).error).toBeDefined();
    expect(calls).toHaveLength(0);
  });
  test("removal clears the reference before custom-domain object cleanup", async () => {
    expect(await removeProfilePicture()).toMatchObject({ success: true });
    expect(savedUrl).toBeNull();
    expect(metadataUrl).toBeNull();
    expect(calls).toEqual(["commit", `remove:${oldKey}`]);
  });
});
