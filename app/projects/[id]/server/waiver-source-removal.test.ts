import { beforeEach, expect, mock, test } from "bun:test";

const projectId = "11111111-1111-4111-8111-111111111111";
const sourcePath = `project_waivers/${projectId}/fictional.pdf`;
let allowed = true;
let project: Record<string, unknown>;
let updateFails = false;
let queueThrows = false;
const effects: string[] = [];
const client = {
  from(table: string) {
    const chain: Record<string, unknown> = {};
    let update: Record<string, unknown> | undefined;
    for (const method of ["select", "eq", "is", "limit"])
      chain[method] = () => chain;
    chain.update = (value: Record<string, unknown>) => {
      update = value;
      return chain;
    };
    chain.maybeSingle = async () => {
      if (update) {
        effects.push("detach");
        if (updateFails)
          return { data: null, error: { message: "fictional refusal" } };
        project = { ...project, ...update };
        return { data: { id: projectId }, error: null };
      }
      return {
        data: table === "projects" ? { ...project } : null,
        error: null,
      };
    };
    chain.then = (resolve: (value: unknown) => void) => {
      if (update) {
        effects.push("detach");
        if (!updateFails) project = { ...project, ...update };
      }
      resolve({
        data: updateFails ? null : [{ id: projectId }],
        error: updateFails ? { message: "fictional refusal" } : null,
      });
    };
    return chain;
  },
  rpc: async (name: string, params: { p_object_path: string }) => {
    effects.push(`queue:${name}`);
    expect(project.waiver_pdf_storage_path).toBeNull();
    expect(params.p_object_path).toBe(sourcePath);
    if (queueThrows) throw new Error("fictional transport interruption");
    return { data: true, error: null };
  },
  storage: {
    from: () => ({
      remove: async () => {
        effects.push("direct-delete");
        return {
          error: project.waiver_pdf_storage_path
            ? { message: "referenced immutable source" }
            : null,
        };
      },
    }),
  },
};
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/app/projects/[id]/server/access", () => ({
  canCurrentUserManageProject: async () => allowed,
}));
const { removeProjectWaiverPdf } = await import("./waiver-assets");

beforeEach(() => {
  allowed = true;
  updateFails = false;
  queueThrows = false;
  effects.length = 0;
  project = {
    id: projectId,
    workflow_status: "draft",
    waiver_required: true,
    waiver_pdf_storage_path: sourcePath,
    waiver_pdf_url: "https://fixture.invalid/fictional.pdf",
    waiver_definition_id: null,
  };
});

test("unsigned draft detaches before existing reference-rechecked durable cleanup", async () => {
  expect((await removeProjectWaiverPdf(projectId)).success).toBe(true);
  expect(effects).toEqual(["detach", "queue:enqueue_superseded_waiver_source"]);
});

test("failed detach preserves the source without deleting or queueing it", async () => {
  updateFails = true;
  expect((await removeProjectWaiverPdf(projectId)).error).toBeTruthy();
  expect(project.waiver_pdf_storage_path).toBe(sourcePath);
  expect(effects).toEqual(["detach"]);
});

test("unauthorized and published locked removal performs no mutations", async () => {
  allowed = false;
  expect((await removeProjectWaiverPdf(projectId)).error).toBeTruthy();
  allowed = true;
  project.workflow_status = "published";
  expect((await removeProjectWaiverPdf(projectId)).error).toBeTruthy();
  expect(effects).toEqual([]);
});

test("a queue transport error after durable detach does not misreport removal", async () => {
  queueThrows = true;
  const result = await removeProjectWaiverPdf(projectId);
  expect(result.success).toBe(true);
  expect(project.waiver_pdf_storage_path).toBeNull();
  expect(effects).toEqual(["detach", "queue:enqueue_superseded_waiver_source"]);
});
