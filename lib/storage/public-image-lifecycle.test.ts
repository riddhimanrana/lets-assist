import { afterAll, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let failed = false;
const calls: Array<{ name: string; parameters: unknown }> = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: (options: { timeoutMs: number }) => {
    expect(options.timeoutMs).toBe(5000);
    return {
      rpc: async (name: string, parameters: unknown) => {
        calls.push({ name, parameters });
        return {
          error: failed ? { message: "private provider payload" } : null,
        };
      },
    };
  },
}));
const { reservePublicImageCleanup } = await import("./public-image-lifecycle");
afterAll(() => mock.restore());
const actor = "11111111-1111-4111-8111-111111111111";
const input = {
  actorId: actor,
  ownerId: actor,
  bucket: "avatars" as const,
  previousUrl: null,
  previousPath: null,
  candidatePath: `${actor}-22222222-2222-4222-8222-222222222222.webp`,
};
test("reservation sends the exact scope and expected reference to one bounded service RPC", async () => {
  await reservePublicImageCleanup(input);
  expect(calls).toEqual([
    {
      name: "reserve_public_image_cleanup",
      parameters: {
        p_actor: actor,
        p_owner: actor,
        p_bucket: "avatars",
        p_previous_url: null,
        p_previous_path: null,
        p_candidate_path: input.candidatePath,
      },
    },
  ]);
});
test("an uncertain durable reservation surfaces only a fixed failure", async () => {
  failed = true;
  await expect(reservePublicImageCleanup(input)).rejects.toThrow(
    "Image cleanup could not be reserved",
  );
});
