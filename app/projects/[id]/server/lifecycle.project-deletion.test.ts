import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  CREATOR_ID,
  ORGANIZATION_ID,
  OTHER_USER_ID,
  db,
  insertProject,
  keyOf,
  modelClient,
  nextUuid,
  pendingOperation,
  removeStoredObject,
  resetModel,
  seedProject,
  seedProjectWithFiles,
  upload,
  urlOf,
  writeProjectAssets,
} from "./lifecycle.project-deletion.test-support";
import { linkedObject } from "./lifecycle.project-asset-link.test-support";

/**
 * deleteProject and cloneProject against the in-memory model in the support
 * file. These tests show that the action honors the database rules and reports
 * their outcomes truthfully. They model the SQL fence; they are not proof of
 * the SQL, its locks, or real concurrent transactions.
 */

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/security/html.server", () => ({
  sanitizeRichTextHtml: (value: string) => value,
}));
mock.module("@/lib/plugins/registry", () => ({
  getPluginRegistry: () => ({ get: () => undefined }),
}));
mock.module("@/lib/plugins/lifecycle", () => ({
  runProjectCreate: async () => undefined,
  runProjectClone: async () => undefined,
}));
mock.module("@/lib/plugins/resolve-org-plugins", () => ({
  resolveOrganizationPlugins: async () => [],
}));
mock.module("@/utils/calendar-helpers", () => ({
  removeCalendarEventForProject: async (projectId: string) => {
    db.calendarCalls.push(projectId);
    return { success: !db.calendarFails };
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => modelClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => modelClient(),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: db.viewer, error: null }),
}));

const { cloneProject, deleteProject } = await import("./lifecycle");

const STORAGE_OUTAGE = { code: "503", message: "synthetic storage outage" };
const FILES_REMAIN =
  "Some project files could not be removed. Try deleting the project again.";
const CLONE_REFUSED =
  "A file on this project is being removed, so it cannot be copied right now.";

async function cloneOf(projectId: string) {
  const result = await cloneProject(projectId);
  if (!("newProjectId" in result) || !result.newProjectId) {
    throw new Error(`Clone failed: ${JSON.stringify(result)}`);
  }
  return result.newProjectId as string;
}

/** Runs an action whose expected failure is logged, without the log noise. */
function silenced<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

function rpcNames() {
  return db.rpcCalls.map((call) => call.name);
}

beforeEach(resetModel);

describe("files shared with a clone outlive either project", () => {
  test("deleting the source keeps the files its clone links and removes the rest", async () => {
    const source = seedProjectWithFiles();
    const unlinked = `project_${source.id}_draft_2.pdf`;
    upload("project-documents", unlinked, CREATOR_ID);
    const cloneId = await cloneOf(source.id);

    expect(db.projects.get(cloneId)).toMatchObject({
      cover_image_url: urlOf("project-images", source.cover),
    });
    expect(await deleteProject(source.id)).toEqual({ success: true });

    expect(db.projects.has(source.id)).toBe(false);
    expect(db.projects.has(cloneId)).toBe(true);
    expect(db.stored.has(source.coverKey)).toBe(true);
    expect(db.stored.has(source.guideKey)).toBe(true);
    expect(db.stored.has(keyOf("project-documents", unlinked))).toBe(false);
    expect(db.removalCalls).toEqual([
      { bucket: "project-documents", paths: [unlinked] },
    ]);
  });

  test("deleting a clone removes none of the source's files", async () => {
    const source = seedProjectWithFiles();
    const cloneId = await cloneOf(source.id);

    expect(await deleteProject(cloneId)).toEqual({ success: true });

    expect(db.projects.has(cloneId)).toBe(false);
    expect(db.projects.has(source.id)).toBe(true);
    expect(db.stored.has(source.coverKey)).toBe(true);
    expect(db.stored.has(source.guideKey)).toBe(true);
    expect(db.removalCalls).toEqual([]);
  });

  test("the last clone releases files whose owner was deleted through this path", async () => {
    const source = seedProjectWithFiles();
    const firstClone = await cloneOf(source.id);
    const secondClone = await cloneOf(source.id);
    expect(await deleteProject(source.id)).toEqual({ success: true });

    expect(await deleteProject(firstClone)).toEqual({ success: true });
    expect(db.stored.has(source.coverKey)).toBe(true);
    expect(db.stored.has(source.guideKey)).toBe(true);

    expect(await deleteProject(secondClone)).toEqual({ success: true });
    expect(db.stored.has(source.coverKey)).toBe(false);
    expect(db.stored.has(source.guideKey)).toBe(false);
    expect(db.registry.get(source.coverKey)?.state).toBe("deleted");
    expect(db.projects.size).toBe(0);
  });

  test("percent-encoded links protect the clone's cover and document until the last clone goes", async () => {
    const source = seedProjectWithFiles();
    // The same objects, stored with one layer of percent-encoding.
    const encoded = (name: string) =>
      name.replace("project_", "%70roject%5F").replace(".", "%2e");
    expect(
      writeProjectAssets(source.id, {
        cover_image_url: urlOf("project-images", encoded(source.cover)),
        documents: [
          {
            name: "guide.pdf",
            url: `${urlOf("project-documents", encoded(source.guide))}?download=1`,
          },
        ],
      }),
    ).toBeNull();
    const firstClone = await cloneOf(source.id);
    const secondClone = await cloneOf(source.id);

    expect(await deleteProject(source.id)).toEqual({ success: true });
    expect(db.removalCalls).toEqual([]);
    expect(db.stored.has(source.coverKey)).toBe(true);
    expect(db.stored.has(source.guideKey)).toBe(true);

    expect(await deleteProject(firstClone)).toEqual({ success: true });
    expect(db.removalCalls).toEqual([]);
    expect(db.stored.has(source.coverKey)).toBe(true);
    expect(db.stored.has(source.guideKey)).toBe(true);

    // Only the last project that links them releases them, by their real names.
    expect(await deleteProject(secondClone)).toEqual({ success: true });
    expect(db.removalCalls).toEqual([
      { bucket: "project-images", paths: [source.cover] },
      { bucket: "project-documents", paths: [source.guide] },
    ]);
    expect(db.stored.size).toBe(0);
  });

  test("an encoded link is still never authority: a forged one removes nothing", async () => {
    const victim = seedProjectWithFiles();
    const attacker = seedProject({
      cover_image_url: urlOf(
        "project-images",
        victim.cover.replace("project_", "%70roject%5F"),
      ),
    });

    expect(await deleteProject(attacker)).toEqual({ success: true });

    expect(db.stored.has(victim.coverKey)).toBe(true);
    expect(db.registry.get(victim.coverKey)?.state).toBe("active");
    expect(db.removalCalls).toEqual([]);
  });

  test("the modeled link parser decodes one layer and refuses everything else", () => {
    const id = "aaaaaaaa-0000-4000-8000-00000000000a";
    const name = `project_${id}_cover_1.png`;
    const base =
      "https://synthetic-platform.example.test/storage/v1/object/public";
    const linked = { bucket: "project-images", name };

    for (const path of [
      `project-images/${name}`,
      `project-images/%70roject%5F${id}%5fcover_1%2Epng`,
      `project%2Dimages/${name}?v=a%2Fb#frag/ment`,
    ]) {
      expect(linkedObject(`${base}/${path}`)).toEqual(linked);
    }

    for (const path of [
      `project-images/${name}%7`,
      `project-images/project_${id}_cover_1%zzpng`,
      `project-images/project_${id}_cover%2F1.png`,
      `project-images/project_${id}_cover%5C1.png`,
      `project-images/project_${id}_cover%3F1.png`,
      `project-images/project_${id}_cover%231.png`,
      `project-images/project_${id}_cover%001.png`,
      `project-images/project_${id}_cover%C3%A9.png`,
      `project-images%2F${name}`,
      `project-images/..%2Fproject-images%2F${name}`,
      `project-images/%2570roject_${id}_cover_1.png`,
      `project-images/project%255F${id}_cover_1.png`,
      `project-images/project_${id}_cover 1.png`,
      `project-images/%50roject_${id}_cover_1.png`,
      `project-images/Project_${id}_cover_1.png`,
      `Project-Images/${name}`,
      `avatars/${name}`,
      `project-images/project_${id}_`,
      `project-images/${name}/extra`,
    ]) {
      expect(linkedObject(`${base}/${path}`)).toBeNull();
    }
  });

  test("uploads recorded for a project are removed even when nothing links them", async () => {
    const id = seedProject();
    const orphan = `project_${id}_never_linked.pdf`;
    upload("project-documents", orphan, CREATOR_ID);

    expect(await deleteProject(id)).toEqual({ success: true });

    expect(db.stored.has(keyOf("project-documents", orphan))).toBe(false);
    expect(db.removalCalls).toEqual([
      { bucket: "project-documents", paths: [orphan] },
    ]);
  });
});

describe("a URL or a file name is never authority to remove a file", () => {
  test("a forged link to another live project's file removes nothing", async () => {
    const victim = seedProjectWithFiles();
    const attacker = seedProject({
      cover_image_url: urlOf("project-images", victim.cover),
      documents: [
        { name: "copy", url: urlOf("project-documents", victim.guide) },
      ],
    });

    expect(await deleteProject(attacker)).toEqual({ success: true });

    expect(db.stored.has(victim.coverKey)).toBe(true);
    expect(db.stored.has(victim.guideKey)).toBe(true);
    expect(db.registry.get(victim.coverKey)?.state).toBe("active");
    expect(db.removalCalls).toEqual([]);
  });

  test("another host or path that shares a file's name removes nothing", async () => {
    const victim = seedProjectWithFiles();
    const lookalike = seedProject({
      cover_image_url: `https://unrelated.example.test/files/${victim.cover}`,
      documents: [
        {
          name: "same-name",
          url: `https://unrelated.example.test/storage/v1/object/public/project-documents/${victim.guide}?download=1`,
        },
        { name: "relative", url: `/project-documents/${victim.guide}` },
      ],
    });

    expect(await deleteProject(lookalike)).toEqual({ success: true });

    expect(db.stored.has(victim.coverKey)).toBe(true);
    expect(db.stored.has(victim.guideKey)).toBe(true);
    expect(db.removalCalls).toEqual([]);
  });

  test("a link to a file whose owner vanished without a deletion receipt removes nothing", async () => {
    const owner = seedProjectWithFiles();
    const linker = seedProject({
      cover_image_url: urlOf("project-images", owner.cover),
      documents: [
        {
          name: "foreign-host",
          url: `https://unrelated.example.test/storage/v1/object/public/project-documents/${owner.guide}`,
        },
      ],
    });
    // The owning row disappears outside the reviewed path: no operation exists.
    db.projects.delete(owner.id);

    expect(await deleteProject(linker)).toEqual({ success: true });

    expect(db.stored.has(owner.coverKey)).toBe(true);
    expect(db.stored.has(owner.guideKey)).toBe(true);
    expect(db.registry.get(owner.coverKey)?.state).toBe("active");
    expect(db.removalCalls).toEqual([]);
  });

  test("a file whose ownership was never proven is retained", async () => {
    const id = seedProject();
    const serviceUpload = `project_${id}_service_upload.pdf`;
    const strangerUpload = `project_${id}_stranger.pdf`;
    upload("project-documents", serviceUpload, null);
    upload("project-documents", strangerUpload, OTHER_USER_ID);
    writeProjectAssets(id, {
      documents: [
        { name: "a", url: urlOf("project-documents", serviceUpload) },
        { name: "b", url: urlOf("project-documents", strangerUpload) },
      ],
    });

    expect(await deleteProject(id)).toEqual({ success: true });

    expect(db.registry.size).toBe(0);
    expect(db.stored.has(keyOf("project-documents", serviceUpload))).toBe(true);
    expect(db.stored.has(keyOf("project-documents", strangerUpload))).toBe(
      true,
    );
    expect(db.removalCalls).toEqual([]);
  });
});

describe("success needs an exact receipt from both database steps", () => {
  const OPERATION = "cccccccc-0000-4000-8000-000000000001";
  const ELSEWHERE = "cccccccc-0000-4000-8000-000000000002";
  const OBJECT = "cccccccc-0000-4000-8000-000000000003";
  /** The operation the model creates for a project seeded with two files. */
  const FIRST_OPERATION = "00000000-0000-4000-8000-000000000004";

  const badPreparations: Array<{
    name: string;
    data: (id: string) => unknown;
  }> = [
    { name: "no data", data: () => null },
    { name: "an unknown outcome", data: () => ({ outcome: "ok" }) },
    {
      name: "a receipt for another project",
      data: () => ({
        outcome: "prepared",
        operationId: OPERATION,
        projectId: ELSEWHERE,
        phase: "pending",
        objects: [],
      }),
    },
    {
      name: "a receipt with no operation",
      data: (id) => ({
        outcome: "prepared",
        projectId: id,
        phase: "pending",
        objects: [],
      }),
    },
    {
      name: "an open receipt marked completed",
      data: (id) => ({
        outcome: "prepared",
        operationId: OPERATION,
        projectId: id,
        phase: "completed",
        objects: [],
      }),
    },
    {
      name: "a completed receipt for another project",
      data: () => ({
        outcome: "completed",
        operationId: OPERATION,
        projectId: ELSEWHERE,
        phase: "completed",
      }),
    },
    {
      name: "an object that is not a canonical project file",
      data: (id) => ({
        outcome: "prepared",
        operationId: OPERATION,
        projectId: id,
        phase: "pending",
        objects: [
          {
            bucket: "project-documents",
            name: "../avatars/someone.png",
            objectId: OBJECT,
            present: true,
          },
        ],
      }),
    },
    {
      name: "an object in another bucket",
      data: (id) => ({
        outcome: "prepared",
        operationId: OPERATION,
        projectId: id,
        phase: "pending",
        objects: [
          {
            bucket: "waiver-uploads",
            name: `project_${id}_x.pdf`,
            objectId: OBJECT,
            present: true,
          },
        ],
      }),
    },
  ];

  for (const { name, data } of badPreparations) {
    test(`a prepare step that returns ${name} removes nothing`, async () => {
      const project = seedProjectWithFiles();
      db.prepareOverride = { data: data(project.id), error: null };

      expect(await deleteProject(project.id)).toEqual({
        error: "Failed to delete project",
      });
      expect(db.removalCalls).toEqual([]);
      expect(db.projects.has(project.id)).toBe(true);
      expect(rpcNames()).toEqual(["prepare_project_deletion"]);
    });
  }

  test("a prepare step that errors removes nothing", async () => {
    const project = seedProjectWithFiles();
    db.prepareOverride = {
      data: null,
      error: { code: "08006", message: "synthetic outage" },
    };

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to delete project",
    });
    expect(db.removalCalls).toEqual([]);
    expect(db.stored.size).toBe(2);
  });

  const badFinalizations: Array<{
    name: string;
    data: (id: string) => unknown;
  }> = [
    { name: "no data", data: () => null },
    {
      name: "a receipt for another operation",
      data: (id) => ({
        outcome: "completed",
        operationId: OPERATION,
        projectId: id,
        phase: "completed",
      }),
    },
    {
      name: "a receipt for another project",
      data: () => ({
        outcome: "completed",
        operationId: FIRST_OPERATION,
        projectId: ELSEWHERE,
        phase: "completed",
      }),
    },
    {
      name: "a receipt that is still pending",
      data: (id) => ({
        outcome: "completed",
        operationId: FIRST_OPERATION,
        projectId: id,
        phase: "pending",
      }),
    },
  ];

  for (const { name, data } of badFinalizations) {
    test(`a finalize step that returns ${name} is not reported as success`, async () => {
      const project = seedProjectWithFiles();
      db.finalizeOverride = { data: data(project.id), error: null };

      expect(await deleteProject(project.id)).toEqual({
        error: "Failed to delete project",
      });
      expect(db.projects.has(project.id)).toBe(true);
      expect(pendingOperation(project.id)?.id).toBe(FIRST_OPERATION);
    });
  }

  test("an exact completed receipt is success", async () => {
    const project = seedProjectWithFiles();

    expect(await deleteProject(project.id)).toEqual({ success: true });

    expect(db.rpcCalls).toEqual([
      {
        name: "prepare_project_deletion",
        args: {
          p_project_id: project.id,
          p_actor_id: CREATOR_ID,
          p_replay_only: false,
        },
      },
      {
        name: "finalize_project_deletion",
        args: {
          p_operation_id: FIRST_OPERATION,
          p_project_id: project.id,
          p_actor_id: CREATOR_ID,
        },
      },
    ]);
    expect(db.operations.get(project.id)?.phase).toBe("completed");
    expect(db.stored.size).toBe(0);
  });
});

describe("a lost final response is confirmed from the durable receipt", () => {
  /** Deletes the project in the database but loses the response. */
  async function deleteWithLostResponse() {
    const project = seedProjectWithFiles({
      creator_calendar_event_id: "calendar-event-1",
    });
    db.finalizeLosesResponse = true;
    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to delete project",
    });
    expect(db.projects.has(project.id)).toBe(false);
    expect(db.operations.get(project.id)?.phase).toBe("completed");
    db.rpcCalls = [];
    db.removalCalls = [];
    db.calendarCalls = [];
    return project;
  }

  test("the same actor's retry succeeds without touching Storage or the calendar", async () => {
    const project = await deleteWithLostResponse();

    expect(await deleteProject(project.id)).toEqual({ success: true });

    // The only call is the read-only replay.
    expect(db.rpcCalls).toEqual([
      {
        name: "prepare_project_deletion",
        args: {
          p_project_id: project.id,
          p_actor_id: CREATOR_ID,
          p_replay_only: true,
        },
      },
    ]);
    expect(db.removalCalls).toEqual([]);
    expect(db.calendarCalls).toEqual([]);
  });

  test("another account is told only that the project is not found", async () => {
    const project = await deleteWithLostResponse();
    db.viewer = { id: OTHER_USER_ID };

    expect(await deleteProject(project.id)).toEqual({
      error: "Project not found",
    });
    expect(db.removalCalls).toEqual([]);
  });

  const malformed: Array<{ name: string; data: (id: string) => unknown }> = [
    {
      name: "names another project",
      data: () => ({
        outcome: "completed",
        operationId: "cccccccc-0000-4000-8000-000000000001",
        projectId: "cccccccc-0000-4000-8000-000000000002",
        phase: "completed",
      }),
    },
    {
      name: "is not in the completed phase",
      data: (id) => ({
        outcome: "completed",
        operationId: "cccccccc-0000-4000-8000-000000000001",
        projectId: id,
        phase: "pending",
      }),
    },
    {
      name: "carries no operation",
      data: (id) => ({
        outcome: "completed",
        projectId: id,
        phase: "completed",
      }),
    },
    { name: "is empty", data: () => ({}) },
  ];
  for (const { name, data } of malformed) {
    test(`a replayed receipt that ${name} is not success`, async () => {
      const project = await deleteWithLostResponse();
      db.prepareOverride = { data: data(project.id), error: null };

      expect(await deleteProject(project.id)).toEqual({
        error: "Project not found",
      });
      expect(db.removalCalls).toEqual([]);
      expect(db.calendarCalls).toEqual([]);
    });
  }

  test("a replay that came back as an open deletion is not acted on", async () => {
    const project = await deleteWithLostResponse();
    db.prepareOverride = {
      data: {
        outcome: "prepared",
        operationId: "cccccccc-0000-4000-8000-000000000001",
        projectId: project.id,
        phase: "pending",
        objects: [
          {
            bucket: "project-documents",
            name: `project_${project.id}_x.pdf`,
            objectId: "cccccccc-0000-4000-8000-000000000003",
            present: true,
          },
        ],
      },
      error: null,
    };

    expect(await deleteProject(project.id)).toEqual({
      error: "Project not found",
    });
    expect(db.removalCalls).toEqual([]);
    expect(rpcNames()).toEqual(["prepare_project_deletion"]);
  });

  test("a project that never existed is not found", async () => {
    expect(await deleteProject("dddddddd-0000-4000-8000-000000000001")).toEqual(
      { error: "Project not found" },
    );
    expect(await deleteProject("not-a-project-id")).toEqual({
      error: "Project not found",
    });
    expect(rpcNames()).toEqual(["prepare_project_deletion"]);
  });

  test("a completed receipt returned while the row is still readable is success with no cleanup", async () => {
    const project = seedProjectWithFiles();
    db.prepareOverride = {
      data: {
        outcome: "completed",
        operationId: "cccccccc-0000-4000-8000-000000000001",
        projectId: project.id,
        phase: "completed",
      },
      error: null,
    };

    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.removalCalls).toEqual([]);
    expect(rpcNames()).toEqual(["prepare_project_deletion"]);
  });

  test("a deleted project identity cannot be created again", async () => {
    const project = seedProjectWithFiles();
    expect(await deleteProject(project.id)).toEqual({ success: true });

    expect(insertProject({ id: project.id, creator_id: CREATOR_ID })).toEqual({
      data: null,
      error: { code: "23514", message: "project_identity_retired" },
    });
    expect(insertProject({ creator_id: CREATOR_ID }).error).toBeNull();
  });
});

describe("a project read that is wrong, failed, or empty begins nothing", () => {
  function expectNoDeletionBegun(project: { id: string; coverKey: string }) {
    expect(db.operations.size).toBe(0);
    expect(db.projects.has(project.id)).toBe(true);
    expect(db.stored.size).toBe(2);
    expect(db.registry.get(project.coverKey)?.state).toBe("active");
    expect(db.removalCalls).toEqual([]);
    expect(db.calendarCalls).toEqual([]);
  }

  test("a read that returns a different project makes no database call", async () => {
    const project = seedProjectWithFiles();
    const row = db.projects.get(project.id);
    db.projects.set(project.id, { ...row, id: OTHER_USER_ID });

    expect(await deleteProject(project.id)).toEqual({
      error: "Project not found",
    });
    expect(db.rpcCalls).toEqual([]);
    expectNoDeletionBegun(project);
  });

  test("a read that fails makes no database call", async () => {
    const project = seedProjectWithFiles();
    db.projectReadFailure = { code: "08006", message: "synthetic outage" };

    expect(await deleteProject(project.id)).toEqual({
      error: "Project not found",
    });
    expect(db.rpcCalls).toEqual([]);
    expectNoDeletionBegun(project);
  });

  test("a row the read cannot see is not put into deletion by the replay", async () => {
    // The creator would be allowed to delete this project, and it exists. The
    // read layer returns nothing for it.
    const project = seedProjectWithFiles({
      creator_calendar_event_id: "calendar-event-1",
    });
    db.hiddenFromReads.add(project.id);

    expect(await deleteProject(project.id)).toEqual({
      error: "Project not found",
    });
    expect(db.rpcCalls).toEqual([
      {
        name: "prepare_project_deletion",
        args: {
          p_project_id: project.id,
          p_actor_id: CREATOR_ID,
          p_replay_only: true,
        },
      },
    ]);
    expectNoDeletionBegun(project);

    // Once the row is readable again the ordinary deletion still works.
    db.hiddenFromReads.clear();
    expect(await deleteProject(project.id)).toEqual({ success: true });
  });
});

describe("a failed or unconfirmed removal keeps the deletion open for retry", () => {
  test("a Storage error is reported, the claim stays, and a retry finishes", async () => {
    const project = seedProjectWithFiles();
    db.removalFailure = { "project-images": STORAGE_OUTAGE };

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expect(db.projects.has(project.id)).toBe(true);
    expect(db.registry.get(project.coverKey)?.state).toBe("claimed");
    expect(db.calendarCalls).toEqual([]);

    db.removalFailure = {};
    const operationId = pendingOperation(project.id)?.id;
    expect(operationId).toBeDefined();
    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.operations.get(project.id)?.id).toBe(operationId);
    expect(db.stored.size).toBe(0);
  });

  test("a removal whose response was lost is confirmed from the catalog on retry", async () => {
    const project = seedProjectWithFiles();
    db.removalLosesResponse = true;

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expect(db.stored.has(project.coverKey)).toBe(false);
    expect(db.projects.has(project.id)).toBe(true);

    db.removalCalls = [];
    expect(await deleteProject(project.id)).toEqual({ success: true });
    // The cover is already gone, so only the document is requested again.
    expect(db.removalCalls).toEqual([
      { bucket: "project-documents", paths: [project.guide] },
    ]);
    expect(db.projects.has(project.id)).toBe(false);
  });

  test("a removal Storage reports but did not perform is not treated as done", async () => {
    const project = seedProjectWithFiles();
    db.removalReportsSuccessWithoutRemoving = true;

    expect(await deleteProject(project.id)).toEqual({ error: FILES_REMAIN });
    expect(db.projects.has(project.id)).toBe(true);
    expect(db.stored.size).toBe(2);
    expect(pendingOperation(project.id)).not.toBeNull();
  });

  test("an object replaced under a claimed name blocks completion and is kept", async () => {
    const project = seedProjectWithFiles();
    db.removalFailure = { "project-images": STORAGE_OUTAGE };
    await silenced(() => deleteProject(project.id));
    db.removalFailure = {};
    // Out-of-band replacement: a different object now sits under the name.
    db.stored.set(project.coverKey, { id: nextUuid() });

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expect(db.stored.has(project.coverKey)).toBe(true);
    expect(db.projects.has(project.id)).toBe(true);

    db.removalReportsSuccessWithoutRemoving = true;
    expect(await deleteProject(project.id)).toEqual({ error: FILES_REMAIN });
    expect(db.projects.has(project.id)).toBe(true);
  });

  test("a calendar failure keeps the project and the retry completes", async () => {
    const project = seedProjectWithFiles({
      creator_calendar_event_id: "calendar-event-1",
    });
    db.calendarFails = true;

    expect(await deleteProject(project.id)).toEqual({
      error: "Failed to clean up the project calendar event",
    });
    expect(db.projects.has(project.id)).toBe(true);
    expect(rpcNames()).toEqual(["prepare_project_deletion"]);

    db.calendarFails = false;
    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.calendarCalls).toEqual([project.id, project.id]);
  });

  test("a project with too many files is refused whole, never partly cleaned", async () => {
    const project = seedProjectWithFiles();
    db.assetLimit = 1;

    expect(await deleteProject(project.id)).toEqual({
      error:
        "This project has too many stored files to delete in one step. Contact support.",
    });
    expect(db.removalCalls).toEqual([]);
    expect(db.operations.size).toBe(0);
    expect(db.registry.get(project.coverKey)?.state).toBe("active");
  });

  test("many files are removed in bounded batches", async () => {
    const id = seedProject();
    for (let index = 0; index < 230; index += 1) {
      upload(
        "project-documents",
        `project_${id}_file_${index}.pdf`,
        CREATOR_ID,
      );
    }

    expect(await deleteProject(id)).toEqual({ success: true });

    expect(db.removalCalls.map((call) => call.paths.length)).toEqual([
      100, 100, 30,
    ]);
    expect(db.stored.size).toBe(0);
  });
});

describe("the removal itself rechecks the actor carrying the deletion", () => {
  function organizationProject() {
    const project = seedProjectWithFiles({ organization_id: ORGANIZATION_ID });
    db.members = [
      {
        organization_id: ORGANIZATION_ID,
        user_id: OTHER_USER_ID,
        role: "admin",
        status: "active",
      },
    ];
    db.viewer = { id: OTHER_USER_ID };
    return project;
  }

  function expectNothingRemoved(project: { id: string }) {
    expect(db.stored.size).toBe(2);
    expect(db.projects.has(project.id)).toBe(true);
    expect(db.calendarCalls).toEqual([]);
    expect(rpcNames()).toEqual(["prepare_project_deletion"]);
  }

  test("an administrator revoked after prepare removes no file, and the creator can finish", async () => {
    const project = organizationProject();
    db.beforeRemoval = () => {
      db.members[0].status = "inactive";
    };

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expectNothingRemoved(project);

    // Any actor who is authorized now may carry the open deletion forward.
    db.beforeRemoval = null;
    db.viewer = { id: CREATOR_ID };
    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.stored.size).toBe(0);
    expect(db.operations.get(project.id)?.actorId).toBe(CREATOR_ID);
  });

  test("an account closed after prepare removes no file", async () => {
    const project = organizationProject();
    db.beforeRemoval = () => db.inactiveAccounts.add(OTHER_USER_ID);

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expectNothingRemoved(project);
  });

  test("a waiver signed after prepare removes no file", async () => {
    const project = organizationProject();
    db.beforeRemoval = () => db.signedWaivers.set(project.id, 1);

    expect(await silenced(() => deleteProject(project.id))).toEqual({
      error: "Failed to clean up the project cover image",
    });
    expectNothingRemoved(project);
  });
});

describe("a claimed or removed file cannot gain a new link or a late upload", () => {
  /** Leaves the deletion open with its files claimed. */
  async function openDeletion() {
    const project = seedProjectWithFiles();
    db.removalFailure = {
      "project-images": STORAGE_OUTAGE,
      "project-documents": STORAGE_OUTAGE,
    };
    await silenced(() => deleteProject(project.id));
    db.removalFailure = {};
    expect(pendingOperation(project.id)).not.toBeNull();
    return project;
  }

  test("a clone started from a stale copy of the source is refused", async () => {
    const project = await openDeletion();
    const before = db.projects.size;

    expect(await cloneProject(project.id)).toEqual({ error: CLONE_REFUSED });
    expect(db.projects.size).toBe(before);
  });

  test("another project cannot link a claimed file by a direct write", async () => {
    const project = await openDeletion();
    const other = seedProject();
    const link = { cover_image_url: urlOf("project-images", project.cover) };
    const unavailable = { code: "23514", message: "project_asset_unavailable" };

    expect(writeProjectAssets(other, link)).toEqual(unavailable);
    expect(db.projects.get(other)?.cover_image_url).toBeNull();

    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.stored.has(project.coverKey)).toBe(false);
    // The tombstone still refuses the link after the file is gone.
    expect(writeProjectAssets(other, link)).toEqual(unavailable);
  });

  test("the project being deleted accepts no upload and no new link", async () => {
    const project = await openDeletion();
    const frozen = { code: "23514", message: "project_deletion_in_progress" };

    expect(
      upload("project-documents", `project_${project.id}_late.pdf`, CREATOR_ID),
    ).toEqual(frozen);
    expect(writeProjectAssets(project.id, { documents: [] })).toEqual(frozen);

    expect(await deleteProject(project.id)).toEqual({ success: true });
    expect(db.stored.size).toBe(0);
    // A name a deletion removed is never reused.
    expect(upload("project-documents", project.guide, CREATOR_ID)).toEqual({
      code: "23514",
      message: "project_asset_object_retired",
    });
  });

  test("a direct Storage removal cannot take a file another project links", async () => {
    const source = seedProjectWithFiles();
    await cloneOf(source.id);

    expect(removeStoredObject("project-images", source.cover)).toEqual({
      code: "23503",
      message: "project_asset_referenced",
    });
    expect(db.stored.has(source.coverKey)).toBe(true);
  });

  test("a file removed directly cannot be linked by a clone made from stale data", async () => {
    const source = seedProjectWithFiles();
    // The edit screen removes the object before it clears the link.
    expect(removeStoredObject("project-images", source.cover)).toBeNull();
    expect(db.stored.has(source.coverKey)).toBe(false);
    expect(db.registry.get(source.coverKey)).toMatchObject({
      state: "deleted",
      claimOperationId: null,
    });

    const before = db.projects.size;
    expect(await cloneProject(source.id)).toEqual({ error: CLONE_REFUSED });
    expect(db.projects.size).toBe(before);

    // The owner can still clear its link, and then a clone is made normally.
    expect(writeProjectAssets(source.id, { cover_image_url: null })).toBeNull();
    const cloneId = await cloneOf(source.id);
    expect(db.projects.get(cloneId)?.cover_image_url).toBeNull();

    // An ordinary removal does not retire the name: it can be uploaded again.
    expect(upload("project-images", source.cover, CREATOR_ID)).toBeNull();
    expect(db.registry.get(source.coverKey)?.state).toBe("active");
  });
});

describe("authorization and retention fail closed before any removal", () => {
  function expectNothingTouched() {
    expect(db.removalCalls).toEqual([]);
    expect(db.calendarCalls).toEqual([]);
    expect(db.operations.size).toBe(0);
  }

  test("a signed-out visitor is refused", async () => {
    const project = seedProjectWithFiles();
    db.viewer = null;

    expect(await deleteProject(project.id)).toEqual({
      error: "You must be logged in to delete a project",
    });
    expect(db.rpcCalls).toEqual([]);
    expectNothingTouched();
  });

  for (const [role, status] of [
    ["admin", "inactive"],
    ["admin", null],
    ["staff", "active"],
    ["member", "active"],
  ] as const) {
    test(`an organization ${role} whose status is ${status} cannot delete`, async () => {
      const id = seedProject({ organization_id: ORGANIZATION_ID });
      db.viewer = { id: OTHER_USER_ID };
      db.members = [
        {
          organization_id: ORGANIZATION_ID,
          user_id: OTHER_USER_ID,
          role,
          status,
        },
      ];

      expect(await deleteProject(id)).toEqual({
        error: "You don't have permission to delete this project",
      });
      expect(db.rpcCalls).toEqual([]);
      expectNothingTouched();
    });
  }

  test("an active organization admin can delete", async () => {
    const id = seedProject({ organization_id: ORGANIZATION_ID });
    db.viewer = { id: OTHER_USER_ID };
    db.members = [
      {
        organization_id: ORGANIZATION_ID,
        user_id: OTHER_USER_ID,
        role: "admin",
        status: "active",
      },
    ];

    expect(await deleteProject(id)).toEqual({ success: true });
    expect(db.rpcCalls[0].args.p_actor_id).toBe(OTHER_USER_ID);
  });

  test("the database's own refusal wins over a passing precheck", async () => {
    const project = seedProjectWithFiles();
    db.prepareOverride = { data: { outcome: "forbidden" }, error: null };

    expect(await deleteProject(project.id)).toEqual({
      error: "You don't have permission to delete this project",
    });
    expectNothingTouched();
  });

  test("signed waivers block every removal", async () => {
    const project = seedProjectWithFiles();
    db.signedWaivers.set(project.id, 1);

    expect(await deleteProject(project.id)).toMatchObject({
      error: expect.stringContaining("signed waivers"),
    });
    expect(db.rpcCalls).toEqual([]);
    expectNothingTouched();
    expect(db.stored.size).toBe(2);
  });

  test("a waiver signed after the precheck is still caught by the database", async () => {
    const project = seedProjectWithFiles();
    db.prepareOverride = { data: { outcome: "signed_waivers" }, error: null };

    expect(await deleteProject(project.id)).toMatchObject({
      error: expect.stringContaining("signed waivers"),
    });
    expectNothingTouched();
  });

  test("a waiver that appears before finalize keeps the project", async () => {
    const project = seedProjectWithFiles();
    db.beforeFinalize = () => db.signedWaivers.set(project.id, 1);

    expect(await deleteProject(project.id)).toMatchObject({
      error: expect.stringContaining("signed waivers"),
    });
    expect(db.projects.has(project.id)).toBe(true);
  });

  test("an unreadable waiver count fails closed", async () => {
    const project = seedProjectWithFiles();
    db.waiverCountFailure = { code: "08006", message: "synthetic outage" };

    expect(await deleteProject(project.id)).toEqual({
      error: "Unable to verify the project's waiver-retention state",
    });
    expect(db.rpcCalls).toEqual([]);
    expectNothingTouched();
  });
});
