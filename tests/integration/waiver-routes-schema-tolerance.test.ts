import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Phase 1 Revision: Route-Level Unit Tests for Schema Tolerance
 * 
 * Tests the actual route handlers with mocked dependencies to verify:
 * - Missing column case: first query returns 42703, retry omits column and succeeds
 * - Column exists case: no retry, Priority 4 redirect works when signature_file_url present
 * - Deterministic mocking of Supabase admin client and auth helpers
 */

// Mock dependencies
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-helpers', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/waiver/generate-signed-waiver-pdf', () => ({
  generateSignedWaiverPdf: vi.fn(),
  requiresPdfGeneration: vi.fn(),
}));

vi.mock('@/lib/waiver/preview-auth-helpers', () => ({
  checkWaiverAccess: vi.fn(),
  getContentDisposition: vi.fn((inline: boolean, id: string) => 
    inline ? 'inline' : `attachment; filename="waiver-${id}.pdf"`
  ),
}));

import { GET as PreviewGET } from '@/app/api/waivers/[signatureId]/preview/route';
import { GET as DownloadGET } from '@/app/api/waivers/[signatureId]/download/route';
import { getAdminClient } from '@/lib/supabase/admin';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { checkWaiverAccess } from '@/lib/waiver/preview-auth-helpers';

interface MockAdminClient {
  from: ReturnType<typeof vi.fn>;
  storage?: {
    from: ReturnType<typeof vi.fn>;
  };
}

describe('Waiver Routes Schema Tolerance - Preview Route', () => {
  let mockAdminClient: MockAdminClient;
  let waiverSignatureQueryCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    waiverSignatureQueryCount = 0;

    // Setup auth mock - authorized user
    vi.mocked(getAuthUser).mockResolvedValue({
      user: { 
        id: 'creator-001', 
        email: 'test@example.com',
        phone: null,
        role: 'authenticated',
        user_metadata: {},
        app_metadata: {},
      },
    } as Awaited<ReturnType<typeof getAuthUser>>);

    // Setup auth check mock - always grants permission
    vi.mocked(checkWaiverAccess).mockReturnValue({
      hasPermission: true,
      reason: 'organizer',
    });
  });

  describe('Missing Column Case (42703 Error)', () => {
    it('should retry query without signature_file_url when first attempt returns 42703', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          // Track waiver_signatures queries
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              // First call to waiver_signatures: include signature_file_url -> return 42703
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                expect(clause).toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: {
                        code: '42703',
                        message: 'column "signature_file_url" does not exist',
                      },
                    })),
                  })),
                };
              }

              // Second call to waiver_signatures (retry): no signature_file_url -> success
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 2) {
                expect(clause).not.toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: {
                        id: 'sig-001',
                        user_id: 'creator-001',
                        anonymous_id: null,
                        project_id: 'proj-001',
                        signature_payload: {
                          signers: [{
                            role_key: 'participant',
                            method: 'draw',
                            data: 'sig.png',
                            timestamp: '2026-01-01T00:00:00Z',
                          }],
                          fields: {},
                        },
                        upload_storage_path: null,
                        signature_storage_path: null,
                        waiver_pdf_url: null,
                        waiver_definition: null,
                      },
                      error: null,
                    })),
                  })),
                };
              }

              // Project lookup
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
        storage: {
          from: vi.fn(() => ({
            download: vi.fn(() => Promise.resolve({
              data: null,
              error: new Error('Not found'),
            })),
          })),
        },
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/sig-001/preview');
      const params = Promise.resolve({ signatureId: 'sig-001' });

      const response = await PreviewGET(request, { params });

      // Verify exactly 2 waiver_signatures queries: initial attempt + retry
      expect(waiverSignatureQueryCount).toBe(2);
      expect(response.status).toBe(404);
    });
  });

  describe('Column Exists Case - Priority 4 Redirect', () => {
    it('should reach Priority 4 redirect when signature_file_url is present (no retry)', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              // First call succeeds with signature_file_url
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                expect(clause).toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: {
                        id: 'sig-002',
                        user_id: 'creator-001',
                        anonymous_id: null,
                        project_id: 'proj-002',
                        signature_file_url: 'https://legacy.example.com/sig.png',
                        signature_payload: null,
                        upload_storage_path: null,
                        signature_storage_path: null,
                        waiver_pdf_url: null,
                        waiver_definition: null,
                      },
                      error: null,
                    })),
                  })),
                };
              }

              // Project lookup
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/sig-002/preview');
      const params = Promise.resolve({ signatureId: 'sig-002' });

      const response = await PreviewGET(request, { params });

      // Should make exactly 1 waiver_signatures query (no retry)
      expect(waiverSignatureQueryCount).toBe(1);
      
      // Should redirect to signature_file_url
      expect(response.status).toBe(307); // NextResponse.redirect uses 307
      expect(response.headers.get('location')).toBe('https://legacy.example.com/sig.png');
    });
  });

  describe('Priority Order Regression Test', () => {
    it('should use Priority 1 (upload_storage_path) over Priority 4 (signature_file_url) when both present', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              if (table === 'waiver_signatures') {
                expect(clause).toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: {
                        id: 'sig-priority',
                        user_id: 'creator-001',
                        anonymous_id: null,
                        project_id: 'proj-priority',
                        upload_storage_path: 'uploads/waiver-full.pdf', // Priority 1
                        signature_file_url: 'https://legacy.example.com/should-not-use.png', // Priority 4
                        signature_payload: null,
                        signature_storage_path: null,
                        waiver_pdf_url: null,
                        waiver_definition: null,
                      },
                      error: null,
                    })),
                  })),
                };
              }

              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
        storage: {
          from: vi.fn(() => ({
            download: vi.fn(() => Promise.resolve({
              data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), // PDF magic bytes
              error: null,
            })),
          })),
        },
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/sig-priority/preview');
      const params = Promise.resolve({ signatureId: 'sig-priority' });

      const response = await PreviewGET(request, { params });

      // Should NOT redirect (Priority 1 served, not Priority 4)
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(waiverSignatureQueryCount).toBe(1);
    });
  });
});

describe('Waiver Routes Schema Tolerance - Download Route', () => {
  let mockAdminClient: MockAdminClient;
  let waiverSignatureQueryCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    waiverSignatureQueryCount = 0;

    vi.mocked(getAuthUser).mockResolvedValue({
      user: { 
        id: 'creator-001', 
        email: 'test@example.com',
        phone: null,
        role: 'authenticated',
        user_metadata: {},
        app_metadata: {},
      },
    } as Awaited<ReturnType<typeof getAuthUser>>);

    vi.mocked(checkWaiverAccess).mockReturnValue({
      hasPermission: true,
      reason: 'organizer',
    });
  });

  describe('Missing Column Case (42703 Error)', () => {
    it('should retry query without signature_file_url when first attempt returns 42703', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                expect(clause).toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: {
                        code: '42703',
                        message: 'column "signature_file_url" does not exist',
                      },
                    })),
                  })),
                };
              }

              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 2) {
                expect(clause).not.toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: {
                        id: 'sig-003',
                        user_id: 'creator-001',
                        anonymous_id: null,
                        project_id: 'proj-003',
                        signature_payload: {
                          signers: [{
                            role_key: 'participant',
                            method: 'typed',
                            data: 'John Doe',
                            timestamp: '2026-01-01T00:00:00Z',
                          }],
                          fields: {},
                        },
                        upload_storage_path: null,
                        signature_storage_path: null,
                        signature_text: null,
                        waiver_pdf_url: null,
                        waiver_definition: null,
                      },
                      error: null,
                    })),
                  })),
                };
              }

              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/sig-003/download');
      const params = Promise.resolve({ signatureId: 'sig-003' });

      const response = await DownloadGET(request, { params });

      expect(waiverSignatureQueryCount).toBe(2);
      expect(response.status).toBe(404);
    });
  });

  describe('Column Exists Case - Priority 4 Redirect', () => {
    it('should reach Priority 4 redirect when signature_file_url is present (no retry)', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                expect(clause).toContain('signature_file_url');
                
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: {
                        id: 'sig-004',
                        user_id: 'creator-001',
                        anonymous_id: null,
                        project_id: 'proj-004',
                        signature_file_url: 'https://legacy.example.com/download-sig.png',
                        signature_payload: null,
                        upload_storage_path: null,
                        signature_storage_path: null,
                        signature_text: null,
                        waiver_pdf_url: null,
                        waiver_definition: null,
                      },
                      error: null,
                    })),
                  })),
                };
              }

              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/sig-004/download');
      const params = Promise.resolve({ signatureId: 'sig-004' });

      const response = await DownloadGET(request, { params });

      expect(waiverSignatureQueryCount).toBe(1);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://legacy.example.com/download-sig.png');
    });
  });

  describe('Signup ID Fallback - Missing Column World', () => {
    it('should perform signup fallback without signature_file_url in missing-column schema', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              // First: by id with column -> 42703
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: { code: '42703', message: 'column "signature_file_url" does not exist' },
                    })),
                  })),
                };
              }

              // Second: retry by id without column -> no rows
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 2) {
                expect(clause).not.toContain('signature_file_url');
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: {
                        code: 'PGRST116',
                        message: 'JSON object requested, but the result contains 0 rows',
                      },
                    })),
                  })),
                };
              }

              // Third: fallback by signup_id (uses clause without column since schema lacks it)
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 3) {
                expect(clause).not.toContain('signature_file_url');
                return {
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          maybeSingle: vi.fn(() => Promise.resolve({
                            data: {
                              id: 'sig-from-signup',
                              user_id: 'creator-001',
                              anonymous_id: null,
                              project_id: 'proj-005',
                              signup_id: 'signup-999',
                              // No signature_file_url in missing-column world
                              signature_payload: {
                                signers: [{
                                  role_key: 'participant',
                                  method: 'draw',
                                  data: 'fallback-sig.png',
                                  timestamp: '2026-01-01T00:00:00Z',
                                }],
                                fields: {},
                              },
                              upload_storage_path: null,
                              signature_storage_path: null,
                              signature_text: null,
                              waiver_pdf_url: null,
                              waiver_definition: null,
                            },
                            error: null,
                          })),
                        })),
                      })),
                    })),
                  })),
                };
              }

              // Fourth: project lookup
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/signup-999/download');
      const params = Promise.resolve({ signatureId: 'signup-999' });

      const response = await DownloadGET(request, { params });

      // Verify query count: initial + retry + fallback = 3
      expect(waiverSignatureQueryCount).toBe(3);
      
      // In missing-column world, no redirect occurs (signature_payload is handled instead)
      expect(response.status).not.toBe(307);
    });
  });

  describe('Signup ID Fallback - Column Exists World', () => {
    it('should perform signup fallback with signature_file_url when column exists', async () => {
      mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'waiver_signatures') {
            waiverSignatureQueryCount++;
          }

          return {
            select: vi.fn((clause: string) => {
              // First: by id with column -> no rows (no 42703, column exists)
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 1) {
                expect(clause).toContain('signature_file_url');
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({
                      data: null,
                      error: {
                        code: 'PGRST116',
                        message: 'JSON object requested, but the result contains 0 rows',
                      },
                    })),
                  })),
                };
              }

              // Second: fallback by signup_id (column exists, no retry needed)
              if (table === 'waiver_signatures' && waiverSignatureQueryCount === 2) {
                expect(clause).toContain('signature_file_url');
                return {
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          maybeSingle: vi.fn(() => Promise.resolve({
                            data: {
                              id: 'sig-from-signup-exists',
                              user_id: 'creator-001',
                              anonymous_id: null,
                              project_id: 'proj-006',
                              signup_id: 'signup-888',
                              signature_file_url: 'https://example.com/fallback-exists.png',
                              signature_payload: null,
                              upload_storage_path: null,
                              signature_storage_path: null,
                              signature_text: null,
                              waiver_pdf_url: null,
                              waiver_definition: null,
                            },
                            error: null,
                          })),
                        })),
                      })),
                    })),
                  })),
                };
              }

              // Third: project lookup
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: {
                      creator_id: 'creator-001',
                      organization_id: null,
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };

      vi.mocked(getAdminClient).mockReturnValue(mockAdminClient as never);

      const request = new NextRequest('http://localhost:3000/api/waivers/signup-888/download');
      const params = Promise.resolve({ signatureId: 'signup-888' });

      const response = await DownloadGET(request, { params });

      // Verify query count: initial query + fallback = 2 (no retry needed)
      expect(waiverSignatureQueryCount).toBe(2);
      
      // Should redirect to signature_file_url
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://example.com/fallback-exists.png');
    });
  });
});
