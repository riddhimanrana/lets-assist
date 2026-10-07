import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const drafts = [
  {
    id: "draft-a",
    user_id: "viewer",
    draft_data: {
      basicInfo: { title: "Older event", organizationId: "org-a" },
    },
  },
  {
    id: "draft-b",
    user_id: "viewer",
    draft_data: {
      basicInfo: { title: "Latest event", organizationId: "org-b" },
    },
  },
  {
    id: "other-user-draft",
    user_id: "someone-else",
    draft_data: {
      basicInfo: { title: "Private event", organizationId: "org-b" },
    },
  },
];
const pluginOrganizations: string[] = [];

class Query {
  filters: Record<string, unknown> = {};
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters[field] = value;
    return this;
  }
  or() {
    return this;
  }
  in() {
    return this;
  }
  rows() {
    if (this.table === "project_drafts") {
      return drafts.filter((draft) =>
        Object.entries(this.filters).every(
          ([field, value]) => draft[field as keyof typeof draft] === value,
        ),
      );
    }
    if (this.table === "organization_members") {
      return ["org-a", "org-b", "org-c"]
        .filter(
          (id) =>
            !this.filters.organization_id ||
            id === this.filters.organization_id,
        )
        .map((id) => ({
          organization_id: id,
          role: "admin",
          organizations: { name: id },
        }));
    }
    return [];
  }
  order() {
    return Promise.resolve({ data: this.rows().toReversed() });
  }
  single() {
    return Promise.resolve({ data: this.rows()[0] ?? null });
  }
  maybeSingle() {
    return this.single();
  }
  then(resolve: (value: unknown) => unknown) {
    return Promise.resolve({ data: this.rows() }).then(resolve);
  }
}

mock.module("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost" }),
}));
mock.module("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
mock.module("./ProjectCreator", () => ({ default: () => null }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
    from: (table: string) => new Query(table),
  }),
}));
mock.module("@/lib/profile/public", () => ({
  getProjectCreatorProfileById: async () => ({
    data: { trusted_member: true },
  }),
}));
mock.module("@/lib/plugins/resolve-plugin-behaviors", () => ({
  resolveOrganizationPluginBehaviorHook: async ({
    organizationId,
  }: {
    organizationId: string;
  }) => {
    pluginOrganizations.push(organizationId);
    return [];
  },
}));

const { default: CreateProjectPage } = await import("./page");

async function editor(search: { org?: string; draft?: string }) {
  const page = await CreateProjectPage({
    searchParams: Promise.resolve(search),
  });
  return (
    page as ReactElement<{ children: ReactElement<Record<string, unknown>> }>
  ).props.children;
}

describe("project create route draft intent", () => {
  beforeEach(() => {
    pluginOrganizations.length = 0;
  });

  test("new organization project stays empty despite existing drafts", async () => {
    const result = await editor({ org: "org-c" });
    expect(result.props.initialDraftId).toBeNull();
    expect(result.props.initialDraftData).toBeUndefined();
    expect(result.props.initialOrgId).toBe("org-c");
    expect(result.key).toBe("new:org-c");
    expect(pluginOrganizations).toEqual(["org-c"]);
  });

  test("personal new project does not resume the latest organization draft", async () => {
    const result = await editor({});
    expect(result.props.initialDraftData).toBeUndefined();
    expect(result.props.initialOrgId).toBeUndefined();
    expect(result.key).toBe("new:personal");
  });

  test("explicit resume uses the saved organization for both editor and plugins", async () => {
    const result = await editor({ draft: "draft-a", org: "org-c" });
    expect(result.props.initialDraftId).toBe("draft-a");
    expect(result.props.initialOrgId).toBe("org-a");
    expect(result.key).toBe("draft-a");
    expect(pluginOrganizations).toEqual(["org-a"]);
  });

  test("missing and another user's drafts fail instead of selecting a replacement", async () => {
    await expect(editor({ draft: "missing" })).rejects.toThrow("not-found");
    await expect(editor({ draft: "other-user-draft" })).rejects.toThrow(
      "not-found",
    );
  });
});
