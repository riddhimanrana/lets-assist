type SupabaseResult<T> = Promise<{ data: T; error: null; count: number | null }>;

const mockUser = {
  id: "e2e-user",
  email: "e2e@example.com",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
};

const tableData: Record<string, Record<string, unknown>[]> = {
  profiles: [
    {
      id: mockUser.id,
      trusted_member: true,
      profile_image_url: null,
    },
  ],
  trusted_member: [
    {
      id: mockUser.id,
      status: true,
    },
  ],
  organization_members: [],
  project_drafts: [],
  organizations: [
    {
      id: "org-1",
      username: "test-org",
      name: "Test Org",
      staff_join_token: "staff-token",
      staff_join_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  ],
};

const resolved = <T,>(data: T): SupabaseResult<T> =>
  Promise.resolve({
    data,
    error: null,
    count: Array.isArray(data) ? data.length : null,
  });

const generateId = () =>
  (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(36).slice(2, 12)}`);

type MockQueryBuilder = {
  select: () => MockQueryBuilder;
  insert: (payload?: Record<string, unknown> | Record<string, unknown>[]) => MockQueryBuilder;
  upsert: (payload?: Record<string, unknown> | Record<string, unknown>[]) => MockQueryBuilder;
  update: () => MockQueryBuilder;
  delete: () => MockQueryBuilder;
  eq: () => MockQueryBuilder;
  not: () => MockQueryBuilder;
  neq: () => MockQueryBuilder;
  gte: () => MockQueryBuilder;
  lt: () => MockQueryBuilder;
  lte: () => MockQueryBuilder;
  or: () => MockQueryBuilder;
  range: () => MockQueryBuilder;
  in: () => MockQueryBuilder;
  order: () => MockQueryBuilder;
  limit: () => MockQueryBuilder;
  single: () => SupabaseResult<Record<string, unknown> | null>;
  maybeSingle: () => SupabaseResult<Record<string, unknown> | null>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  returns: <T>() => MockQueryBuilder;
  then: SupabaseResult<Record<string, unknown>[]>["then"];
};

const createQueryBuilder = (table: string): MockQueryBuilder => {
  let currentRows = tableData[table] ? [...tableData[table]] : [];

  const builder: MockQueryBuilder = {
    select: () => builder,
    insert: (payload?: Record<string, unknown> | Record<string, unknown>[]) => {
      if (payload !== undefined) {
        const normalized = Array.isArray(payload) ? payload : [payload];
        currentRows = normalized;
      }
      return builder;
    },
    upsert: (payload?: Record<string, unknown> | Record<string, unknown>[]) => {
      if (payload !== undefined) {
        const normalized = Array.isArray(payload) ? payload : [payload];
        currentRows = normalized;
      }
      return builder;
    },
    update: () => builder,
    delete: () => {
      currentRows = [];
      return builder;
    },
    eq: () => builder,
    not: () => builder,
    neq: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    or: () => builder,
    range: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => resolved(currentRows[0] ?? null),
    maybeSingle: async () => resolved(currentRows[0] ?? null),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    returns: <T>() => builder,
    then: (onfulfilled, onrejected) => resolved(currentRows).then(onfulfilled, onrejected),
  };

  return builder;
};

export const createMockSupabaseClient = () => {
  const auth = {
    getUser: async () => resolved<{ user: typeof mockUser | null }>({ user: mockUser }),
        getSession: async () =>
          resolved<{ session: { user: typeof mockUser, access_token: string, refresh_token: string } | null }>({
            session: { user: mockUser, access_token: "mock-access-token", refresh_token: "mock-refresh-token" },
      }),
    signUp: async ({ email }: { email?: string }) =>
      resolved({ user: { ...mockUser, email: email ?? mockUser.email } }),
    signInWithPassword: async () =>
      resolved({
        user: mockUser,
        session: {
          user: mockUser,
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
        },
      }),
    resetPasswordForEmail: async () => resolved({}),
    signInWithOAuth: async () => resolved({ url: "https://example.com/oauth" }),
    updateUser: async () => resolved({ user: mockUser }),
    signOut: async () => resolved(null),
    resend: async () => resolved({}),
    getUserIdentities: async () => resolved({ identities: [] }),
    linkIdentity: async () => resolved({ user: mockUser, identity: null }),
    unlinkIdentity: async () => resolved({ user: mockUser, identities: [] }),
    setSession: async () =>
      resolved({
        session: {
          user: mockUser,
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
        },
        user: mockUser,
      }),
    exchangeCodeForSession: async () =>
      resolved({
        session: {
          user: mockUser,
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
        },
        user: mockUser,
      }),
    verifyOtp: async () =>
      resolved({
        user: mockUser,
        session: {
          user: mockUser,
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
        },
      }),
    onAuthStateChange: (callback: (event: string, session: { user: typeof mockUser } | null) => void) => {
      callback("INITIAL_SESSION", { user: mockUser });
      return { data: { subscription: { unsubscribe() {} } } };
    },
    admin: {
      listUsers: async () =>
        resolved<{ users: Array<{ id: string; email: string }> }>({
          users: [
            {
              id: mockUser.id,
              email: mockUser.email,
            },
          ],
        }),
      updateUserById: async () => resolved({ user: mockUser }),
    },
  };

  return {
    auth,
    from: (table: string) => createQueryBuilder(table),
    rpc: async () => resolved(null),
    channel: () => ({
      on: (..._args: unknown[]) => ({
        subscribe: async () => ({ data: { subscription: { unsubscribe() {} } } }),
      }),
      subscribe: async () => ({ data: { subscription: { unsubscribe() {} } } }),
    }),
    removeChannel: async () => ({ data: { subscription: { unsubscribe() {} } } }),
    storage: {
      from: () => ({
        upload: async () => resolved({ path: `mock/${generateId()}` }),
        remove: async () => resolved({}),
         list: async () => resolved([]),
        createSignedUrl: async (path: string) =>
          resolved({ signedUrl: `https://example.com/${path}` }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/${path}` } }),
      }),
    },
    functions: {
      invoke: async () => resolved({}),
    },
  };
};

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;
export const mockSupabaseUser = mockUser;
