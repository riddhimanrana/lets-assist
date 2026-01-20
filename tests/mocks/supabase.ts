/**
 * Tests for Supabase client mock utilities
 * Provides reusable mock implementations for testing code that uses Supabase
 */

import { vi } from "vitest";
import type { MockSupabaseResponse } from "../factories";

export interface MockSupabaseClient {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    signInWithPassword: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
}

/**
 * Creates a full Supabase client mock with chainable query builder
 */
export function createMockSupabaseClient(
  overrides: Partial<{
    user: unknown;
    session: unknown;
    queryResults: Record<string, MockSupabaseResponse<unknown>>;
  }> = {}
): MockSupabaseClient {
  const { user = null, session = null, queryResults = {} } = overrides;
  
  // Create chainable query builder
  const createQueryBuilder = (tableName: string) => {
    const result = queryResults[tableName] ?? { data: null, error: null };
    
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    
    const chainableMethods = [
      "select", "insert", "update", "delete", "upsert",
      "eq", "neq", "gt", "gte", "lt", "lte",
      "like", "ilike", "is", "in", "contains",
      "filter", "match", "not", "or", "and",
      "order", "limit", "range", "offset", "textSearch",
    ];
    
    chainableMethods.forEach((method) => {
      builder[method] = vi.fn().mockReturnValue(builder);
    });
    
    // Terminal methods
    builder.single = vi.fn().mockResolvedValue(result);
    builder.maybeSingle = vi.fn().mockResolvedValue(result);
    builder.count = vi.fn().mockResolvedValue({ count: 0, error: null });
    
    // Make thenable for direct await
    builder.then = vi.fn((resolve) => {
      resolve(result);
      return Promise.resolve(result);
    });
    
    return builder;
  };
  
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session },
        error: null,
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user, session },
        error: null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn((tableName: string) => createQueryBuilder(tableName)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: "test/path" }, error: null }),
        download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://test.com/file" } }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://test.com/signed" }, error: null }),
      }),
    },
  };
}

/**
 * Creates mock for @/utils/supabase/server createClient
 */
export function mockSupabaseServer(client: MockSupabaseClient) {
  return {
    createClient: vi.fn().mockResolvedValue(client),
  };
}

/**
 * Creates mock for @/utils/supabase/client createClient
 */
export function mockSupabaseClient(client: MockSupabaseClient) {
  return {
    createClient: vi.fn().mockReturnValue(client),
  };
}

/**
 * Creates mock for @/utils/supabase/service-role getServiceRoleClient
 */
export function mockSupabaseServiceRole(client: MockSupabaseClient) {
  return {
    getServiceRoleClient: vi.fn().mockReturnValue(client),
  };
}

/**
 * Helper to set up common Supabase mocks for a test file
 */
export function setupSupabaseMocks(options: {
  user?: unknown;
  session?: unknown;
  queryResults?: Record<string, MockSupabaseResponse<unknown>>;
} = {}) {
  const mockClient = createMockSupabaseClient(options);
  
  vi.mock("@/utils/supabase/server", () => mockSupabaseServer(mockClient));
  vi.mock("@/utils/supabase/client", () => mockSupabaseClient(mockClient));
  vi.mock("@/utils/supabase/service-role", () => mockSupabaseServiceRole(mockClient));
  
  return mockClient;
}
