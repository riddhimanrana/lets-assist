/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getOrganizerSignupsWithWaiverStatus } from '@/app/projects/[id]/signups/actions';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { getAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-helpers', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

describe('getOrganizerSignupsWithWaiverStatus', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns Unauthorized when no user is logged in', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ user: null } as any);
    vi.mocked(createClient).mockResolvedValue({} as any);
    vi.mocked(getAdminClient).mockReturnValue({} as any);

    const result = await getOrganizerSignupsWithWaiverStatus('project-1');

    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('returns signups for project creator (admin client, RLS-safe)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ user: { id: 'user-1' } } as any);

    // user-scoped client is only needed for org check (skipped when creator)
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn(),
    } as any);

    const adminFrom = vi.fn((table: string) => {
      const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        order: vi.fn(),
      };

      if (table === 'projects') {
        q.maybeSingle.mockResolvedValue({
          data: { id: 'project-1', creator_id: 'user-1', organization_id: null },
          error: null,
        });
      }

      if (table === 'project_signups') {
        q.order.mockResolvedValue({
          data: [
            {
              id: 'signup-1',
              created_at: '2026-02-01T00:00:00Z',
              status: 'approved',
              user_id: 'user-2',
              anonymous_id: null,
              schedule_id: 'oneTime',
              waiver_signature: [{ id: 'sig-1' }],
              profile: { full_name: 'Jane Doe', username: 'jane', email: 'jane@example.com' },
              anonymous_signup: null,
            },
          ],
          error: null,
        });
      }

      return q;
    });

    vi.mocked(getAdminClient).mockReturnValue({ from: adminFrom } as any);

    const result: any = await getOrganizerSignupsWithWaiverStatus('project-1');

    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.signups)).toBe(true);
    expect(result.signups[0].id).toBe('signup-1');
  });
});
