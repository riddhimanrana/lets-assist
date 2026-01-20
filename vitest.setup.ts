import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// Set up test environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ENCRYPTION_KEY = "test-encryption-key-must-be-32-chars!";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.PROJECT_CANCELLATION_WORKER_ENABLED = "false";
process.env.RESEND_API_KEY = "re_test_123456789"; // Mock Resend API key

// Mock fetch globally
global.fetch = vi.fn();

// Mock console methods to reduce noise in tests (optional - uncomment if needed)
// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn) => fn),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
