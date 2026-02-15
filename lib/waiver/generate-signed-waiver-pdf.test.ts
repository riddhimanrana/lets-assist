import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSignedWaiverPdf, requiresPdfGeneration } from './generate-signed-waiver-pdf';
import type { SignaturePayload } from '@/types/waiver-definitions';

const mockPage = {
  getHeight: vi.fn(() => 800),
  drawImage: vi.fn(),
  drawText: vi.fn(),
};

// Mock pdf-lib
vi.mock('pdf-lib', () => {
  const mockPdfDoc = {
    getPages: vi.fn(() => [mockPage]),
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

describe('generateSignedWaiverPdf', () => {
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

  it('should generate PDF with draw signature', async () => {
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
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/test.pdf');
  });

  it('should stamp draw signatures using bottom-left y directly (no flip)', async () => {
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

    await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinition,
      signaturePayload: payload,
    });

    expect(mockPage.drawImage).toHaveBeenCalled();
    const drawImageOptions = mockPage.drawImage.mock.calls[0]?.[1];
    expect(drawImageOptions?.x).toBe(100);
    expect(drawImageOptions?.y).toBe(500);
    expect(drawImageOptions?.width).toBe(200);
    expect(drawImageOptions?.height).toBe(50);
  });

  it('should generate PDF with typed signature', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'typed',
          data: 'John Doe',
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

  it('should throw error if PDF fetch fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
    });

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

    await expect(
      generateSignedWaiverPdf({
        waiverPdfUrl: 'https://example.com/test.pdf',
        definition: mockDefinition,
        signaturePayload: payload,
      })
    ).rejects.toThrow('Failed to fetch waiver PDF');
  });

  it('should handle multiple signers', async () => {
    const definitionWithMultipleSigners = {
      ...mockDefinition,
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
        {
          id: 'field-2',
          waiver_definition_id: 'def-123',
          field_key: 'parent_signature',
          field_type: 'signature' as const,
          label: 'Parent Signature',
          required: true,
          source: 'custom_overlay' as const,
          pdf_field_name: null,
          page_index: 0,
          rect: { x: 100, y: 400, width: 200, height: 50 },
          signer_role_key: 'parent',
          meta: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
    };

    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {},
    };

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: definitionWithMultipleSigners,
      signaturePayload: payload,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('requiresPdfGeneration', () => {
  // Phase 1 Fix: requiresPdfGeneration now always returns true for multi-signer payloads
  // Upload method in payload means "uploaded signature image", not full waiver
  // Full waiver uploads are handled via upload_storage_path column (offline mode)
  
  it('should return true for draw signatures', () => {
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

    expect(requiresPdfGeneration(payload)).toBe(true);
  });

  it('should return true for typed signatures', () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'typed',
          data: 'John Doe',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {},
    };

    expect(requiresPdfGeneration(payload)).toBe(true);
  });

  it('should return true for upload method (signature image uploads)', () => {
    // Phase 1 Fix: Upload method in payload = uploaded signature image, needs stamping
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'upload',
          data: 'signatures/sig-123.png', // Storage path to signature image
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {},
    };

    expect(requiresPdfGeneration(payload)).toBe(true);
  });

  it('should return true for mixed methods including upload', () => {
    // Phase 1 Fix: All methods in multi-signer payload need PDF generation
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:00:00Z',
        },
        {
          role_key: 'parent',
          method: 'upload',
          data: 'signatures/parent-sig.jpg', // Uploaded signature image
          timestamp: '2026-02-10T10:01:00Z',
        },
      ],
      fields: {},
    };

    expect(requiresPdfGeneration(payload)).toBe(true);
  });
});
