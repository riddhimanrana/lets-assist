type SupabaseResult<T> = Promise<{ data: T; error: null }>;

const mockUser = {
  id: "e2e-user",
  email: "e2e@example.com",
};

const tableData: Record<string, any[]> = {
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
  Promise.resolve({ data, error: null });

const generateId = () =>
  (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(36).slice(2, 12)}`);

const createQueryBuilder = (table: string) => {
  let currentRows = tableData[table] ? [...tableData[table]] : [];

  const builder: any = {
    select: () => builder,
    insert: (payload?: any) => {
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
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => resolved(currentRows[0] ?? null),
    maybeSingle: async () => resolved(currentRows[0] ?? null),
    returns: () => builder,
  };

  return builder;
};

export const createMockSupabaseClient = () => {
  const auth = {
    getUser: async () => resolved<{ user: typeof mockUser | null }>({ user: mockUser }),
    getSession: async () =>
      resolved<{ session: { user: typeof mockUser } | null }>({
        session: { user: mockUser },
      }),
    signUp: async ({ email }: { email?: string }) =>
      resolved({ user: { ...mockUser, email: email ?? mockUser.email } }),
    signInWithPassword: async () =>
      resolved({ user: mockUser, session: { user: mockUser } }),
    signOut: async () => resolved(null),
    onAuthStateChange: (callback: any) => {
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
    },
  };

  return {
    auth,
    from: (table: string) => createQueryBuilder(table),
    rpc: async () => resolved(null),
    channel: () => ({
      on: () => ({ subscribe: async () => ({ data: { subscription: { unsubscribe() {} } } }) }),
      subscribe: async () => ({ data: { subscription: { unsubscribe() {} } } }),
    }),
    storage: {
      from: () => ({
        upload: async () => resolved({ path: `mock/${generateId()}` }),
        remove: async () => resolved({}),
        createSignedUrl: async (path: string) =>
          resolved({ signedUrl: `https://example.com/${path}` }),
      }),
    },
    functions: {
      invoke: async () => resolved({}),
    },
  } as any;
};

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;
export const mockSupabaseUser = mockUser;
