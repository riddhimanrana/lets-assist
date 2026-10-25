import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement } from "react";

type QueryResult = { data: unknown; error: unknown };
type Props = Record<string, unknown>;

const FAILURE = {
  code: "08006",
  message: "fictional connection failure at db.internal.test",
};
const createdRows = [
  {
    id: "created-1",
    title: "Fictional park cleanup",
    creator_id: "viewer",
    workflow_status: "published",
    event_type: "oneTime",
    schedule: null,
    recurrence_rule: null,
    project_signups: [{ status: "approved" }],
  },
];
const volunteeredProject = {
  id: "volunteered-1",
  title: "Fictional food drive",
  creator_id: "organizer",
  workflow_status: "published",
  event_type: "oneTime",
  schedule: null,
  published: null,
};
// Two signups for one project must still produce one card.
const signupRows = [
  {
    id: "signup-1",
    status: "approved",
    schedule_id: "oneTime",
    projects: volunteeredProject,
  },
  {
    id: "signup-2",
    status: "approved",
    schedule_id: "oneTime",
    projects: volunteeredProject,
  },
];

const state: {
  user: { id: string } | null;
  created: QueryResult;
  signups: QueryResult;
  reads: string[];
  creatorLookups: string[][];
} = {
  user: { id: "viewer" },
  created: { data: [], error: null },
  signups: { data: [], error: null },
  reads: [],
  creatorLookups: [],
};

function resultFor(table: string): QueryResult {
  if (table === "projects") return state.created;
  if (table === "project_signups") return state.signups;
  return {
    data: {
      id: "viewer",
      full_name: "Fictional Viewer",
      avatar_url: null,
      username: "fictional-viewer",
    },
    error: null,
  };
}

mock.module("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));
const ProjectCard = () => null;
mock.module("./ProjectCard", () => ({ ProjectCard }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      state.reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: async () => resultFor(table),
        single: async () => resultFor(table),
      };
      return query;
    },
  }),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: state.user }),
}));
mock.module("@/lib/profile/public", () => ({
  getPublicProfilesByIds: async (ids: string[]) => {
    state.creatorLookups.push(ids);
    return {
      data: [
        {
          id: "organizer",
          full_name: "Fictional Organizer",
          avatar_url: null,
          username: "fictional-organizer",
        },
      ],
      error: null,
    };
  },
}));

const { ReadLoadError } = await import("@/components/projects/ReadLoadError");
const { EmptyTitle } = await import("@/components/ui/empty");
const { TabsContent, TabsTrigger } = await import("@/components/ui/tabs");
const { default: UserProjects } = await import("./UserProjects");

function propsOf(element: ReactElement): Props {
  return element.props as Props;
}

/** Every element in the returned tree, following children and element props. */
function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (isValidElement(node)) {
    found.push(node);
    for (const value of Object.values(propsOf(node))) elements(value, found);
  }
  return found;
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text(propsOf(node).children);
  return "";
}

async function view() {
  const tree = elements(await UserProjects());
  const byValue = (type: unknown, value: string) => {
    const match = tree.find(
      (element) => element.type === type && propsOf(element).value === value,
    );
    if (!match) throw new Error(`Missing ${value}`);
    return match;
  };
  const pane = (value: string) => {
    const inside = elements(byValue(TabsContent, value));
    return {
      errors: inside
        .filter((element) => element.type === ReadLoadError)
        .map(propsOf),
      cards: inside
        .filter((element) => element.type === ProjectCard)
        .map((element) => propsOf(element).project as Props),
      emptyTitles: inside
        .filter((element) => element.type === EmptyTitle)
        .map(text),
    };
  };

  return {
    volunteeringTab: text(byValue(TabsTrigger, "volunteering")),
    createdTab: text(byValue(TabsTrigger, "created")),
    // The accessible name override, set only when a count is unknown.
    volunteeringLabel: propsOf(byValue(TabsTrigger, "volunteering"))[
      "aria-label"
    ],
    createdLabel: propsOf(byValue(TabsTrigger, "created"))["aria-label"],
    volunteering: pane("volunteering"),
    created: pane("created"),
  };
}

describe("my projects read errors", () => {
  beforeEach(() => {
    state.user = { id: "viewer" };
    state.created = { data: createdRows, error: null };
    state.signups = { data: signupRows, error: null };
    state.reads = [];
    state.creatorLookups = [];
  });

  test("both reads succeeding keeps counts, creators, deduplication and status", async () => {
    const page = await view();

    expect(page.volunteeringTab).toBe("Volunteering for1");
    expect(page.createdTab).toBe("Created1");
    expect(page.volunteeringLabel).toBeUndefined();
    expect(page.createdLabel).toBeUndefined();
    expect(page.volunteering.errors).toEqual([]);
    expect(page.created.errors).toEqual([]);
    expect(page.volunteering.cards).toEqual([
      expect.objectContaining({
        id: "volunteered-1",
        signup_id: "signup-1",
        status: "upcoming",
        creator: expect.objectContaining({ full_name: "Fictional Organizer" }),
      }),
    ]);
    expect(page.created.cards).toEqual([
      expect.objectContaining({
        id: "created-1",
        status: "upcoming",
        creator: expect.objectContaining({ full_name: "Fictional Viewer" }),
      }),
    ]);
    expect(state.reads).toEqual(["profiles", "projects", "project_signups"]);
    expect(state.creatorLookups).toEqual([["organizer", "organizer"]]);
  });

  test("a failed created read is unknown while volunteering still loads", async () => {
    state.created = { data: null, error: FAILURE };

    const page = await view();

    expect(page.createdTab).toBe("Created");
    expect(page.createdLabel).toBe("Created, count unavailable");
    expect(page.volunteeringLabel).toBeUndefined();
    expect(page.created.errors).toEqual([
      { title: "We couldn't load the projects you created" },
    ]);
    expect(page.created.cards).toEqual([]);
    expect(page.created.emptyTitles).toEqual([]);
    expect(page.volunteeringTab).toBe("Volunteering for1");
    expect(page.volunteering.errors).toEqual([]);
    expect(page.volunteering.cards).toHaveLength(1);
    expect(state.reads).toEqual(["profiles", "projects", "project_signups"]);
  });

  test("a failed signups read is unknown while created still loads", async () => {
    state.signups = { data: null, error: FAILURE };

    const page = await view();

    expect(page.volunteeringTab).toBe("Volunteering for");
    expect(page.volunteeringLabel).toBe("Volunteering for, count unavailable");
    expect(page.createdLabel).toBeUndefined();
    expect(page.volunteering.errors).toEqual([
      { title: "We couldn't load your volunteer signups" },
    ]);
    expect(page.volunteering.cards).toEqual([]);
    expect(page.volunteering.emptyTitles).toEqual([]);
    expect(page.createdTab).toBe("Created1");
    expect(page.created.errors).toEqual([]);
    expect(page.created.cards).toHaveLength(1);
    expect(state.creatorLookups).toEqual([]);
    expect(state.reads).toEqual(["profiles", "projects", "project_signups"]);
  });

  test("both reads failing shows two errors and no counts or backend detail", async () => {
    state.created = { data: null, error: FAILURE };
    state.signups = { data: null, error: FAILURE };

    const page = await view();

    expect(page.volunteeringTab).toBe("Volunteering for");
    expect(page.createdTab).toBe("Created");
    expect(page.volunteeringLabel).toBe("Volunteering for, count unavailable");
    expect(page.createdLabel).toBe("Created, count unavailable");
    expect(page.volunteering.errors).toHaveLength(1);
    expect(page.created.errors).toHaveLength(1);
    const copy = JSON.stringify([page.volunteering, page.created]);
    expect(copy).not.toContain(FAILURE.code);
    expect(copy).not.toContain("db.internal.test");
  });

  test("successful empty reads keep zero counts and the normal empty states", async () => {
    state.created = { data: [], error: null };
    state.signups = { data: [], error: null };

    const page = await view();

    expect(page.volunteeringTab).toBe("Volunteering for0");
    expect(page.createdTab).toBe("Created0");
    expect(page.volunteeringLabel).toBeUndefined();
    expect(page.createdLabel).toBeUndefined();
    expect(page.volunteering.errors).toEqual([]);
    expect(page.created.errors).toEqual([]);
    expect(page.volunteering.emptyTitles).toEqual(["No volunteer signups yet"]);
    expect(page.created.emptyTitles).toEqual(["No projects created yet"]);
    expect(state.creatorLookups).toEqual([]);
  });

  test("a signed-out visitor is still redirected before any read", async () => {
    state.user = null;

    await expect(UserProjects()).rejects.toThrow("redirect:/login");
    expect(state.reads).toEqual([]);
  });
});
