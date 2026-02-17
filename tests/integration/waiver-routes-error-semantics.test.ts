import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-helpers', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/waiver/generate-signed-waiver-pdf', () => ({
  generateSignedWaiverPdf: vi.fn(async () => new ArrayBuffer(8)),
  requiresPdfGeneration: vi.fn(() => false),
}));

vi.mock('@/lib/waiver/preview-auth-helpers', () => ({
  checkWaiverAccess: vi.fn(() => ({ hasPermission: true, reason: 'organizer' })),
  getContentDisposition: vi.fn((inline: boolean, id: string) =>
    inline ? `inline; filename="waiver-${id}.pdf"` : `attachment; filename="waiver-${id}.pdf"`
  ),
}));

import { GET as PreviewGET } from '@/app/api/waivers/[signatureId]/preview/route';
import { GET as DownloadGET } from '@/app/api/waivers/[signatureId]/download/route';
import { getAdminClient } from '@/lib/supabase/admin';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { checkWaiverAccess } from '@/lib/waiver/preview-auth-helpers';

type DbError = { code?: string; message?: string; details?: string };

type SignatureMode =
  | { kind: 'query-error'; error: DbError }
  | { kind: 'no-rows' }
  | { kind: 'multiple-rows' }
  | { kind: 'found'; data: Record<string, unknown> };

type FallbackMode =
  | { kind: 'none' }
  | { kind: 'found'; data: Record<string, unknown> }
  | { kind: 'error'; error: DbError };

function makeProjectQueryResult(mode: 'ok' | 'not-found' | 'error') {
  if (mode === 'ok') {
    return {
      data: {
        creator_id: 'creator-1',
        organization_id: null,
      },
      error: null,
    };
  }

  if (mode === 'not-found') {
    return {
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, but the result contains 0 rows',
      },
    };
  }

  return {
    data: null,
    error: {
      code: 'PGRST500',
      message: 'project query failed',
    },
  };
}

function makeAdminClient(options: {
  signatureById: SignatureMode;
  fallbackBySignup?: FallbackMode;
  projectMode?: 'ok' | 'not-found' | 'error';
  uploadBlob?: Blob | null;
}) {
  const fallbackMode = options.fallbackBySignup ?? { kind: 'none' };
  const projectMode = options.projectMode ?? 'ok';
  const uploadBlob = options.uploadBlob ?? new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]);

  const from = vi.fn((table: string) => {
    if (table === 'waiver_signatures') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string) => {
            if (column === 'id') {
              const byId = options.signatureById;

              if (byId.kind === 'query-error') {
                return {
                  single: vi.fn(async () => ({ data: null, error: byId.error })),
                };
              }

              if (byId.kind === 'no-rows') {
                return {
                  single: vi.fn(async () => ({
                    data: null,
                    error: {
                      code: 'PGRST116',
                      message: 'JSON object requested, but the result contains 0 rows',
                    },
                  })),
                };
              }

              if (byId.kind === 'multiple-rows') {
                return {
                  single: vi.fn(async () => ({
                    data: null,
                    error: {
                      code: 'PGRST116',
                      message: 'JSON object requested, multiple (or no) rows returned',
                    },
                  })),
                };
              }

              return {
                single: vi.fn(async () => ({ data: byId.data, error: null })),
              };
            }

            if (column === 'signup_id') {
              return {
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => {
                        if (fallbackMode.kind === 'none') {
                          return { data: null, error: null };
                        }
                        if (fallbackMode.kind === 'error') {
                          return { data: null, error: fallbackMode.error };
                        }
                        return { data: fallbackMode.data, error: null };
                      }),
                    })),
                  })),
                })),
              };
            }

            return {
              single: vi.fn(async () => ({ data: null, error: null })),
            };
          }),
        })),
      };
    }

    if (table === 'projects') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => makeProjectQueryResult(projectMode)),
          })),
        })),
      };
    }

    if (table === 'organization_members') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        })),
      };
    }

    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    };
  });

  return {
    from,
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async () => ({ data: uploadBlob, error: null })),
      })),
    },
  };
}

const baseSignature = {
  id: 'sig-1',
  user_id: 'user-1',
  anonymous_id: null,
  project_id: 'project-1',
  waiver_pdf_url: null,
  upload_storage_path: null,
  signature_payload: null,
  signature_storage_path: null,
  signature_file_url: 'https://legacy.example.com/sig.pdf',
  signature_text: null,
  waiver_definition: null,
};

describe('Waiver route error semantics and compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getAuthUser).mockResolvedValue({
      user: {
        id: 'creator-1',
        email: 'owner@example.com',
      },
      error: null,
    } as Awaited<ReturnType<typeof getAuthUser>>);

    vi.mocked(checkWaiverAccess).mockReturnValue({
      hasPermission: true,
      reason: 'organizer',
      details: 'test organizer access',
    });
  });

  it('preview: returns 500 for generic signature query error (not masked as 404)', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: { kind: 'query-error', error: { code: 'PGRST200', message: 'db offline' } },
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-error/preview'),
      { params: Promise.resolve({ signatureId: 'sig-error' }) }
    );

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe('Database query failed');
  });

  it('download: returns 500 for PGRST116 multiple-row error (not treated as not-found)', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: { kind: 'multiple-rows' },
      }) as never
    );

    const response = await DownloadGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-multi/download'),
      { params: Promise.resolve({ signatureId: 'sig-multi' }) }
    );

    expect(response.status).toBe(500);
  });

  it('preview: returns 404 when id lookup has 0 rows and signup fallback also missing', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: { kind: 'no-rows' },
        fallbackBySignup: { kind: 'none' },
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-missing/preview'),
      { params: Promise.resolve({ signatureId: 'sig-missing' }) }
    );

    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe('Signature not found');
  });

  it('download: uses signup fallback record when id lookup has 0 rows', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: { kind: 'no-rows' },
        fallbackBySignup: {
          kind: 'found',
          data: {
            ...baseSignature,
            id: 'sig-from-signup',
            signup_id: 'signup-abc',
            signature_file_url: 'https://legacy.example.com/fallback.pdf',
          },
        },
      }) as never
    );

    const response = await DownloadGET(
      new NextRequest('http://localhost:3000/api/waivers/signup-abc/download'),
      { params: Promise.resolve({ signatureId: 'signup-abc' }) }
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://legacy.example.com/fallback.pdf');
  });

  it('preview: forwards anonymousSignupId param to auth helper', async () => {
    vi.mocked(checkWaiverAccess).mockReturnValue({
      hasPermission: false,
      reason: 'unauthorized',
      details: 'test unauthorized access',
    });

    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: {
          kind: 'found',
          data: {
            ...baseSignature,
            anonymous_id: 'anon-1',
            signature_file_url: null,
          },
        },
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-anon/preview?anonymousSignupId=anon-1'),
      { params: Promise.resolve({ signatureId: 'sig-anon' }) }
    );

    expect(response.status).toBe(403);
    expect(vi.mocked(checkWaiverAccess)).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousSignupIdParam: 'anon-1' })
    );
  });

  it('preview: returns 500 when project lookup errors (not masked as 404)', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: {
          kind: 'found',
          data: {
            ...baseSignature,
            signature_file_url: null,
            upload_storage_path: 'uploads/file.pdf',
          },
        },
        projectMode: 'error',
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-project-error/preview'),
      { params: Promise.resolve({ signatureId: 'sig-project-error' }) }
    );

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe('Database query failed');
  });

  it('preview: keeps priority order (upload path wins over legacy redirect)', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: {
          kind: 'found',
          data: {
            ...baseSignature,
            upload_storage_path: 'uploads/full-waiver.pdf',
            signature_file_url: 'https://legacy.example.com/should-not-win.pdf',
          },
        },
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-priority/preview'),
      { params: Promise.resolve({ signatureId: 'sig-priority' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('preview: supports legacy signature_text typed signatures', async () => {
    vi.mocked(getAdminClient).mockReturnValue(
      makeAdminClient({
        signatureById: {
          kind: 'found',
          data: {
            ...baseSignature,
            signature_file_url: null,
            signature_text: 'Jane Doe',
            waiver_pdf_url: 'https://example.com/waiver.pdf',
          },
        },
      }) as never
    );

    const response = await PreviewGET(
      new NextRequest('http://localhost:3000/api/waivers/sig-typed/preview'),
      { params: Promise.resolve({ signatureId: 'sig-typed' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });
});
