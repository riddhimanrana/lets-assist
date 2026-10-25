import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type Props = Record<string, unknown>;

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const project = {
  id: PROJECT_ID,
  title: "Fictional park cleanup",
  creator_id: "creator",
  organization_id: null,
  status: "upcoming",
  event_type: "oneTime",
  schedule: {},
  can_be_managed_by_staff: false,
};
const creator = { id: "creator", full_name: "Fictional Organizer" };

const state: {
  project: Props;
  profile: Props;
  projectReads: string[];
  profileReads: string[];
  // Everything the page does after its two critical reads.
  downstream: string[];
  clients: Props[];
  unauthorized: Props[];
} = {
  project: { project },
  profile: { profile: creator },
  projectReads: [],
  profileReads: [],
  downstream: [],
  clients: [],
  unauthorized: [],
};

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({
    refresh: () => {
      throw new Error("Unexpected automatic refresh");
    },
  }),
}));
mock.module("./actions", () => ({
  getProject: async (id: string) => {
    state.projectReads.push(id);
    return state.project;
  },
  getCreatorProfile: async (id: string) => {
    state.profileReads.push(id);
    return state.profile;
  },
}));
mock.module("./ProjectClient", () => ({
  default: (props: Props) => {
    state.clients.push(props);
    return <div data-stub="project-client" />;
  },
}));
mock.module("./ProjectUnauthorized", () => ({
  default: (props: Props) => {
    state.unauthorized.push(props);
    return <div data-stub="project-unauthorized" />;
  },
}));
mock.module("@/app/projects/_components/VolunteerStatusCard", () => ({
  default: () => <div data-stub="volunteer-status-card" />,
}));
mock.module("@/components/feedback/PlatformRatingPrompt", () => ({
  PlatformRatingPrompt: () => <div data-stub="rating-prompt" />,
}));
mock.module("@/lib/feedback/platform-prompt", () => ({
  getPlatformRatingPromptState: async () => {
    state.downstream.push("rating-prompt-state");
    return false;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      state.downstream.push(`read:${table}`);
      throw new Error(`Unexpected read of ${table}`);
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    state.downstream.push("admin-client");
    return {};
  },
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => {
    state.downstream.push("auth-user");
    return { user: null };
  },
}));
mock.module("@/utils/project", () => ({
  getSlotCapacities: async () => {
    state.downstream.push("slot-capacities");
    return {};
  },
}));
mock.module("@/lib/projects/volunteer-attendance-intervals", () => ({
  loadVolunteerAttendanceIntervals: async () => {
    state.downstream.push("attendance-intervals");
    return {};
  },
}));

const { default: ProjectPage } = await import("./page");

const load = (id = PROJECT_ID) =>
  ProjectPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
const render = async (id = PROJECT_ID) => renderToStaticMarkup(await load(id));

function expectLoadError(html: string) {
  expect(html).toContain('role="alert"');
  expect(html).toContain("We couldn&#x27;t load this project");
  expect(html).toContain(">Try again</button>");
  expect(html).not.toContain("project-client");
  expect(html).not.toContain("project-unauthorized");
  expect(html).not.toContain(PROJECT_ID);
  expect(html).not.toContain("Failed to fetch");
  expect(state.clients).toEqual([]);
  expect(state.downstream).toEqual([]);
}

describe("project page read errors", () => {
  beforeEach(() => {
    state.project = { project };
    state.profile = { profile: creator };
    state.projectReads = [];
    state.profileReads = [];
    state.downstream = [];
    state.clients = [];
    state.unauthorized = [];
  });

  test("a failed project read shows the error and stops before every later read", async () => {
    state.project = { error: "Failed to fetch project" };

    expectLoadError(await render());
    expect(state.projectReads).toEqual([PROJECT_ID]);
    expect(state.profileReads).toEqual([]);
  });

  test("a failed creator read shows the error and stops before every later read", async () => {
    state.profile = { error: "Failed to fetch creator profile" };

    expectLoadError(await render());
    expect(state.profileReads).toEqual(["creator"]);
  });

  test("a missing project stays a 404", async () => {
    state.project = { project: null };

    await expect(load()).rejects.toThrow("not-found");
    expect(state.profileReads).toEqual([]);
    expect(state.downstream).toEqual([]);
  });

  test("an id that cannot be a project stays a 404 when its query fails", async () => {
    state.project = { error: "Failed to fetch project" };

    await expect(load("not-a-project-id")).rejects.toThrow("not-found");
    expect(state.profileReads).toEqual([]);
    expect(state.downstream).toEqual([]);
  });

  test("a missing creator stays a 404", async () => {
    state.profile = { profile: null };

    await expect(load()).rejects.toThrow("not-found");
    expect(state.downstream).toEqual([]);
  });

  test("a private project keeps the unauthorized screen", async () => {
    state.project = { error: "unauthorized", project: null };

    const html = await render();

    expect(html).toContain("project-unauthorized");
    expect(html).not.toContain('role="alert"');
    expect(state.unauthorized).toEqual([{ projectId: PROJECT_ID }]);
    expect(state.profileReads).toEqual([]);
    expect(state.downstream).toEqual([]);
  });

  test("a loaded project still reaches the project view", async () => {
    const html = await render();

    expect(html).toContain("project-client");
    expect(html).not.toContain('role="alert"');
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]).toEqual(
      expect.objectContaining({
        project,
        creator,
        initialUser: null,
        initialIsCreator: false,
        initialCanManageProject: false,
      }),
    );
    expect(state.downstream).toEqual([
      "auth-user",
      "admin-client",
      "slot-capacities",
    ]);
  });
});
