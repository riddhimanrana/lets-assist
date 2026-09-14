import { expect, test } from "bun:test";
import { seedDvhsCsfFixtures } from "./seed-platform-csf-plan.mjs";
import { IDS } from "./seed-platform-fixtures.mjs";

test("the fictional member used for email delivery has a reviewed account connection", async () => {
  const stop = new Error("member fixture captured");
  let account: Record<string, unknown> | undefined;
  const chain = {
    eq: () => chain,
    delete: () => chain,
    update: () => chain,
    upsert: (value: Record<string, unknown>) => {
      if (value.profile_id === IDS.csfProfileMember && value.user_id) {
        account = value;
      }
      return chain;
    },
  };
  const database = { from: () => chain, rpc: () => chain };
  const users = {
    csfMember: { id: "10000000-0000-4000-8000-000000000901" },
    csfOfficer: { id: "10000000-0000-4000-8000-000000000902" },
    developer: { id: "10000000-0000-4000-8000-000000000903" },
  };

  await expect(
    seedDvhsCsfFixtures({
      admin: { schema: () => database },
      users,
      must: async (label: string) => {
        if (label === "csf-profile-account") throw stop;
      },
    }),
  ).rejects.toBe(stop);

  expect(account).toMatchObject({
    organization_id: IDS.csfOrg,
    profile_id: IDS.csfProfileMember,
    user_id: users.csfMember.id,
    status: "verified",
    is_primary: true,
    linked_by: users.developer.id,
    connection_basis: "officer_decision",
  });
});
