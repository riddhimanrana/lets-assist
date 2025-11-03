/**
 * Integration Tests for useAuth Hook
 * 
 * Tests hook behavior, state management, and integration with auth context
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';
import * as authContext from '@/utils/auth/auth-context';
import { createClient } from '@/utils/supabase/client';

// Mock the auth context
vi.mock('@/utils/auth/auth-context', () => ({
  getOrFetchUser: vi.fn(),
  getCachedUser: vi.fn(),
  clearAuthCache: vi.fn(),
  refreshUser: vi.fn(),
  updateCachedUser: vi.fn(),
  initAuthContext: vi.fn(),
  isAuthenticatedCached: vi.fn(),
  getAuthMetrics: vi.fn(),
  waitForAuthReady: vi.fn(),
}));

// Mock Supabase client
vi.mock('@/utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      })),
    },
  })),
}));

const mockUser = {
  id: 'test-user-123',
  email: 'test@example.com',
  user_metadata: {
    full_name: 'Test User',
  },
} as any;

describe('useAuth Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset cache mock to return undefined (no cached user initially)
    vi.mocked(authContext.getCachedUser).mockReturnValue(undefined as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with loading state', async () => {
    // Mock getOrFetchUser to never resolve
    vi.mocked(authContext.getOrFetchUser).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => useAuth());

    // Initially should be loading since no cache
    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('should load user from context', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isError).toBe(false);
  });

  it('should handle auth errors', async () => {
    const testError = new Error('Auth failed');
    vi.mocked(authContext.getOrFetchUser).mockRejectedValue(testError);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(testError);
    expect(result.current.user).toBeNull();
  });

  it('should update user on auth state change', async () => {
    let authStateChangeListener: ((event: string, session: any) => void) | null = null;

    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(),
        onAuthStateChange: vi.fn((callback: any) => {
          authStateChangeListener = callback;
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(),
              },
            },
          };
        }),
      },
    } as any);

    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);
    vi.mocked(authContext.getCachedUser).mockReturnValue(mockUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Simulate auth state change
    const updatedUser = { ...mockUser, email: 'updated@example.com' };
    act(() => {
      authStateChangeListener?.('USER_UPDATED', { user: updatedUser });
    });

    vi.mocked(authContext.getCachedUser).mockReturnValue(updatedUser);

    await waitFor(() => {
      expect(result.current.user?.email).toBe('updated@example.com');
    });
  });

  it('should cleanup subscription on unmount', async () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(),
        onAuthStateChange: vi.fn(() => ({
          data: {
            subscription: {
              unsubscribe: unsubscribeMock,
            },
          },
        })),
      },
    } as any);

    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);

    const { unmount } = renderHook(() => useAuth());

    // Give the hook time to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    unmount();

    // Subscription unsubscribe should be called on unmount
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('should provide isAuthenticated getter', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);
    vi.mocked(authContext.getCachedUser).mockReturnValue(mockUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should return false for isAuthenticated when no user', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(null);
    vi.mocked(authContext.getCachedUser).mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should provide refresh function', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);
    vi.mocked(authContext.refreshUser).mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    if (result.current.refresh) {
      await act(async () => {
        await result.current.refresh!();
      });
    }

    expect(authContext.refreshUser).toHaveBeenCalled();
  });

  it('should handle null user (logged out state)', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(null);
    vi.mocked(authContext.getCachedUser).mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should preserve auth state across re-renders', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);
    vi.mocked(authContext.getCachedUser).mockReturnValue(mockUser);

    const { result, rerender } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const firstUser = result.current.user;

    rerender();

    expect(result.current.user).toBe(firstUser);
  });

  it('should handle rapid auth state changes', async () => {
    let authStateChangeListener: ((event: string, session: any) => void) | null = null;

    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(),
        onAuthStateChange: vi.fn((callback: any) => {
          authStateChangeListener = callback;
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(),
              },
            },
          };
        }),
      },
    } as any);

    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);
    vi.mocked(authContext.getCachedUser).mockReturnValue(mockUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Simulate multiple rapid state changes
    act(() => {
      authStateChangeListener?.('USER_UPDATED', { user: { ...mockUser, email: 'first@example.com' } });
      authStateChangeListener?.('USER_UPDATED', { user: { ...mockUser, email: 'second@example.com' } });
      authStateChangeListener?.('USER_UPDATED', { user: { ...mockUser, email: 'third@example.com' } });
    });

    // Should handle all without errors
    expect(result.current).toBeDefined();
  });

  it('should support concurrent hook usage', async () => {
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);

    const { result: result1 } = renderHook(() => useAuth());
    const { result: result2 } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result1.current.isLoading).toBe(false);
    });

    // Both should eventually load
    expect(result1.current).toBeDefined();
    expect(result2.current).toBeDefined();
  });

  it('should provide error getter', async () => {
    const testError = new Error('Test error');
    vi.mocked(authContext.getOrFetchUser).mockRejectedValue(testError);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    // Check that error is accessible
    expect(result.current.error?.message).toBe('Test error');
  });

  it('should set user from cached value', async () => {
    // First call returns mockUser from cache
    vi.mocked(authContext.getCachedUser).mockReturnValue(mockUser);
    vi.mocked(authContext.getOrFetchUser).mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth());

    // Should use cached value immediately
    expect(authContext.getCachedUser).toHaveBeenCalled();
  });
});
