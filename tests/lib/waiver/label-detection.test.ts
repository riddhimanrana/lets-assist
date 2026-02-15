import { describe, it, expect } from 'vitest';
import { findLabels, DetectedLabel } from '../../../lib/waiver/label-detection';
import { PdfTextItem } from '../../../lib/waiver/pdf-text-extract';

describe('findLabels', () => {
  it('detects signature labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: 'Sign Here:', x: 50, y: 200, width: 60, height: 12, pageIndex: 0 },
      { text: 'Signer Signature', x: 50, y: 300, width: 100, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const signatureLabels = labels.filter(l => l.type === 'signature');
    expect(signatureLabels.length).toBe(3);

    // Verify all have signature type
    signatureLabels.forEach(label => {
      expect(label.type).toBe('signature');
      expect(label.text).toBeDefined();
      expect(label.normalizedText).toBeDefined();
      expect(label.rect).toBeDefined();
      expect(label.pageIndex).toBe(0);
    });
  });

  it('detects date labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Date:', x: 50, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: 'Signed on:', x: 50, y: 200, width: 70, height: 12, pageIndex: 0 },
      { text: 'Date Signed', x: 50, y: 300, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const dateLabels = labels.filter(l => l.type === 'date');
    expect(dateLabels.length).toBe(3);

    dateLabels.forEach(label => {
      expect(label.type).toBe('date');
    });
  });

  it('detects printed name labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Print Name:', x: 50, y: 100, width: 70, height: 12, pageIndex: 0 },
      { text: 'Printed Name', x: 50, y: 200, width: 80, height: 12, pageIndex: 0 },
      { text: 'Name:', x: 50, y: 300, width: 40, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const nameLabels = labels.filter(l => l.type === 'printed_name');
    expect(nameLabels.length).toBe(3);

    nameLabels.forEach(label => {
      expect(label.type).toBe('printed_name');
    });
  });

  it('detects parent/guardian labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Parent Signature:', x: 50, y: 100, width: 100, height: 12, pageIndex: 0 },
      { text: 'Guardian:', x: 50, y: 200, width: 60, height: 12, pageIndex: 0 },
      { text: 'Parent/Guardian Name', x: 50, y: 300, width: 120, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const parentLabels = labels.filter(l => l.type === 'parent_guardian');
    expect(parentLabels.length).toBe(3);

    parentLabels.forEach(label => {
      expect(label.type).toBe('parent_guardian');
    });
  });

  it('detects initials labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Initials:', x: 50, y: 100, width: 50, height: 12, pageIndex: 0 },
      { text: 'Initial here:', x: 50, y: 200, width: 70, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const initialsLabels = labels.filter(l => l.type === 'initials');
    expect(initialsLabels.length).toBe(2);

    initialsLabels.forEach(label => {
      expect(label.type).toBe('initials');
    });
  });

  it('detects witness labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Witness:', x: 50, y: 100, width: 50, height: 12, pageIndex: 0 },
      { text: 'Witness Signature', x: 50, y: 200, width: 100, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    const witnessLabels = labels.filter(l => l.type === 'witness');
    expect(witnessLabels.length).toBe(2);

    witnessLabels.forEach(label => {
      expect(label.type).toBe('witness');
    });
  });

  it('is case-insensitive', () => {
    const textItems: PdfTextItem[] = [
      { text: 'SIGNATURE:', x: 50, y: 100, width: 70, height: 12, pageIndex: 0 },
      { text: 'signature:', x: 50, y: 200, width: 70, height: 12, pageIndex: 0 },
      { text: 'SiGnAtUrE:', x: 50, y: 300, width: 70, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    expect(labels.length).toBe(3);
    labels.forEach(label => {
      expect(label.type).toBe('signature');
    });
  });

  it('preserves exact rect from source text item', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 123.45, y: 678.90, width: 88.25, height: 14.5, pageIndex: 1 },
    ];

    const labels = findLabels(textItems);

    expect(labels.length).toBe(1);
    expect(labels[0].rect).toEqual({
      x: 123.45,
      y: 678.90,
      width: 88.25,
      height: 14.5,
    });
    expect(labels[0].pageIndex).toBe(1);
  });

  it('handles multi-page inputs', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: 'Date:', x: 50, y: 200, width: 40, height: 12, pageIndex: 1 },
      { text: 'Name:', x: 50, y: 300, width: 40, height: 12, pageIndex: 2 },
    ];

    const labels = findLabels(textItems);

    expect(labels.length).toBe(3);
    expect(labels.find(l => l.pageIndex === 0)?.type).toBe('signature');
    expect(labels.find(l => l.pageIndex === 1)?.type).toBe('date');
    expect(labels.find(l => l.pageIndex === 2)?.type).toBe('printed_name');
  });

  it('avoids overfiring on generic words', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Name of Organization:', x: 50, y: 100, width: 120, height: 12, pageIndex: 0 },
      { text: 'Project name must be entered.', x: 50, y: 200, width: 180, height: 12, pageIndex: 0 },
      { text: 'The date is important.', x: 50, y: 300, width: 140, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    // These should not be detected as labels because they're in long sentences
    // or don't have the expected patterns (like colons or specific phrases)
    const nameLabels = labels.filter(l => l.type === 'printed_name');
    expect(nameLabels.length).toBe(0);

    const dateLabels = labels.filter(l => l.type === 'date');
    expect(dateLabels.length).toBe(0);
  });

  it('generates deterministic IDs', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
    ];

    const labels1 = findLabels(textItems);
    const labels2 = findLabels(textItems);

    expect(labels1[0].id).toBe(labels2[0].id);
    expect(labels1[0].id).toBeDefined();
    expect(labels1[0].id.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty input', () => {
    const labels = findLabels([]);
    expect(labels).toEqual([]);
  });

  it('returns empty array for text with no labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Lorem ipsum dolor sit amet', x: 50, y: 100, width: 150, height: 12, pageIndex: 0 },
      { text: 'consectetur adipiscing elit', x: 50, y: 200, width: 140, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);
    expect(labels).toEqual([]);
  });

  it('assigns confidence scores', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: 'Date:', x: 50, y: 200, width: 40, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    expect(labels.length).toBe(2);
    labels.forEach(label => {
      expect(label.confidence).toBeGreaterThan(0);
      expect(label.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('normalizes text for comparison', () => {
    const textItems: PdfTextItem[] = [
      { text: '  Signature: ', x: 50, y: 100, width: 70, height: 12, pageIndex: 0 },
      { text: 'DATE:', x: 50, y: 200, width: 40, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    expect(labels.length).toBe(2);
    expect(labels[0].normalizedText).not.toContain('  ');
    expect(labels[0].normalizedText).toBe(labels[0].normalizedText.toLowerCase());
  });

  it('avoids false positives with word boundaries for date', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Please update the form', x: 50, y: 100, width: 140, height: 12, pageIndex: 0 },
      { text: 'candidate information', x: 50, y: 200, width: 130, height: 12, pageIndex: 0 },
      { text: 'Date:', x: 50, y: 300, width: 40, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    // "update" contains "date" but should not trigger
    const updateLabel = labels.find((l: DetectedLabel) => l.text.toLowerCase().includes('update'));
    expect(updateLabel).toBeUndefined();

    // "candidate" contains "date" but should not trigger
    const candidateLabel = labels.find((l: DetectedLabel) => l.text.toLowerCase().includes('candidate') && l.type === 'date');
    expect(candidateLabel).toBeUndefined();

    // "Date:" should be detected
    const dateLabel = labels.find((l: DetectedLabel) => l.text === 'Date:');
    expect(dateLabel).toBeDefined();
    expect(dateLabel?.type).toBe('date');
  });

  it('avoids false positives with word boundaries for guardian', () => {
    const textItems: PdfTextItem[] = [
      { text: 'safeguarding policy', x: 50, y: 100, width: 120, height: 12, pageIndex: 0 },
      { text: 'Guardian:', x: 50, y: 200, width: 60, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    // "safeguarding" contains "guardian" but should not trigger
    const safeguardLabel = labels.find((l: DetectedLabel) => l.text.toLowerCase().includes('safeguard'));
    expect(safeguardLabel).toBeUndefined();

    // "Guardian:" should be detected
    const guardianLabel = labels.find((l: DetectedLabel) => l.text === 'Guardian:');
    expect(guardianLabel).toBeDefined();
    expect(guardianLabel?.type).toBe('parent_guardian');
  });

  it('uses word boundaries for signature detection', () => {
    const textItems: PdfTextItem[] = [
      { text: 'assignment of rights', x: 50, y: 100, width: 120, height: 12, pageIndex: 0 },
      { text: 'Signature:', x: 50, y: 200, width: 60, height: 12, pageIndex: 0 },
    ];

    const labels = findLabels(textItems);

    // "assignment" contains "sign" but should not trigger
    const assignmentLabel = labels.find((l: DetectedLabel) => l.text.toLowerCase().includes('assignment') && l.type === 'signature');
    expect(assignmentLabel).toBeUndefined();

    // "Signature:" should be detected
    const signatureLabel = labels.find((l: DetectedLabel) => l.text === 'Signature:');
    expect(signatureLabel).toBeDefined();
    expect(signatureLabel?.type).toBe('signature');
  });
});
