import { PDFDocument, rgb } from 'pdf-lib';
import type { SignaturePayload } from '@/types/waiver-definitions';

export interface PdfGenerationOptions {
  waiverPdfUrl: string;
  definition: {
    id: string;
    fields?: Array<{
      field_key: string;
      field_type: string;
      page_index: number;
      rect: { x: number; y: number; width: number; height: number };
      signer_role_key: string | null;
    }>;
  };
  signaturePayload: SignaturePayload;
  // Phase 2: Optional storage resolver for handling storage paths
  storageResolver?: (path: string) => Promise<ArrayBuffer>;
}

/**
 * Generates a signed waiver PDF on-demand by stamping signatures onto the original PDF.
 * Returns a Buffer containing the flattened PDF.
 * 
 * Phase 2: Now supports both data URLs and storage paths for signatures.
 * If signature data is a storage path, storageResolver must be provided.
 */
export async function generateSignedWaiverPdf(
  options: PdfGenerationOptions
): Promise<Buffer> {
  const { waiverPdfUrl, definition, signaturePayload, storageResolver } = options;

  // 1. Load the original PDF
  const pdfResponse = await fetch(waiverPdfUrl);
  if (!pdfResponse.ok) {
    throw new Error('Failed to fetch waiver PDF');
  }
  const pdfBytes = await pdfResponse.arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes);

  // 2. Get signature placements from definition
  const signatureFields = definition.fields?.filter(f => f.field_type === 'signature') || [];

  // 3. For each signature in payload, find corresponding placement and stamp
  for (const signerSignature of signaturePayload.signers) {
    // Phase 1 Fix: Upload method now refers to image signature uploads, not full waiver uploads
    // These should be stamped like draw method signatures
    // Full waiver uploads are handled via upload_storage_path (offline mode), not in payload

    // Find fields for this signer role
    const signerFields = signatureFields.filter(
      f => f.signer_role_key === signerSignature.role_key
    );

    for (const field of signerFields) {
      // Get the page
      const page = pdfDoc.getPages()[field.page_index];
      if (!page) continue;

      // Handle typed signatures (draw text instead of image)
      if (signerSignature.method === 'typed') {
        const { x, y, height } = field.rect;
        const pageHeight = page.getHeight();
        const yPosition = pageHeight - y - height;

        // Draw typed signature as text
        const fontSize = Math.min(height * 0.6, 24); // Scale font to fit
        page.drawText(signerSignature.data, {
          x: x + 5,
          y: yPosition + (height / 2) - (fontSize / 3),
          size: fontSize,
          color: rgb(0, 0, 0),
        });

        // Add timestamp
        const timestampFontSize = 8;
        const timestamp = new Date(signerSignature.timestamp).toLocaleString();
        page.drawText(`Signed: ${timestamp}`, {
          x,
          y: yPosition - 12,
          size: timestampFontSize,
          color: rgb(0.5, 0.5, 0.5),
        });

        continue;
      }

      // Handle drawn signatures (embed as image)
      
      // Phase 2: Detect if data is a data URL or storage path
      const isDataUrl = signerSignature.data.startsWith('data:');
      let imageBytes: Buffer | ArrayBuffer;
      
      if (isDataUrl) {
        // Existing logic: extract from data URL
        const base64Data = signerSignature.data.split(',')[1];
        imageBytes = Buffer.from(base64Data, 'base64');
      } else {
        // New logic: treat as storage path, use resolver
        if (!storageResolver) {
          throw new Error('Storage resolver required for storage-path signatures');
        }
        const resolvedBytes = await storageResolver(signerSignature.data);
        imageBytes = Buffer.from(resolvedBytes);
      }
      
      let signatureImage;
      try {
        // Determine image type from data or try both formats
        if (isDataUrl) {
          if (signerSignature.data.startsWith('data:image/png')) {
            signatureImage = await pdfDoc.embedPng(imageBytes);
          } else if (signerSignature.data.startsWith('data:image/jpeg') || 
                     signerSignature.data.startsWith('data:image/jpg')) {
            signatureImage = await pdfDoc.embedJpg(imageBytes);
          }
        } else {
          // For storage paths, try PNG first (most common for signatures)
          try {
            signatureImage = await pdfDoc.embedPng(imageBytes);
          } catch {
            // If PNG fails, try JPG
            signatureImage = await pdfDoc.embedJpg(imageBytes);
          }
        }
      } catch (error) {
        console.error(`Failed to embed signature for ${signerSignature.role_key}:`, error);
        continue;
      }

      if (!signatureImage) continue;

      // Calculate dimensions and position
      const { x, y, width, height } = field.rect;
      const pageHeight = page.getHeight();

      // Convert PDF coordinates (bottom-left origin) to pdf-lib coordinates
      const yPosition = pageHeight - y - height;

      // Draw the signature
      page.drawImage(signatureImage, {
        x,
        y: yPosition,
        width,
        height,
      });

      // Add timestamp text below signature
      const fontSize = 8;
      const timestamp = new Date(signerSignature.timestamp).toLocaleString();
      page.drawText(`Signed: ${timestamp}`, {
        x,
        y: yPosition - 12,
        size: fontSize,
        color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  // Phase 3: Stamp non-signature fields (text, date, checkbox, radio, dropdown)
  const nonSignatureFields = definition.fields?.filter(f => f.field_type !== 'signature') || [];
  
  for (const field of nonSignatureFields) {
    const value = signaturePayload.fields?.[field.field_key];
    
    // Skip if no value provided (optional fields)
    if (value === undefined || value === null) continue;
    
    const page = pdfDoc.getPage(field.page_index || 0);
    if (!page) continue;
    
    const rect = field.rect || { x: 0, y: 0, width: 100, height: 20 };
    
    // Convert PDF coordinates to pdf-lib (y is inverted from bottom-left origin)
    const { height: pageHeight } = page.getSize();
    const yPdfLib = pageHeight - rect.y - rect.height;
    
    switch (field.field_type) {
      case 'text':
      case 'date':
        // Draw text value
        page.drawText(String(value), {
          x: rect.x,
          y: yPdfLib,
          size: 10,
          color: rgb(0, 0, 0),
        });
        break;
        
      case 'checkbox':
        // Draw checkmark if checked
        if (value === true || value === 'true' || value === 'yes') {
          page.drawText('✓', {
            x: rect.x,
            y: yPdfLib,
            size: 12,
            color: rgb(0, 0, 0),
          });
        }
        break;
        
      case 'radio':
      case 'dropdown':
        // Draw selected option
        page.drawText(String(value), {
          x: rect.x,
          y: yPdfLib,
          size: 10,
          color: rgb(0, 0, 0),
        });
        break;
    }
  }

  // 4. Flatten form fields (if any exist)
  const form = pdfDoc.getForm();
  try {
    form.flatten();
  } catch {
    // No form fields to flatten, or already flat
  }

  // 5. Save and return the PDF bytes
  const modifiedPdfBytes = await pdfDoc.save();
  return Buffer.from(modifiedPdfBytes);
}

/**
 * Helper: Check if signature payload requires PDF generation.
 * Phase 1 Fix: Upload method in multi-signer payload means "uploaded signature image", not full waiver.
 * These still require PDF generation (stamping the uploaded signature image onto the waiver).
 * Returns true for any multi-signer payload (draw/typed/upload all need stamping).
 * Only returns false for single offline full-waiver upload (handled via upload_storage_path column).
 */
export function requiresPdfGeneration(payload: SignaturePayload): boolean {
  // Multi-signer payloads always need PDF generation
  // All signature methods (draw/typed/upload) are images that need stamping
  return true;
}
