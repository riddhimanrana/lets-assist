import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSignedWaiverPdf } from './generate-signed-waiver-pdf';
import type { SignaturePayload } from '@/types/waiver-definitions';

const mockPage = {
  getHeight: vi.fn(() => 800),
  getWidth: vi.fn(() => 600),
  getSize: vi.fn(() => ({ height: 800, width: 600 })),
  drawImage: vi.fn(),
  drawText: vi.fn(),
};

// Mock pdf-lib
vi.mock('pdf-lib', () => {
  const mockPdfDoc = {
    getPages: vi.fn(() => [mockPage]),
    getPage: vi.fn((_index: number) => mockPage),
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

describe('Phase 3: Non-Signature Field Stamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    });
  });

  const mockDefinitionWithFields = {
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
      {
        id: 'field-2',
        waiver_definition_id: 'def-123',
        field_key: 'volunteer_name',
        field_type: 'text' as const,
        label: 'Volunteer Name',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 600, width: 200, height: 20 },
        signer_role_key: null,
        meta: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 'field-3',
        waiver_definition_id: 'def-123',
        field_key: 'agree_terms',
        field_type: 'checkbox' as const,
        label: 'I agree to terms',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 650, width: 20, height: 20 },
        signer_role_key: null,
        meta: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 'field-4',
        waiver_definition_id: 'def-123',
        field_key: 'event_date',
        field_type: 'date' as const,
        label: 'Event Date',
        required: true,
        source: 'custom_overlay' as const,
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 100, y: 700, width: 150, height: 20 },
        signer_role_key: null,
        meta: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
  };

  it('should stamp text field values onto PDF', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {
        volunteer_name: 'Alice Smith',
      },
    };

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinitionWithFields,
      signaturePayload: payload,
    });

    // Should successfully generate PDF with stamped fields
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);

    const textCall = mockPage.drawText.mock.calls.find(([text]) => text === 'Alice Smith');
    expect(textCall).toBeDefined();
    expect(textCall?.[1]?.x).toBeGreaterThan(100);
    expect(textCall?.[1]?.x).toBeLessThan(110);
    expect(textCall?.[1]?.y).toBeGreaterThan(604);
    expect(textCall?.[1]?.y).toBeLessThan(607);
  });

  it('should stamp checkbox fields when checked', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANS',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {
        agree_terms: true,
      },
    };

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinitionWithFields,
      signaturePayload: payload,
    });

    // Should successfully generate PDF with checkbox stamped
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);

    const checkboxCall = mockPage.drawText.mock.calls.find(([text]) => text === 'X');
    expect(checkboxCall).toBeDefined();
    expect(checkboxCall?.[1]?.x).toBeGreaterThan(104);
    expect(checkboxCall?.[1]?.x).toBeLessThan(108);
    expect(checkboxCall?.[1]?.y).toBeGreaterThan(652);
    expect(checkboxCall?.[1]?.y).toBeLessThan(656);
  });

  it('should stamp date field values onto PDF', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'typed',
          data: 'John Doe',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {
        event_date: '2026-02-15',
      },
    };

    const result = await generateSignedWaiverPdf({
      waiverPdfUrl: 'https://example.com/test.pdf',
      definition: mockDefinitionWithFields,
      signaturePayload: payload,
    });

    // Should successfully generate PDF with date stamped
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle missing optional field values gracefully', async () => {
    const payload: SignaturePayload = {
      signers: [
        {
          role_key: 'volunteer',
          method: 'typed',
          data: 'John Doe',
          timestamp: '2026-02-10T10:00:00Z',
        },
      ],
      fields: {
        // volunteer_name is intentionally missing
      },
    };

    // Should not throw error
    await expect(
      generateSignedWaiverPdf({
        waiverPdfUrl: 'https://example.com/test.pdf',
        definition: mockDefinitionWithFields,
        signaturePayload: payload,
      })
    ).resolves.toBeInstanceOf(Buffer);
  });
});
