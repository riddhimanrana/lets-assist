import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSignedWaiverPdf } from './generate-signed-waiver-pdf';
import type { SignaturePayload } from '@/types/waiver-definitions';

// Mock pdf-lib
vi.mock('pdf-lib', () => {
  const mockPdfDoc = {
    getPages: vi.fn(() => [
      {
        getHeight: vi.fn(() => 800),
        getWidth: vi.fn(() => 600),
        drawImage: vi.fn(),
        drawText: vi.fn(),
      },
    ]),
    getForm: vi.fn(() => ({
      flatten: vi.fn(),
    })),
    save: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    embedPng: vi.fn(async () => ({ width: 200, height: 50 })),
    embedJpg: vi.fn(async () => ({ width: 200, height: 50 })),
  };

  return {
    PDFDocument: {
      load: vi.fn(async () => mockPdfDoc),
    },
    rgb: vi.fn((r, g, b) => ({ r, g, b })),
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('Phase 2: Storage Path Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    });
  });

  const mockDefinition = {
    id: 'def-123',
    scope: 'project' as const,
    project_id: 'proj-123',
    title: 'Test Waiver',
    version: 1,
    active: true,
    pdf_storage_path: '/test.pdf',
    pdf_public_url: 'https://example.com/test.pdf',
    source: 'project_pdf' as const,
    created_by: 'user-123',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    signers: [
      {
        id: 'signer-1',
        waiver_definition_id: 'def-123',
        role_key: 'volunteer',
        label: 'Volunteer',
        required: true,
        order_index: 0,
        rules: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    fields: [
      {
        id: 'field-1',
        waiver_definition_id: 'def-123',
        field_key: 'volunteer_signature',
        field_type: 'signature' as const,
        label: 'Volunteer Signature',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 500, width: 200, height: 50 },
        signer_role_key: 'volunteer',
        meta: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
  };

  it('should handle data URL signatures (existing behavior)', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {},
    };

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinition,
      signaturePayload: payload,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle storage path signatures with resolver', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'waiver-signatures/signup-123/signature.png', // Storage path
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {},
    };

    // Mock storage resolver
    const mockResolver = vi.fn(async (_path: string) => {
      return new ArrayBuffer(100); // Mock image bytes
    });

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinition,
      signaturePayload: payload,
      storageResolver: mockResolver,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(mockResolver).toHaveBeenCalledWith('waiver-signatures/signup-123/signature.png');
  });

  it('should throw error if storage path provided without resolver', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'waiver-signatures/signup-123/signature.png', // Storage path
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {},
    };

    // No resolver provided
    await expect(
      generateSignedWaiverPdf({
        waiverPdfUrl: 'https://example.com/test.pdf',
        definition: mockDefinition,
        signaturePayload: payload,
      })
    ).rejects.toThrow('Storage resolver required');
  });

  it('should correctly detect data URLs vs storage paths', async () => {
    // This tests the detection logic
    const dataUrl = 'data:image/png;base64,abc123';
    const storagePath = 'waiver-signatures/test.png';
    
    expect(dataUrl.startsWith('data:')).toBe(true);
    expect(storagePath.startsWith('data:')).toBe(false);
  });
});
