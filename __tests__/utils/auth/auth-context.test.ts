/**
 * Unit Tests for Auth Context
 * 
 * Tests promise deduplication, caching, and auth state management
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  getOrFetchUser,
  getCachedUser,
  clearAuthCache,
  refreshUser,
  updateCachedUser,
  initAuthContext,
  isAuthenticatedCached,
  getAuthMetrics,
  waitForAuthReady,
} from '@/utils/auth/auth-context';

// Mock user for testing
const mockUser: User = {
  id: 'test-user-123',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'test@example.com',
  email_confirmed_at: new Date().toISOString(),
  phone: '',
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  app_metadata: {},
  user_metadata: {},
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as User;

// Mock Supabase client
const createMockSupabaseClient = (userToReturn: User | null = mockUser) => {
  let callCount = 0;

  return {
    auth: {
      getUser: vi.fn(async () => {
        callCount++;
        // Simulate small delay like real API
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: { user: userToReturn }, error: null };
      }),
      onAuthStateChange: vi.fn(() => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      })),
    },
    getCallCount: () => callCount,
    resetCallCount: () => {
      callCount = 0;
    },
  } as unknown as SupabaseClient;
};

describe('Auth Context', () => {
  beforeEach(() => {
    // Clear cache before each test
    initAuthContext();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrFetchUser', () => {
    it('should fetch user from Supabase on first call', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      const user = await getOrFetchUser(supabase);

      expect(user).toEqual(mockUser);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });

    it('should cache user after first fetch', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      const cached = getCachedUser();

      expect(cached).toEqual(mockUser);
    });

    it('should deduplicate concurrent calls', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      // Make 5 concurrent calls
      const promises = Array(5)
        .fill(null)
        .map(() => getOrFetchUser(supabase));

      const results = await Promise.all(promises);

      // All should get the same user
      results.forEach((user) => {
        expect(user).toEqual(mockUser);
      });

      // But only 1 API call should have been made
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });

    it('should return null when user is not authenticated', async () => {
      const supabase = createMockSupabaseClient(null);

      const user = await getOrFetchUser(supabase);

      expect(user).toBeNull();
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      const supabase = {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
            error: new Error('Network error'),
          })),
        },
      } as unknown as SupabaseClient;

      const user = await getOrFetchUser(supabase);

      expect(user).toBeNull();
    });

    it('should cache user data', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      const cachedUser1 = getCachedUser();

      // Make another call
      await getOrFetchUser(supabase);
      const cachedUser2 = getCachedUser();

      expect(cachedUser1).toEqual(cachedUser2);
    });
  });

  describe('getCachedUser', () => {
    it('should return null if no user has been fetched', () => {
      const cached = getCachedUser();
      expect(cached).toBeNull();
    });

    it('should return cached user if one exists', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      const cached = getCachedUser();

      expect(cached).toEqual(mockUser);
    });

    it('should return cached user without making API call', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);

      // Call getCachedUser multiple times
      getCachedUser();
      getCachedUser();
      getCachedUser();

      // No additional API calls
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('isAuthenticatedCached', () => {
    it('should return false when no user is cached', () => {
      expect(isAuthenticatedCached()).toBe(false);
    });

    it('should return true when user is cached', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);

      expect(isAuthenticatedCached()).toBe(true);
    });

    it('should return false when user is explicitly null', async () => {
      const supabase = createMockSupabaseClient(null);

      await getOrFetchUser(supabase);

      expect(isAuthenticatedCached()).toBe(false);
    });
  });

  describe('clearAuthCache', () => {
    it('should clear cached user', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      expect(getCachedUser()).toEqual(mockUser);

      clearAuthCache();
      expect(getCachedUser()).toBeNull();
    });

    it('should clear authentication status', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      expect(isAuthenticatedCached()).toBe(true);

      clearAuthCache();
      expect(isAuthenticatedCached()).toBe(false);
    });

    it('should allow fresh fetch after clear', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      clearAuthCache();
      const user = await getOrFetchUser(supabase);

      expect(user).toEqual(mockUser);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshUser', () => {
    it('should force fetch fresh user data', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);

      const refreshedUser = await refreshUser(supabase);

      expect(refreshedUser).toEqual(mockUser);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
    });

    it('should update cache with fresh data', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      const oldCached = getCachedUser();

      await refreshUser(supabase);
      const newCached = getCachedUser();

      expect(oldCached).toEqual(newCached);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateCachedUser', () => {
    it('should update cached user', () => {
      updateCachedUser(mockUser);

      expect(getCachedUser()).toEqual(mockUser);
    });

    it('should clear cache when passed null', () => {
      updateCachedUser(mockUser);
      expect(isAuthenticatedCached()).toBe(true);

      updateCachedUser(null);
      expect(isAuthenticatedCached()).toBe(false);
    });
  });

  describe('Promise Deduplication Scenarios', () => {
    it('should handle multiple rapid concurrent calls', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      // Simulate rapid-fire calls like multiple components mounting
      const calls = Promise.all([
        getOrFetchUser(supabase),
        getOrFetchUser(supabase),
        getOrFetchUser(supabase),
        getOrFetchUser(supabase),
        getOrFetchUser(supabase),
      ]);

      const results = await calls;

      // All should succeed
      results.forEach((user) => {
        expect(user).toEqual(mockUser);
      });

      // But only 1 API call
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate within same event loop', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      const user1 = getOrFetchUser(supabase);
      const user2 = getOrFetchUser(supabase);
      const user3 = getOrFetchUser(supabase);

      const [u1, u2, u3] = await Promise.all([user1, user2, user3]);

      expect(u1).toEqual(mockUser);
      expect(u2).toEqual(mockUser);
      expect(u3).toEqual(mockUser);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });

    it('should allow new fetch after previous completes', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);

      // Small delay to ensure promise completes
      await new Promise((resolve) => setTimeout(resolve, 50));

      // New call should trigger new fetch
      await getOrFetchUser(supabase);
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
    });

    it('should still deduplicate if concurrent calls happen before first completes', async () => {
      let resolveGetUser: (() => void) | null = null;
      const supabase = {
        auth: {
          getUser: vi.fn(async () => {
            await new Promise<void>((resolve) => {
              resolveGetUser = resolve;
            });
            return { data: { user: mockUser }, error: null };
          }),
        },
      } as unknown as SupabaseClient;

      // Start first call
      const promise1 = getOrFetchUser(supabase);

      // Start second call before first resolves
      const promise2 = getOrFetchUser(supabase);

      // Both should be the same promise
      expect(promise1 === promise2).toBe(false); // Different promise objects, but same underlying promise

      // Resolve the pending call
      resolveGetUser?.();

      const [user1, user2] = await Promise.all([promise1, promise2]);

      expect(user1).toEqual(mockUser);
      expect(user2).toEqual(mockUser);

      // Only 1 API call made
      expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAuthMetrics', () => {
    it('should return metrics when user is cached', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      await getOrFetchUser(supabase);
      const metrics = getAuthMetrics();

      expect(metrics.cachedUserId).toBe('test-user-123');
      expect(metrics.cachedUserEmail).toBe('test@example.com');
      expect(metrics.lastFetchTimestamp).toBeGreaterThan(0);
      expect(metrics.hasPendingPromise).toBe(false);
      expect(metrics.lastError).toBeNull();
    });

    it('should report pending promise when fetch in flight', () => {
      const supabase = {
        auth: {
          getUser: vi.fn(
            () =>
              new Promise((resolve) => {
                // Never resolves, keeps promise pending
                setTimeout(resolve, 999999);
              })
          ),
        },
      } as unknown as SupabaseClient;

      // Don't await, keep promise in-flight
      void getOrFetchUser(supabase);

      const metrics = getAuthMetrics();

      expect(metrics.hasPendingPromise).toBe(true);
    });
  });

  describe('waitForAuthReady', () => {
    it('should resolve immediately if no pending fetch', async () => {
      const start = Date.now();
      await waitForAuthReady();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Should be near instant
    });

    it('should wait for pending fetch to complete', async () => {
      const supabase = createMockSupabaseClient(mockUser);

      // Start fetch but don't await
      void getOrFetchUser(supabase);

      // Wait should block until fetch completes
      await waitForAuthReady();

      // Now we should have cached user
      expect(getCachedUser()).toEqual(mockUser);
    });
  });
});
