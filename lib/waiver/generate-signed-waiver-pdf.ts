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
 * 
 * Phase 4 Coordinate System:
 * - Input field coordinates are in PDF coordinate space (bottom-left origin, PDF points)
 * - pdf-lib drawing APIs use the same bottom-left origin
 * - Therefore coordinates are used directly without y-axis flipping
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
        const yPosition = y;

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
      const yPosition = y;

      // Signature boxes detected from text baselines can be too small.
      // Enforce a sane minimum for image signatures while clamping to page bounds.
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const minSigWidth = 180;
      const minSigHeight = 50;

      const desiredWidth = Math.max(width, minSigWidth);
      const desiredHeight = Math.max(height, minSigHeight);

      const finalWidth = Math.min(desiredWidth, Math.max(1, pageWidth - x));
      const finalHeight = Math.min(desiredHeight, Math.max(1, pageHeight - yPosition));

      // Draw the signature
      page.drawImage(signatureImage, {
        x,
        y: yPosition,
        width: finalWidth,
        height: finalHeight,
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

  // Phase 3: Stamp non-signature fields (text-like fields, date, checkbox, legacy radio/dropdown)
  const nonSignatureFields = definition.fields?.filter(f => f.field_type !== 'signature') || [];
  
  for (const field of nonSignatureFields) {
    const value = signaturePayload.fields?.[field.field_key];
    
    // Skip if no value provided (optional fields)
    if (value === undefined || value === null) continue;
    
    const page = pdfDoc.getPage(field.page_index || 0);
    if (!page) continue;
    
    const rect = field.rect || { x: 0, y: 0, width: 100, height: 20 };
    const verticalPadding = Math.max(0, Math.min(2, rect.height * 0.08));
    const textPaddingX = Math.max(1, Math.min(4, rect.width * 0.06));
    const textFontSize = Math.max(8, Math.min(12, rect.height * 0.72));
    const textY = rect.y + Math.max(0, (rect.height - textFontSize) / 2) + verticalPadding;
    const textX = rect.x + textPaddingX;
    const textMaxWidth = Math.max(1, rect.width - textPaddingX * 2);
    
    switch (field.field_type) {
      case 'text':
      case 'name':
      case 'email':
      case 'phone':
      case 'date':
        // Draw text value
        page.drawText(String(value), {
          x: textX,
          y: textY,
          size: textFontSize,
          maxWidth: textMaxWidth,
          lineHeight: textFontSize,
          color: rgb(0, 0, 0),
        });
        break;
        
      case 'checkbox':
        // Draw check marker if checked.
        // NOTE: Avoid unicode glyphs like '✓' because default PDF WinAnsi fonts cannot encode them.
        if (value === true || value === 'true' || value === 'yes') {
          const checkboxFontSize = Math.max(8, Math.min(16, Math.min(rect.width, rect.height) * 0.85));
          const checkboxX = rect.x + Math.max(0, (rect.width - checkboxFontSize * 0.55) / 2);
          const checkboxY = rect.y + Math.max(0, (rect.height - checkboxFontSize) / 2) + verticalPadding;

          page.drawText('X', {
            x: checkboxX,
            y: checkboxY,
            size: checkboxFontSize,
            color: rgb(0, 0, 0),
          });
        }
        break;
        
      case 'radio':
      case 'dropdown':
        // Draw selected option
        page.drawText(String(value), {
          x: textX,
          y: textY,
          size: textFontSize,
          maxWidth: textMaxWidth,
          lineHeight: textFontSize,
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
export function requiresPdfGeneration(_payload: SignaturePayload): boolean {
  // Multi-signer payloads always need PDF generation
  // All signature methods (draw/typed/upload) are images that need stamping
  return true;
}
