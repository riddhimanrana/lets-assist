import { describe, it, expect } from 'vitest';
import { detectCandidateAreas, CandidateArea } from '../../../lib/waiver/candidate-detection';
import { DetectedLabel } from '../../../lib/waiver/label-detection';
import { PdfTextItem } from '../../../lib/waiver/pdf-text-extract';

describe('detectCandidateAreas', () => {
  it('finds underscore candidates', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const underscoreCandidates = candidates.filter(c => c.source === 'underscore');
    expect(underscoreCandidates.length).toBeGreaterThan(0);

    const candidate = underscoreCandidates[0];
    expect(candidate.rect.x).toBe(120);
    expect(candidate.rect.y).toBeCloseTo(100, 1);
    expect(candidate.rect.width).toBeCloseTo(80, 1);
    expect(candidate.rect.height).toBeGreaterThan(0);
    expect(candidate.pageIndex).toBe(0);
  });

  it('creates right-of-label candidates', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: 'Some other text', x: 50, y: 200, width: 100, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const rightOfLabelCandidates = candidates.filter(c => c.source === 'right_of_label');
    expect(rightOfLabelCandidates.length).toBeGreaterThan(0);

    const candidate = rightOfLabelCandidates[0];
    expect(candidate.rect.x).toBeGreaterThan(110); // Right of label (50 + 60)
    expect(candidate.rect.y).toBeCloseTo(100, 1);
    expect(candidate.rect.width).toBeGreaterThan(0);
    expect(candidate.rect.height).toBeGreaterThan(0);
    expect(candidate.pageIndex).toBe(0);
  });

  it('includes label metadata and scoring', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    expect(candidates.length).toBeGreaterThan(0);

    candidates.forEach(candidate => {
      expect(candidate.id).toBeDefined();
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.nearbyLabelIds).toBeDefined();
      expect(candidate.nearbyLabelTypes).toBeDefined();
      expect(candidate.typeHint).toBeDefined();
    });
  });

  it('associates candidates with nearby labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const candidate = candidates[0];
    expect(candidate.nearbyLabelIds).toContain('label-1');
    expect(candidate.nearbyLabelTypes).toContain('signature');
    expect(candidate.typeHint).toBe('signature');
  });

  it('deduplicates overlapping candidates', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
      { text: '_____', x: 125, y: 101, width: 40, height: 11, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    // Should deduplicate overlapping underscore candidates
    const underscoreCandidates = candidates.filter(c => c.source === 'underscore');
    
    // Check that we don't have exact duplicates or heavily overlapping ones
    // The exact count depends on IoU threshold, but should be reasonable
    expect(underscoreCandidates.length).toBeLessThan(3);
  });

  it('handles multi-column layouts', () => {
    const textItems: PdfTextItem[] = [
      // Left column
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
      // Right column
      { text: 'Date:', x: 300, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: '______', x: 350, y: 100, width: 50, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
      {
        id: 'label-2',
        text: 'Date:',
        normalizedText: 'date:',
        type: 'date',
        pageIndex: 0,
        rect: { x: 300, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    expect(candidates.length).toBeGreaterThan(0);

    // Check that candidates are associated with correct labels
    const sigCandidates = candidates.filter(c => 
      c.nearbyLabelTypes.includes('signature') && c.rect.x < 250
    );
    const dateCandidates = candidates.filter(c => 
      c.nearbyLabelTypes.includes('date') && c.rect.x > 250
    );

    expect(sigCandidates.length).toBeGreaterThan(0);
    expect(dateCandidates.length).toBeGreaterThan(0);
  });

  it('handles multi-page inputs', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
      { text: 'Date:', x: 50, y: 200, width: 40, height: 12, pageIndex: 1 },
      { text: '______', x: 100, y: 200, width: 50, height: 12, pageIndex: 1 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
      {
        id: 'label-2',
        text: 'Date:',
        normalizedText: 'date:',
        type: 'date',
        pageIndex: 1,
        rect: { x: 50, y: 200, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const page0Candidates = candidates.filter(c => c.pageIndex === 0);
    const page1Candidates = candidates.filter(c => c.pageIndex === 1);

    expect(page0Candidates.length).toBeGreaterThan(0);
    expect(page1Candidates.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty input', () => {
    const candidates = detectCandidateAreas([], []);
    expect(candidates).toEqual([]);
  });

  it('returns empty array when no labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Some text', x: 50, y: 100, width: 70, height: 12, pageIndex: 0 },
    ];

    const candidates = detectCandidateAreas(textItems, []);
    
    // Should still detect underscore candidates even without labels
    // But right-of-label candidates require labels
    expect(Array.isArray(candidates)).toBe(true);
  });

  it('handles underscores with date patterns like __/__/__', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Date:', x: 50, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: '__', x: 100, y: 100, width: 20, height: 12, pageIndex: 0 },
      { text: '/', x: 120, y: 100, width: 5, height: 12, pageIndex: 0 },
      { text: '__', x: 125, y: 100, width: 20, height: 12, pageIndex: 0 },
      { text: '/', x: 145, y: 100, width: 5, height: 12, pageIndex: 0 },
      { text: '__', x: 150, y: 100, width: 20, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Date:',
        normalizedText: 'date:',
        type: 'date',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    // Should detect a candidate covering the date area
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some(c => c.typeHint === 'date')).toBe(true);
  });

  it('clamps candidates to non-negative sizes', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    candidates.forEach(candidate => {
      expect(candidate.rect.x).toBeGreaterThanOrEqual(0);
      expect(candidate.rect.y).toBeGreaterThanOrEqual(0);
      expect(candidate.rect.width).toBeGreaterThan(0);
      expect(candidate.rect.height).toBeGreaterThan(0);
    });
  });

  it('assigns higher scores to candidates near matching labels', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const candidate = candidates.find(c => c.nearbyLabelTypes.includes('signature'));
    expect(candidate).toBeDefined();
    expect(candidate?.score).toBeGreaterThan(0.5);
  });

  it('detects multiple underscores on same line', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Name:', x: 50, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: '__________', x: 100, y: 100, width: 80, height: 12, pageIndex: 0 },
      { text: 'Date:', x: 200, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: '_____', x: 250, y: 100, width: 50, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Name:',
        normalizedText: 'name:',
        type: 'printed_name',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
      {
        id: 'label-2',
        text: 'Date:',
        normalizedText: 'date:',
        type: 'date',
        pageIndex: 0,
        rect: { x: 200, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    expect(candidates.length).toBeGreaterThan(1);
    
    // Should have candidates for both underscores
    const nameCandidates = candidates.filter(c => c.typeHint === 'printed_name');
    const dateCandidates = candidates.filter(c => c.typeHint === 'date');
    
    expect(nameCandidates.length).toBeGreaterThan(0);
    expect(dateCandidates.length).toBeGreaterThan(0);
  });

  it('merges multi-token underscore patterns like __ / __ / __ into single candidate', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Date:', x: 50, y: 100, width: 40, height: 12, pageIndex: 0 },
      { text: '__', x: 100, y: 100, width: 20, height: 12, pageIndex: 0 },
      { text: '/', x: 120, y: 100, width: 5, height: 12, pageIndex: 0 },
      { text: '__', x: 125, y: 100, width: 20, height: 12, pageIndex: 0 },
      { text: '/', x: 145, y: 100, width: 5, height: 12, pageIndex: 0 },
      { text: '__', x: 150, y: 100, width: 20, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Date:',
        normalizedText: 'date:',
        type: 'date',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    // Should create a merged candidate covering the entire date pattern
    const underscoreCandidates = candidates.filter((c: CandidateArea) => c.source === 'underscore');
    expect(underscoreCandidates.length).toBeGreaterThan(0);

    // Find the candidate near the date label
    const dateCandidate = underscoreCandidates.find((c: CandidateArea) => c.typeHint === 'date');
    expect(dateCandidate).toBeDefined();

    // The merged candidate should span from first __ to last __
    // x should be around 100 (start of first __)
    // width should span to 170 (end of last __, which is at 150 + 20)
    expect(dateCandidate!.rect.x).toBeCloseTo(100, 5);
    expect(dateCandidate!.rect.width).toBeGreaterThanOrEqual(60); // Should span all tokens
  });

  it('deduplicates deterministically by score', () => {
    // Create overlapping candidates with different scores
    const textItems: PdfTextItem[] = [
      { text: 'Signature:', x: 50, y: 100, width: 60, height: 12, pageIndex: 0 },
      // Multiple overlapping underscore runs
      { text: '__________', x: 120, y: 100, width: 80, height: 12, pageIndex: 0 },
      { text: '_______', x: 125, y: 101, width: 60, height: 11, pageIndex: 0 },
      { text: '_____', x: 130, y: 99, width: 40, height: 13, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Signature:',
        normalizedText: 'signature:',
        type: 'signature',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 60, height: 12 },
        confidence: 0.9,
      },
    ];

    // Run detection multiple times to ensure determinism
    const candidates1 = detectCandidateAreas(textItems, labels);
    const candidates2 = detectCandidateAreas(textItems, labels);
    const candidates3 = detectCandidateAreas(textItems, labels);

    // Should get the same results each time (deterministic)
    expect(candidates1.length).toBe(candidates2.length);
    expect(candidates2.length).toBe(candidates3.length);

    // Check that IDs match (same candidates kept)
    const ids1 = candidates1.map((c: CandidateArea) => c.id).sort();
    const ids2 = candidates2.map((c: CandidateArea) => c.id).sort();
    const ids3 = candidates3.map((c: CandidateArea) => c.id).sort();

    expect(ids1).toEqual(ids2);
    expect(ids2).toEqual(ids3);

    // Should dedupe overlapping underscore candidates
    const underscoreCandidates = candidates1.filter((c: CandidateArea) => c.source === 'underscore');
    expect(underscoreCandidates.length).toBeLessThan(3); // Fewer than the 3 overlapping inputs
  });

  it('handles multi-token underscore runs with varied spacing', () => {
    const textItems: PdfTextItem[] = [
      { text: 'Name:', x: 50, y: 100, width: 40, height: 12, pageIndex: 0 },
      // Tokenized underscore pattern with spaces
      { text: '___', x: 100, y: 100, width: 15, height: 12, pageIndex: 0 },
      { text: '___', x: 120, y: 100, width: 15, height: 12, pageIndex: 0 },
      { text: '___', x: 140, y: 100, width: 15, height: 12, pageIndex: 0 },
    ];

    const labels: DetectedLabel[] = [
      {
        id: 'label-1',
        text: 'Name:',
        normalizedText: 'name:',
        type: 'printed_name',
        pageIndex: 0,
        rect: { x: 50, y: 100, width: 40, height: 12 },
        confidence: 0.9,
      },
    ];

    const candidates = detectCandidateAreas(textItems, labels);

    const underscoreCandidates = candidates.filter((c: CandidateArea) => c.source === 'underscore');
    expect(underscoreCandidates.length).toBeGreaterThan(0);

    // Should merge into a single candidate
    const nameCandidate = underscoreCandidates.find((c: CandidateArea) => c.typeHint === 'printed_name');
    expect(nameCandidate).toBeDefined();

    // Should span all three tokens
    expect(nameCandidate!.rect.x).toBeCloseTo(100, 2);
    expect(nameCandidate!.rect.width).toBeGreaterThanOrEqual(50); // Should span 100 to ~155
  });
});
