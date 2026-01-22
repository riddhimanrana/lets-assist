/**
 * Tests for useAuth hook
 * @see hooks/useAuth.ts
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createMockUser } from "../factories";

// Mock functions - must be declared before vi.mock calls
const mockGetCachedUser = vi.fn();
const mockUpdateCachedUser = vi.fn();
const mockWaitForAuthReady = vi.fn();
const mockRefreshUser = vi.fn();
const mockSubscribeToCacheChanges = vi.fn();
const mockIsCacheInitialized = vi.fn();
const mockGetSession = vi.fn();

// Mock the auth context
vi.mock("@/utils/auth/auth-context", () => ({
  getCachedUser: () => mockGetCachedUser(),
  getOrFetchUser: () => mockGetCachedUser(),
  updateCachedUser: (user: unknown) => mockUpdateCachedUser(user),
  waitForAuthReady: () => mockWaitForAuthReady(),
  refreshUser: (client: unknown) => mockRefreshUser(client),
  subscribeToCacheChanges: (cb: unknown) => mockSubscribeToCacheChanges(cb),
  isCacheInitialized: () => mockIsCacheInitialized(),
}));

// Mock Supabase client
vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

// Import after mocks are set up
import { useAuth, useAuthRefresh, useAuthReady } from "@/hooks/useAuth";

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    mockGetCachedUser.mockReturnValue(null);
    mockIsCacheInitialized.mockReturnValue(false);
    mockSubscribeToCacheChanges.mockReturnValue(() => {});
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });
  
  describe("initial state", () => {
    it("returns loading state when cache is not initialized", async () => {
      mockIsCacheInitialized.mockReturnValue(false);
      mockGetCachedUser.mockReturnValue(null);
      
      const { result } = renderHook(() => useAuth());
      
      expect(result.current.isLoading).toBe(true);
      expect(result.current.user).toBeNull();
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
    
    it("returns cached user immediately if available", async () => {
      const mockUser = createMockUser({ email: "cached@example.com" });
      mockGetCachedUser.mockReturnValue(mockUser);
      mockIsCacheInitialized.mockReturnValue(true);
      
      const { result } = renderHook(() => useAuth());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
    });
    
    it("sets user from session if no cache", async () => {
      const mockUser = createMockUser({ email: "session@example.com" });
      
      mockIsCacheInitialized.mockReturnValue(false);
      mockGetCachedUser.mockReturnValue(null);
      mockGetSession.mockResolvedValue({
        data: { session: { user: mockUser } },
        error: null,
      });
      
      const { result } = renderHook(() => useAuth());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      
      expect(mockUpdateCachedUser).toHaveBeenCalledWith(mockUser);
    });
  });
  
  describe("error handling", () => {
    it("sets error state when session fetch fails", async () => {
      const sessionError = new Error("Session fetch failed");
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: sessionError,
      });
      
      const { result } = renderHook(() => useAuth());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toEqual(sessionError);
    });
  });
  
  describe("cache subscription", () => {
    it("subscribes to cache changes on mount", async () => {
      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockSubscribeToCacheChanges).toHaveBeenCalled();
    });
    
    it("unsubscribes on unmount", () => {
      const unsubscribe = vi.fn();
      mockSubscribeToCacheChanges.mockReturnValue(unsubscribe);
      
      const { unmount } = renderHook(() => useAuth());
      unmount();
      
      expect(unsubscribe).toHaveBeenCalled();
    });
    
    it("updates state when cache changes", async () => {
      let cacheCallback: ((user: unknown) => void) | null = null;
      mockSubscribeToCacheChanges.mockImplementation((cb) => {
        cacheCallback = cb;
        return () => {};
      });
      
      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      
      // Simulate cache update
      const newUser = createMockUser({ email: "new@example.com" });
      
      act(() => {
        cacheCallback?.(newUser);
      });
      
      expect(result.current.user).toEqual(newUser);
    });
  });
  
  describe("refresh functionality", () => {
    it("provides refresh method", async () => {
      mockIsCacheInitialized.mockReturnValue(true);
      mockRefreshUser.mockResolvedValue(undefined);
      
      const { result } = renderHook(() => useAuth());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      
      expect(typeof result.current.refresh).toBe("function");
    });
  });
});

describe("useAuthRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it("returns a refresh function", () => {
    const { result } = renderHook(() => useAuthRefresh());
    
    expect(typeof result.current).toBe("function");
  });
});

describe("useAuthReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitForAuthReady.mockResolvedValue(undefined);
  });
  
  it("returns a function that waits for auth ready", async () => {
    const { result } = renderHook(() => useAuthReady());
    
    expect(typeof result.current).toBe("function");
    
    await act(async () => {
      await result.current();
    });
    
    expect(mockWaitForAuthReady).toHaveBeenCalled();
  });
});
