/**
 * Test suite for staff invite handling in signup actions
 * Phase 3: Handle staff invite outcomes with structured responses
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { signInWithGoogle, signup } from '@/app/signup/actions';

// Mock Supabase client
const mockSignInWithOAuth = vi.fn();
const mockSignUp = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminUpdateUserById = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      signUp: mockSignUp,
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
    auth: {
      admin: {
        updateUserById: mockAdminUpdateUserById,
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [] },
          error: null,
        }),
      },
    },
  })),
}));

describe('signInWithGoogle - Staff Invite Flow (Phase 1)', () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com/';
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/oauth/...' },
      error: null,
    });
  });

  it('should include staff invite params in redirectTo when provided', async () => {
    const staffToken = 'test-staff-token-123';
    const orgUsername = 'test-org';
    const redirectAfterAuth = '/dashboard';

    await signInWithGoogle(redirectAfterAuth, { staffToken, orgUsername });

    const callArgs = mockSignInWithOAuth.mock.calls[0][0];
    const redirectTo = callArgs.options.redirectTo;

    const redirectUrl = new URL(redirectTo);
    expect(redirectUrl.origin).toBe('https://example.com');
    expect(redirectUrl.pathname).toBe('/auth/callback');
    expect(redirectUrl.searchParams.get('staffToken')).toBe('test-staff-token-123');
    expect(redirectUrl.searchParams.get('orgUsername')).toBe('test-org');
    expect(redirectUrl.searchParams.get('redirectAfterAuth')).toBe('/dashboard');
  });

  it('should omit invite params when not provided', async () => {
    await signInWithGoogle('/home', null);

    const callArgs = mockSignInWithOAuth.mock.calls[0][0];
    const redirectTo = callArgs.options.redirectTo;

    const redirectUrl = new URL(redirectTo);

    expect(redirectUrl.searchParams.get('staffToken')).toBeNull();
    expect(redirectUrl.searchParams.get('orgUsername')).toBeNull();
    expect(redirectUrl.searchParams.get('redirectAfterAuth')).toBe('/home');
  });

  it('should handle null redirectAfterAuth with staff invite', async () => {
    const staffToken = 'token-456';
    const orgUsername = 'another-org';

    await signInWithGoogle(null, { staffToken, orgUsername });

    const callArgs = mockSignInWithOAuth.mock.calls[0][0];
    const redirectTo = callArgs.options.redirectTo;

    const redirectUrl = new URL(redirectTo);

    expect(redirectUrl.searchParams.get('staffToken')).toBe('token-456');
    expect(redirectUrl.searchParams.get('orgUsername')).toBe('another-org');
    expect(redirectUrl.searchParams.get('redirectAfterAuth')).toBeNull();
  });

  it('should preserve backward compatibility for simple invocation', async () => {
    await signInWithGoogle(null, null);

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile',
        },
        redirectTo: expect.stringMatching(/\/auth\/callback$/),
      },
    });

    const callArgs = mockSignInWithOAuth.mock.calls[0][0];
    const redirectTo = callArgs.options.redirectTo;

    expect(redirectTo).toBe('https://example.com/auth/callback');
  });

  afterAll(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      return;
    }

    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });
});

describe('signup - Staff Invite Outcomes (Phase 3)', () => {
  const originalE2EMode = process.env.E2E_TEST_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.E2E_TEST_MODE = 'false';
  });

  afterAll(() => {
    process.env.E2E_TEST_MODE = originalE2EMode;
  });

  it('should return success outcome when staff invite is processed successfully', async () => {
    const userId = 'user-123';
    const orgId = 'org-456';

    // Mock successful signup
    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    // Mock successful org lookup
    const mockOrgSelect = vi.fn().mockReturnThis();
    const mockOrgEq = vi.fn().mockReturnThis();
    const mockOrgSingle = vi.fn().mockResolvedValue({
      data: {
        id: orgId,
        staff_join_token: 'valid-token',
        staff_join_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      error: null,
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          select: mockOrgSelect,
        };
      }
      if (table === 'organization_members') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    mockOrgSelect.mockReturnValue({
      eq: mockOrgEq,
    });

    mockOrgEq.mockReturnValue({
      single: mockOrgSingle,
    });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');
    formData.append('staffToken', 'valid-token');
    formData.append('orgUsername', 'test-org');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome).toEqual({
      status: 'success',
      orgUsername: 'test-org',
    });
  });

  it('should return invalid_token outcome when token does not match', async () => {
    const userId = 'user-123';

    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    const mockOrgSelect = vi.fn().mockReturnThis();
    const mockOrgEq = vi.fn().mockReturnThis();
    const mockOrgSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'org-456',
        staff_join_token: 'different-token',
        staff_join_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      error: null,
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return { select: mockOrgSelect };
      }
      return {};
    });

    mockOrgSelect.mockReturnValue({ eq: mockOrgEq });
    mockOrgEq.mockReturnValue({ single: mockOrgSingle });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');
    formData.append('staffToken', 'wrong-token');
    formData.append('orgUsername', 'test-org');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome).toEqual({
      status: 'invalid_token',
      orgUsername: 'test-org',
    });
  });

  it('should return expired_token outcome when token has expired', async () => {
    const userId = 'user-123';

    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    const mockOrgSelect = vi.fn().mockReturnThis();
    const mockOrgEq = vi.fn().mockReturnThis();
    const mockOrgSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'org-456',
        staff_join_token: 'valid-token',
        staff_join_token_expires_at: new Date(Date.now() - 86400000).toISOString(), // expired
      },
      error: null,
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return { select: mockOrgSelect };
      }
      return {};
    });

    mockOrgSelect.mockReturnValue({ eq: mockOrgEq });
    mockOrgEq.mockReturnValue({ single: mockOrgSingle });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');
    formData.append('staffToken', 'valid-token');
    formData.append('orgUsername', 'test-org');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome).toEqual({
      status: 'expired_token',
      orgUsername: 'test-org',
    });
  });

  it('should return org_not_found outcome when organization does not exist', async () => {
    const userId = 'user-123';

    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    const mockOrgSelect = vi.fn().mockReturnThis();
    const mockOrgEq = vi.fn().mockReturnThis();
    const mockOrgSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return { select: mockOrgSelect };
      }
      return {};
    });

    mockOrgSelect.mockReturnValue({ eq: mockOrgEq });
    mockOrgEq.mockReturnValue({ single: mockOrgSingle });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');
    formData.append('staffToken', 'some-token');
    formData.append('orgUsername', 'nonexistent-org');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome).toEqual({
      status: 'org_not_found',
      orgUsername: 'nonexistent-org',
    });
  });

  it('should return error outcome when processing throws an exception', async () => {
    const userId = 'user-123';

    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    mockAdminFrom.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');
    formData.append('staffToken', 'some-token');
    formData.append('orgUsername', 'test-org');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome?.status).toBe('error');
  });

  it('should not include inviteOutcome when no staff params provided', async () => {
    const userId = 'user-123';

    mockSignUp.mockResolvedValue({
      data: { user: { id: userId, email: 'test@example.com' } },
      error: null,
    });

    const formData = new FormData();
    formData.append('fullName', 'Test User');
    formData.append('email', 'test@example.com');
    formData.append('password', 'password123');

    const result = await signup(formData);

    expect(result.success).toBe(true);
    expect(result.inviteOutcome).toBeUndefined();
  });
});
