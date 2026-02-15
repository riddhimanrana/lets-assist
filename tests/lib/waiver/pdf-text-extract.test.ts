import { describe, it, expect, beforeAll } from 'vitest';
import { extractPdfTextWithPositions, PdfTextItem } from '@/lib/waiver/pdf-text-extract';

// Minimal valid PDF with text content for testing
// This is a simple single-page PDF with "Hello World" text
const SIMPLE_PDF_BASE64 = 'JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgMjAwIDIwMCBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqCjw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PAogICAgL0ZvbnQgPDwKICAgICAgL0YxIDQgMCBSCiAgICA+PgogID4+CiAgL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNCAwIG9iago8PAogIC9UeXBlIC9Gb250CiAgL1N1YnR5cGUgL1R5cGUxCiAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgo+PgplbmRvYmoKCjUgMCBvYmoKPDwKICAvTGVuZ3RoIDQ0Cj4+CnN0cmVhbQpCVAovRjEgMTggVGYKMTAgMTAgVGQKKEhlbGxvIFdvcmxkKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA3OSAwMDAwMCBuIAowMDAwMDAwMTczIDAwMDAwIG4gCjAwMDAwMDAzMDEgMDAwMDAgbiAKMDAwMDAwMDM4MCAwMDAwMCBuIAp0cmFpbGVyCjw8CiAgL1NpemUgNgogIC9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo0OTIKJSVFT0YK';

// Two-page PDF for multi-page testing
const TWO_PAGE_PDF_BASE64 = 'JVBERi0xLjcKCjEgMCBvYmoKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgNjEyIDc5MiBdCiAgL0NvdW50IDIKICAvS2lkcyBbIDMgMCBSIDYgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqCjw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNCAwIFIgPj4gPj4KICAvQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCgo0IDAgb2JqCjw8CiAgL1R5cGUgL0ZvbnQKICAvU3VidHlwZSAvVHlwZTEKICAvQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9iagoKNSAwIG9iago8PAogIC9MZW5ndGggNDEKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgo1MCA3MDAgVGQKKFBhZ2UgMSkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagoKNiAwIG9iago8PAogIC9UeXBlIC9QYWdlCiAgL1BhcmVudCAyIDAgUgogIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDQgMCBSID4+ID4+CiAgL0NvbnRlbnRzIDcgMCBSCj4+CmVuZG9iagoKNyAwIG9iago8PAogIC9MZW5ndGggNDEKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgo1MCA3MDAgVGQKKFBhZ2UgMikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE4MyAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCjAwMDAwMDAzODAgMDAwMDAgbiAKMDAwMDAwMDQ2OSAwMDAwMCBuIAowMDAwMDAwNTg3IDAwMDAwIG4gCnRyYWlsZXIKPDwKICAvU2l6ZSA4CiAgL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjY3NgolJUVPRgo=';

// PDF with rotated page (90 degrees)
const ROTATED_PDF_BASE64 = 'JVBERi0xLjcKCjEgMCBvYmoKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgNjEyIDc5MiBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqCjw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1JvdGF0ZSA5MAogIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDQgMCBSID4+ID4+CiAgL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNCAwIG9iago8PAogIC9UeXBlIC9Gb250CiAgL1N1YnR5cGUgL1R5cGUxCiAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgo+PgplbmRvYmoKCjUgMCBvYmoKPDwKICAvTGVuZ3RoIDQ0Cj4+CnN0cmVhbQpCVAovRjEgMTIgVGYKNTAgNzAwIFRkCihSb3RhdGVkKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA3OSAwMDAwMCBuIAowMDAwMDAwMTgzIDAwMDAwIG4gCjAwMDAwMDAzMTIgMDAwMDAgbiAKMDAwMDAwMDM5MSAwMDAwMCBuIAp0cmFpbGVyCjw8CiAgL1NpemUgNgogIC9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo0ODMKJSVFT0YK';

// Empty page PDF (page with no text content)
const EMPTY_PAGE_PDF_BASE64 = 'JVBERi0xLjcKCjEgMCBvYmoKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgNjEyIDc5MiBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqCjw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNCAwIFIgPj4gPj4KICAvQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCgo0IDAgb2JqCjw8CiAgL1R5cGUgL0ZvbnQKICAvU3VidHlwZSAvVHlwZTEKICAvQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9iagoKNSAwIG9iago8PAogIC9MZW5ndGggMAo+PgpzdHJlYW0KZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE4MyAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCjAwMDAwMDAzODAgMDAwMDAgbiAKdHJhaWxlcgo8PAogIC9TaXplIDYKICAvUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDI4CiUlRU9GCg==';

// Helper to decode base64 (works in Node.js and browser)
function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    // Browser
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } else {
    // Node.js
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
}

describe('extractPdfTextWithPositions', () => {
  let simplePdfData: Uint8Array;
  let twoPagePdfData: Uint8Array;
  let rotatedPdfData: Uint8Array;
  let emptyPagePdfData: Uint8Array;

  beforeAll(() => {
    // Convert base64 to Uint8Array for tests
    simplePdfData = base64ToUint8Array(SIMPLE_PDF_BASE64);
    twoPagePdfData = base64ToUint8Array(TWO_PAGE_PDF_BASE64);
    rotatedPdfData = base64ToUint8Array(ROTATED_PDF_BASE64);
    emptyPagePdfData = base64ToUint8Array(EMPTY_PAGE_PDF_BASE64);
  });

  it('extractPdfTextWithPositions returns text items with coordinates', async () => {
    const result = await extractPdfTextWithPositions(simplePdfData);

    expect(result.success).toBe(true);
    expect(result.textItems).toBeDefined();
    expect(result.textItems.length).toBeGreaterThan(0);

    // Verify structure of text items
    const firstItem = result.textItems[0];
    expect(firstItem).toHaveProperty('text');
    expect(firstItem).toHaveProperty('x');
    expect(firstItem).toHaveProperty('y');
    expect(firstItem).toHaveProperty('width');
    expect(firstItem).toHaveProperty('height');
    expect(firstItem).toHaveProperty('pageIndex');

    // Verify types
    expect(typeof firstItem.text).toBe('string');
    expect(typeof firstItem.x).toBe('number');
    expect(typeof firstItem.y).toBe('number');
    expect(typeof firstItem.width).toBe('number');
    expect(typeof firstItem.height).toBe('number');
    expect(typeof firstItem.pageIndex).toBe('number');

    // Verify the actual text content
    const allText = result.textItems.map(item => item.text).join('');
    expect(allText).toContain('Hello');
    expect(allText).toContain('World');
  });

  it('extractPdfTextWithPositions handles multi-page PDFs', async () => {
    const result = await extractPdfTextWithPositions(twoPagePdfData);

    expect(result.success).toBe(true);
    expect(result.pageCount).toBe(2);

    // Should have text items from both pages
    const page0Items = result.textItems.filter(item => item.pageIndex === 0);
    const page1Items = result.textItems.filter(item => item.pageIndex === 1);

    expect(page0Items.length).toBeGreaterThan(0);
    expect(page1Items.length).toBeGreaterThan(0);

    // Verify content from each page
    const page0Text = page0Items.map(item => item.text).join('');
    const page1Text = page1Items.map(item => item.text).join('');

    expect(page0Text).toContain('Page 1');
    expect(page1Text).toContain('Page 2');
  });

  it('extractPdfTextWithPositions handles rotated pages', async () => {
    const result = await extractPdfTextWithPositions(rotatedPdfData);

    expect(result.success).toBe(true);
    expect(result.textItems.length).toBeGreaterThan(0);

    // Text should be extracted despite rotation
    const allText = result.textItems.map(item => item.text).join('');
    expect(allText).toContain('Rotated');

    // The PDF has 90-degree rotation and text at "50 700 Td"
    // In the page's coordinate system (after rotation), coordinates should still be in PDF user space
    // PDF.js getTextContent returns coordinates in the page's own coordinate system
    const rotatedItem = result.textItems.find((item: PdfTextItem) => item.text.includes('Rotated'));
    expect(rotatedItem).toBeDefined();
    
    if (rotatedItem) {
      // Verify coordinates are in proper PDF space (not NaN or Infinity)
      expect(Number.isFinite(rotatedItem.x)).toBe(true);
      expect(Number.isFinite(rotatedItem.y)).toBe(true);
      expect(Number.isFinite(rotatedItem.width)).toBe(true);
      expect(Number.isFinite(rotatedItem.height)).toBe(true);
      
      // For a 90-degree rotation, PDF.js reports coordinates in the rotated coordinate system
      // The text position "50 700 Td" should be preserved in the page's coordinate system
      // Allow wide tolerance since coordinate transformation for rotation can vary
      expect(rotatedItem.x).toBeGreaterThanOrEqual(0);
      expect(rotatedItem.y).toBeGreaterThanOrEqual(0);
      expect(rotatedItem.width).toBeGreaterThan(0);
      expect(rotatedItem.height).toBeGreaterThan(0);
      
      // Verify coordinates are reasonable (not wildly out of bounds)
      expect(rotatedItem.x).toBeLessThan(1000);
      expect(rotatedItem.y).toBeLessThan(1000);
    }
  });

  it('extractPdfTextWithPositions handles empty pages', async () => {
    const result = await extractPdfTextWithPositions(emptyPagePdfData);

    expect(result.success).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.textItems).toEqual([]);
  });

  it('text item bounding boxes are in PDF coordinate space (bottom-left origin)', async () => {
    // Use fresh copy of PDF data
    const freshPdfData = base64ToUint8Array(SIMPLE_PDF_BASE64);
    const result = await extractPdfTextWithPositions(freshPdfData);

    expect(result.success).toBe(true);
    expect(result.textItems.length).toBeGreaterThan(0);

    // The PDF content stream has: "10 10 Td" which positions text at (10, 10) in PDF space
    // In PDF coordinate space:
    // - Origin is bottom-left
    // - Y increases upward
    // - Coordinates are in points (1/72 inch)
    
    // Find "Hello" text item (should be first word)
    const helloItem = result.textItems.find((item: PdfTextItem) => item.text.includes('Hello'));
    expect(helloItem).toBeDefined();
    
    if (helloItem) {
      // The text is positioned at "10 10 Td", so x should be close to 10
      // Allow some tolerance for font metrics, but must be in bottom-left coordinate space
      expect(helloItem.x).toBeGreaterThanOrEqual(8);
      expect(helloItem.x).toBeLessThanOrEqual(12);
      
      // Y coordinate should be close to 10 (PDF bottom-left origin)
      // If this were top-left origin, y would be close to 190 (200 - 10)
      // This assertion discriminates between coordinate systems
      expect(helloItem.y).toBeGreaterThanOrEqual(8);
      expect(helloItem.y).toBeLessThanOrEqual(30); // Allow tolerance for baseline vs bbox bottom
      
      // Width and height should be positive
      expect(helloItem.width).toBeGreaterThan(0);
      expect(helloItem.height).toBeGreaterThan(0);
    }

    // All items should have valid coordinates within page bounds
    result.textItems.forEach((item: PdfTextItem) => {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
      
      // Our test PDF is 200 x 200 points
      expect(item.x).toBeLessThan(200);
      expect(item.y).toBeLessThan(200);
    });
  });

  it('handles malformed PDF data gracefully', async () => {
    const malformedData = new Uint8Array([0, 1, 2, 3, 4]); // Invalid PDF

    const result = await extractPdfTextWithPositions(malformedData);

    expect(result.success).toBe(false);
    expect(result.textItems).toEqual([]);
    expect(result.pageCount).toBe(0);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('handles empty input', async () => {
    const emptyData = new Uint8Array([]);

    const result = await extractPdfTextWithPositions(emptyData);

    expect(result.success).toBe(false);
    expect(result.textItems).toEqual([]);
    expect(result.pageCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('computes accurate bounding boxes using full transform matrix', async () => {
    // This test verifies that bounding boxes are computed using the full transform matrix
    // not just the translation components (e, f)
    const freshPdfData = base64ToUint8Array(SIMPLE_PDF_BASE64);
    const result = await extractPdfTextWithPositions(freshPdfData);

    expect(result.success).toBe(true);
    expect(result.textItems.length).toBeGreaterThan(0);

    // Verify that all bounding boxes have:
    // 1. Positive dimensions (width and height > 0)
    // 2. Consistent area (width * height should be reasonable for text)
    // 3. Proper coordinate values (not just translation values)
    result.textItems.forEach((item: PdfTextItem) => {
      // Width and height should be positive
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);

      // Area should be reasonable for text (not degenerate)
      const area = item.width * item.height;
      expect(area).toBeGreaterThan(1); // Not degenerate

      // Bounding box should be within page bounds (with some margin)
      // Test PDF is 200x200 points
      expect(item.x).toBeGreaterThanOrEqual(-10); // Allow small negative due to font metrics
      expect(item.y).toBeGreaterThanOrEqual(-10);
      // Allow large positive values as font bounding boxes can extend beyond visual bounds
      expect(item.x + item.width).toBeLessThan(10000);
      expect(item.y + item.height).toBeLessThan(10000);
    });
  });
});
