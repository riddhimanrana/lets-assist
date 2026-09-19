import { expect, test } from "bun:test";
import {
  drainCsfStorageDeletionState,
  seedDvhsCsfFixtures,
} from "./seed-platform-csf-plan.mjs";
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
        if (label.startsWith("csf-reset-storage-purge-")) {
          return { status: "purged", queueRows: 0, claimedQueueRows: 0 };
        }
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

const must = async (_label: string, operation: Promise<unknown>) => {
  const result = (await operation) as { data?: unknown; error?: unknown };
  if (result.error) throw result.error;
  return result.data;
};

test("isolated reset removes and acknowledges every preserved Storage row before final purge", async () => {
  const calls: string[] = [];
  let purgeCount = 0;
  const pluginDb = {
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push(name);
      if (name === "csf_purge_storage_deletion_queue") {
        purgeCount += 1;
        return Promise.resolve({
          data:
            purgeCount === 1
              ? {
                  status: "cleanup_required",
                  queueRows: 1,
                  claimedQueueRows: 0,
                }
              : { status: "purged", queueRows: 0, claimedQueueRows: 0 },
          error: null,
        });
      }
      if (name === "csf_claim_organization_storage_deletion_queue") {
        expect(params.p_organization_id).toBe(IDS.csfOrg);
        return Promise.resolve({
          data: [
            {
              id: "10000000-0000-4000-8000-000000000801",
              organization_id: IDS.csfOrg,
              bucket: "plugins",
              object_path: `${IDS.csfOrg}/dvhs-csf/staging/file.xlsx`,
              attempt_count: 0,
              claim_token: "10000000-0000-4000-8000-000000000802",
              claimed_at: "2026-09-19T16:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      expect(name).toBe("csf_ack_storage_deletion_claim");
      return Promise.resolve({
        data: { status: "deleted", attemptCount: 0 },
        error: null,
      });
    },
  };
  const admin = {
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.push(`remove:${bucket}:${paths.join(",")}`);
          return Promise.resolve({ data: paths, error: null });
        },
      }),
    },
  };

  await drainCsfStorageDeletionState({
    admin,
    pluginDb,
    organizationId: IDS.csfOrg,
    must,
  });

  expect(calls).toEqual([
    "csf_purge_storage_deletion_queue",
    "csf_claim_organization_storage_deletion_queue",
    `remove:plugins:${IDS.csfOrg}/dvhs-csf/staging/file.xlsx`,
    "csf_ack_storage_deletion_claim",
    "csf_purge_storage_deletion_queue",
  ]);
});

test("isolated reset fails closed when preserved cleanup cannot make progress", async () => {
  const pluginDb = {
    rpc: (name: string) =>
      Promise.resolve({
        data:
          name === "csf_purge_storage_deletion_queue"
            ? {
                status: "cleanup_required",
                queueRows: 1,
                claimedQueueRows: 1,
              }
            : [],
        error: null,
      }),
  };

  await expect(
    drainCsfStorageDeletionState({
      admin: { storage: { from: () => ({ remove: () => null }) } },
      pluginDb,
      organizationId: IDS.csfOrg,
      must,
    }),
  ).rejects.toThrow("could not make progress");
});

test("isolated reset rejects an unconfirmed cleanup acknowledgement", async () => {
  let purgeCount = 0;
  const pluginDb = {
    rpc: (name: string) => {
      if (name === "csf_purge_storage_deletion_queue") {
        purgeCount += 1;
        return Promise.resolve({
          data: {
            status: "cleanup_required",
            queueRows: 1,
            claimedQueueRows: 0,
          },
          error: null,
        });
      }
      if (name === "csf_claim_organization_storage_deletion_queue") {
        return Promise.resolve({
          data: [
            {
              id: "10000000-0000-4000-8000-000000000811",
              organization_id: IDS.csfOrg,
              bucket: "plugins",
              object_path: `${IDS.csfOrg}/dvhs-csf/staging/file.xlsx`,
              attempt_count: 0,
              claim_token: "10000000-0000-4000-8000-000000000812",
              claimed_at: "2026-09-19T16:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: { status: "unknown" }, error: null });
    },
  };

  await expect(
    drainCsfStorageDeletionState({
      admin: {
        storage: {
          from: () => ({
            remove: () => Promise.resolve({ data: [], error: null }),
          }),
        },
      },
      pluginDb,
      organizationId: IDS.csfOrg,
      must,
    }),
  ).rejects.toThrow("invalid acknowledgement");
  expect(purgeCount).toBe(1);
});
