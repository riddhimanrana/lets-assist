import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type QueryResult = { data: unknown; error: unknown };

const state: {
  user: { id: string } | null;
  drafts: QueryResult;
  reads: string[];
  listed: unknown[][];
} = {
  user: { id: "viewer" },
  drafts: { data: [], error: null },
  reads: [],
  listed: [],
};

mock.module("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({
    refresh: () => {
      throw new Error("Unexpected automatic refresh");
    },
  }),
}));
mock.module("./DraftsClient", () => ({
  default: ({ drafts }: { drafts: unknown[] }) => {
    state.listed.push(drafts);
    return <div data-stub="drafts-client" />;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      state.reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => state.drafts,
      };
      return query;
    },
  }),
}));

const { default: DraftsPage } = await import("./page");

const render = async () => renderToStaticMarkup(await DraftsPage());

describe("drafts page read errors", () => {
  beforeEach(() => {
    state.user = { id: "viewer" };
    state.drafts = { data: [], error: null };
    state.reads = [];
    state.listed = [];
  });

  test("a failed read shows the error and retry, never an empty list", async () => {
    state.drafts = {
      data: null,
      error: {
        code: "08006",
        message: "fictional connection failure at db.internal.test",
      },
    };

    const html = await render();

    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t load your drafts");
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("drafts-client");
    expect(html).not.toContain("No drafts yet");
    expect(html).not.toContain("08006");
    expect(html).not.toContain("db.internal.test");
    expect(state.listed).toEqual([]);
    expect(state.reads).toEqual(["project_drafts"]);
  });

  test("a successful empty read keeps the normal empty list", async () => {
    const html = await render();

    expect(html).toContain("drafts-client");
    expect(html).not.toContain('role="alert"');
    expect(state.listed).toEqual([[]]);
  });

  test("a successful read still lists the saved drafts", async () => {
    state.drafts = {
      data: [
        {
          id: "draft-a",
          title: "Fictional park cleanup",
          draft_data: null,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const html = await render();

    expect(html).not.toContain('role="alert"');
    expect(state.listed).toHaveLength(1);
    expect(state.listed[0]).toEqual([
      expect.objectContaining({
        id: "draft-a",
        title: "Fictional park cleanup",
        workflow_status: "draft",
      }),
    ]);
  });

  test("a signed-out visitor is still redirected before any read", async () => {
    state.user = null;

    await expect(DraftsPage()).rejects.toThrow(
      "redirect:/login?redirect=/projects/drafts",
    );
    expect(state.reads).toEqual([]);
  });
});
