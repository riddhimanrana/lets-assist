/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getActiveGlobalTemplate } from '@/app/admin/waivers/actions';
import { getAdminClient } from '@/lib/supabase/admin';

// Mock the admin client
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

describe('getActiveGlobalTemplate', () => {
  let mockSupabase: ReturnType<typeof getAdminClient>;

  beforeEach(() => {
    const mockQuery = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabase = mockQuery as unknown as ReturnType<typeof getAdminClient>;

    vi.mocked(getAdminClient).mockReturnValue(mockSupabase);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when no active global template exists', async () => {
    (mockSupabase as any).maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getActiveGlobalTemplate();

    expect(result).toBeNull();
  });

  it('should return the active global template when one exists', async () => {
    const mockTemplate = {
      id: 'global-1',
      scope: 'global',
      project_id: null,
      title: 'Global Waiver',
      version: 1,
      active: true,
      pdf_storage_path: '/path/to/waiver.pdf',
      pdf_public_url: 'https://example.com/waiver.pdf',
      source: 'global_pdf',
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      signers: [],
      fields: [],
    };

    (mockSupabase as any).maybeSingle.mockResolvedValue({
      data: mockTemplate,
      error: null,
    });

    const result = await getActiveGlobalTemplate();

    expect(result).toEqual(mockTemplate);
  });

  it('should handle multiple active global templates by returning the most recent one', async () => {
    const newerTemplate = {
      id: 'global-2',
      scope: 'global',
      project_id: null,
      title: 'New Global Waiver',
      version: 2,
      active: true,
      pdf_storage_path: '/path/to/new-waiver.pdf',
      pdf_public_url: 'https://example.com/new-waiver.pdf',
      source: 'global_pdf',
      created_by: 'admin-1',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      signers: [],
      fields: [],
    };

    (mockSupabase as any).maybeSingle.mockResolvedValue({
      data: newerTemplate,
      error: null,
    });

    const result = await getActiveGlobalTemplate();

    expect(result).toEqual(newerTemplate);
  });

  it('should order by created_at DESC when selecting from multiple active templates', async () => {
    const newerTemplate = {
      id: 'global-2',
      scope: 'global',
      project_id: null,
      title: 'New Global Waiver',
      version: 2,
      active: true,
      pdf_storage_path: '/path/to/new-waiver.pdf',
      pdf_public_url: 'https://example.com/new-waiver.pdf',
      source: 'global_pdf',
      created_by: 'admin-1',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      signers: [],
      fields: [],
    };

    (mockSupabase as any).maybeSingle.mockResolvedValue({
      data: newerTemplate,
      error: null,
    });

    await getActiveGlobalTemplate();

    expect((mockSupabase as any).order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect((mockSupabase as any).order).toHaveBeenCalledWith('id', { ascending: false });
    expect((mockSupabase as any).limit).toHaveBeenCalledWith(1);
  });
});
