/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProjectWaiver } from '@/app/projects/[id]/actions';
import { getAdminClient } from '@/lib/supabase/admin';
import { getActiveGlobalTemplate } from '@/app/admin/waivers/actions';

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

vi.mock('@/app/admin/waivers/actions', () => ({
  getActiveGlobalTemplate: vi.fn(),
}));

describe('getProjectWaiver (definition/global fallback)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to active global waiver definition when project has no waiver', async () => {
    const projectRow = {
      waiver_required: true,
      waiver_allow_upload: true,
      waiver_disable_esignature: false,
      waiver_pdf_url: null,
      waiver_pdf_storage_path: null,
      waiver_definition_id: null,
    };

    const globalDefinition = {
      id: 'global-1',
      scope: 'global',
      project_id: null,
      title: 'Global Waiver',
      version: 1,
      active: true,
      pdf_storage_path: 'global/path.pdf',
      pdf_public_url: 'https://example.com/global.pdf',
      source: 'global_pdf',
      created_by: null,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      signers: [],
      fields: [],
    };

    const from = vi.fn((table: string) => {
      const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
      };

      if (table === 'projects') {
        q.maybeSingle.mockResolvedValue({ data: projectRow, error: null });
      }

      return q;
    });

    vi.mocked(getAdminClient).mockReturnValue({ from } as any);
    vi.mocked(getActiveGlobalTemplate).mockResolvedValue(globalDefinition as any);

    const result: any = await getProjectWaiver('project-1');

    expect(result.error).toBeUndefined();
    expect(result.definition?.id).toBe('global-1');
    expect(result.waiverConfig?.isProjectSpecific).toBe(false);
    expect(result.waiverConfig?.isWaiverDefinition).toBe(true);
    expect(result.waiverConfig?.waiverPdfUrl).toBe('https://example.com/global.pdf');
  });

  it('uses project-specific waiver definition when waiver_definition_id is set', async () => {
    const projectRow = {
      waiver_required: true,
      waiver_allow_upload: true,
      waiver_disable_esignature: false,
      waiver_pdf_url: null,
      waiver_pdf_storage_path: null,
      waiver_definition_id: 'def-123',
    };

    const projectDefinition = {
      id: 'def-123',
      pdf_public_url: 'https://example.com/project-def.pdf',
      pdf_storage_path: 'project/def.pdf',
      signers: [],
      fields: [],
    };

    const from = vi.fn((table: string) => {
      const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
      };

      if (table === 'projects') {
        q.maybeSingle.mockResolvedValue({ data: projectRow, error: null });
      }

      if (table === 'waiver_definitions') {
        q.single.mockResolvedValue({ data: projectDefinition, error: null });
      }

      return q;
    });

    vi.mocked(getAdminClient).mockReturnValue({ from } as any);
    vi.mocked(getActiveGlobalTemplate).mockResolvedValue(null as any);

    const result: any = await getProjectWaiver('project-1');

    expect(result.error).toBeUndefined();
    expect(result.definition?.id).toBe('def-123');
    expect(result.waiverConfig?.isProjectSpecific).toBe(true);
    expect(result.waiverConfig?.isWaiverDefinition).toBe(true);
    expect(result.waiverConfig?.waiverPdfUrl).toBe('https://example.com/project-def.pdf');
  });
});
