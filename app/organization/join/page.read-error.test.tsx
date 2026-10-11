import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type QueryResult = { data: unknown; error: unknown };
type Props = Record<string, unknown>;

const JOIN_CODE = "FICTIONAL-JOIN-CODE";
const organization = {
  id: "organization-1",
  name: "Fictional Volunteers",
  username: "fictional-volunteers",
  logo_url: null,
};

const state: {
  user: { id: string } | null;
  lookup: QueryResult;
  authReads: number;
  lookups: { table: string; filter: unknown[] }[];
  loaders: Props[];
  signInCards: Props[];
} = {
  user: { id: "viewer" },
  lookup: { data: organization, error: null },
  authReads: 0,
  lookups: [],
  loaders: [],
  signInCards: [],
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
mock.module("./JoinLoader", () => ({
  default: (props: Props) => {
    state.loaders.push(props);
    return <div data-stub="join-loader" />;
  },
}));
mock.module("./JoinSignInCard", () => ({
  default: (props: Props) => {
    state.signInCards.push(props);
    return <div data-stub="join-sign-in-card" />;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        state.authReads += 1;
        return { data: { user: state.user }, error: null };
      },
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (...filter: unknown[]) => ({
          maybeSingle: async () => {
            state.lookups.push({ table, filter });
            return state.lookup;
          },
          single: async () => {
            throw new Error("The join lookup must use maybeSingle");
          },
        }),
      }),
    }),
  }),
}));

const { default: JoinOrganizationPage } = await import("./page");

const load = (search: Record<string, string | undefined>) =>
  JoinOrganizationPage({ searchParams: Promise.resolve(search) });
const render = async () =>
  renderToStaticMarkup(await load({ code: JOIN_CODE }));

describe("organization join lookup errors", () => {
  beforeEach(() => {
    state.user = { id: "viewer" };
    state.lookup = { data: organization, error: null };
    state.authReads = 0;
    state.lookups = [];
    state.loaders = [];
    state.signInCards = [];
  });

  test("a failed lookup shows the error and retry without joining", async () => {
    state.lookup = {
      data: null,
      error: {
        code: "08006",
        message: `fictional failure for join_code=eq.${JOIN_CODE}`,
      },
    };
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    const html = await render().finally(() => {
      console.error = originalError;
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t check this join link");
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("join-loader");
    expect(html).not.toContain("join-sign-in-card");
    expect(html).not.toContain(JOIN_CODE);
    expect(html).not.toContain("fictional failure");
    expect(state.loaders).toEqual([]);
    expect(state.signInCards).toEqual([]);
    expect(state.lookups).toHaveLength(1);

    expect(logged).toHaveLength(1);
    const diagnostics = JSON.stringify(logged);
    expect(diagnostics).not.toContain(JOIN_CODE);
    expect(diagnostics).not.toContain("fictional failure");
  });

  test("a failed lookup shows the same error to a signed-out visitor", async () => {
    state.user = null;
    state.lookup = {
      data: null,
      error: { code: "57014", message: "fictional statement timeout" },
    };

    const html = await render();

    expect(html).toContain("We couldn&#x27;t check this join link");
    expect(state.loaders).toEqual([]);
    expect(state.signInCards).toEqual([]);
  });

  test("a successful lookup with no organization keeps the invalid-code redirect", async () => {
    state.lookup = { data: null, error: null };

    await expect(load({ code: JOIN_CODE })).rejects.toThrow(
      "redirect:/organization?error=invalid-code",
    );
    expect(state.loaders).toEqual([]);
  });

  test("a missing code keeps its redirect and reads nothing", async () => {
    await expect(load({})).rejects.toThrow(/^redirect:\/organization$/);
    expect(state.authReads).toBe(0);
    expect(state.lookups).toEqual([]);
  });

  test("a signed-in visitor with a valid code still reaches the join step", async () => {
    const html = await render();

    expect(html).toContain("join-loader");
    expect(html).not.toContain('role="alert"');
    expect(state.loaders).toEqual([
      {
        organizationId: "organization-1",
        code: JOIN_CODE,
        userId: "viewer",
        organization,
      },
    ]);
    expect(state.lookups).toEqual([
      { table: "organizations", filter: ["join_code", JOIN_CODE] },
    ]);
  });

  test("a signed-out visitor with a valid code still gets the sign-in prompt", async () => {
    state.user = null;

    const html = await render();

    expect(html).toContain("join-sign-in-card");
    expect(html).not.toContain("join-loader");
    expect(state.signInCards).toEqual([{ organization, joinCode: JOIN_CODE }]);
    expect(state.loaders).toEqual([]);
  });
});
