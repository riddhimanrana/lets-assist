import { PdfTextItem } from './pdf-text-extract';
import { DetectedLabel, WaiverLabelType } from './label-detection';
import { createHash } from 'crypto';

/**
 * A candidate writable area detected in a waiver PDF
 */
export interface CandidateArea {
  id: string;
  pageIndex: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  typeHint: WaiverLabelType;
  nearbyLabelIds: string[];
  nearbyLabelTypes: WaiverLabelType[];
  score: number;
  source: 'underscore' | 'right_of_label';
}

/**
 * Detect candidate writable areas in a PDF based on text heuristics.
 * 
 * Generates candidates from:
 * 1. Underscore runs in text (e.g., "________" or "__ / __ / __")
 * 2. Writable gaps to the right of label text
 * 
 * Candidates include metadata about nearby labels, type hints, and scoring
 * for proximity and label compatibility.
 * 
 * Coordinates are in PDF bottom-left coordinate space.
 * 
 * @param textItems - PDF text items with positions
 * @param labels - Detected labels from findLabels()
 * @returns Array of candidate areas with metadata
 */
export function detectCandidateAreas(
  textItems: PdfTextItem[],
  labels: DetectedLabel[]
): CandidateArea[] {
  if (!textItems || textItems.length === 0) {
    return [];
  }

  const candidates: CandidateArea[] = [];

  // Group text items by page for efficient processing
  const itemsByPage = groupByPage(textItems);
  const labelsByPage = groupByPage(labels);

  // Detect underscore candidates from text
  for (const [pageIndex, items] of itemsByPage) {
    const pageLabels = labelsByPage.get(pageIndex) || [];
    candidates.push(...detectUnderscoreCandidates(items, pageLabels, pageIndex));
  }

  // Detect right-of-label candidates
  for (const label of labels) {
    const pageItems = itemsByPage.get(label.pageIndex) || [];
    const pageLabels = labelsByPage.get(label.pageIndex) || [];
    
    const rightCandidate = createRightOfLabelCandidate(
      label,
      pageItems,
      pageLabels
    );
    
    if (rightCandidate) {
      candidates.push(rightCandidate);
    }
  }

  // Deduplicate overlapping candidates per page
  const deduplicatedCandidates = deduplicateCandidates(candidates);

  return deduplicatedCandidates;
}

/**
 * Group items by page index
 */
function groupByPage<T extends { pageIndex: number }>(items: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  
  for (const item of items) {
    const existing = map.get(item.pageIndex) || [];
    existing.push(item);
    map.set(item.pageIndex, existing);
  }
  
  return map;
}

/**
 * Detect underscore candidates from text items, merging adjacent underscore tokens
 */
function detectUnderscoreCandidates(
  items: PdfTextItem[],
  labels: DetectedLabel[],
  pageIndex: number
): CandidateArea[] {
  const candidates: CandidateArea[] = [];

  // Group items by line to detect multi-token underscore patterns
  const lineGroups = groupItemsByLine(items);

  for (const lineItems of lineGroups) {
    // Find consecutive underscore-heavy tokens
    const underscoreRuns = findUnderscoreRuns(lineItems);

    for (const run of underscoreRuns) {
      // Merge the bounding boxes of all tokens in the run
      const mergedRect = mergeBoundingBoxes(run);

      // Create candidate from merged bbox
      const nearbyLabels = findNearbyLabels(mergedRect, labels);
      const typeHint = inferTypeFromLabels(nearbyLabels);
      const score = scoreCandidate(mergedRect, nearbyLabels);

      const id = generateCandidateId('underscore', mergedRect, pageIndex);

      candidates.push({
        id,
        pageIndex,
        rect: {
          x: mergedRect.x,
          y: mergedRect.y,
          width: mergedRect.width,
          height: Math.max(mergedRect.height, 14), // Minimum height for writing
        },
        typeHint,
        nearbyLabelIds: nearbyLabels.map(l => l.id),
        nearbyLabelTypes: nearbyLabels.map(l => l.type),
        score,
        source: 'underscore',
      });
    }
  }

  return candidates;
}

/**
 * Group text items by line based on vertical position
 */
function groupItemsByLine(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length === 0) return [];

  // Sort by y position
  const sorted = [...items].sort((a, b) => a.y - b.y);

  const lines: PdfTextItem[][] = [];
  let currentLine: PdfTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prevItem = sorted[i - 1];
    const prevCenterY = prevItem.y + prevItem.height / 2;
    const itemCenterY = item.y + item.height / 2;

    // If vertical distance is small (< 5pt), consider same line
    if (Math.abs(itemCenterY - prevCenterY) < 5) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Sort items within each line by x position
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }

  return lines;
}

/**
 * Find runs of consecutive underscore-heavy tokens on a line
 */
function findUnderscoreRuns(lineItems: PdfTextItem[]): PdfTextItem[][] {
  const runs: PdfTextItem[][] = [];
  let currentRun: PdfTextItem[] = [];

  for (const item of lineItems) {
    if (isUnderscoreToken(item.text)) {
      currentRun.push(item);
    } else {
      // If we hit a non-underscore token, save the current run if it's valid
      if (currentRun.length > 0 && isValidUnderscoreRun(currentRun)) {
        runs.push(currentRun);
      }
      currentRun = [];
    }
  }

  // Don't forget the last run
  if (currentRun.length > 0 && isValidUnderscoreRun(currentRun)) {
    runs.push(currentRun);
  }

  return runs;
}

/**
 * Check if a token is underscore-heavy (including slashes for date patterns)
 */
function isUnderscoreToken(text: string): boolean {
  // Remove slashes and whitespace to check underscore density
  const withoutSlashes = text.replace(/[/\s]/g, '');
  
  // Empty after removing slashes and spaces means it was just slashes (part of date pattern)
  if (withoutSlashes.length === 0) {
    return text.includes('/'); // Slashes between underscores count as part of pattern
  }

  const underscoreCount = (withoutSlashes.match(/_/g) || []).length;
  
  // Consider it an underscore token if:
  // 1. At least 2 underscores OR
  // 2. Underscores make up at least 60% of the text (after removing slashes)
  return (
    underscoreCount >= 2 ||
    (underscoreCount > 0 && underscoreCount / withoutSlashes.length >= 0.6)
  );
}

/**
 * Check if a run of tokens forms a valid underscore pattern
 */
function isValidUnderscoreRun(run: PdfTextItem[]): boolean {
  // Count total underscores across all tokens
  let totalUnderscores = 0;
  for (const item of run) {
    const withoutSlashes = item.text.replace(/[/\s]/g, '');
    totalUnderscores += (withoutSlashes.match(/_/g) || []).length;
  }

  // Valid if we have at least 3 total underscores
  return totalUnderscores >= 3;
}

/**
 * Merge bounding boxes of multiple items into a single rect
 */
function mergeBoundingBoxes(items: PdfTextItem[]): { x: number; y: number; width: number; height: number } {
  if (items.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (items.length === 1) {
    return {
      x: items[0].x,
      y: items[0].y,
      width: items[0].width,
      height: items[0].height,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Create a candidate area to the right of a label
 */
function createRightOfLabelCandidate(
  label: DetectedLabel,
  pageItems: PdfTextItem[],
  _pageLabels: DetectedLabel[]
): CandidateArea | null {
  // Calculate candidate position: just right of label, same baseline
  const candidateX = label.rect.x + label.rect.width + 5; // 5pt gap
  const candidateY = label.rect.y;
  const candidateHeight = Math.max(label.rect.height, 16);

  // Estimate width: find the next text item on the same line, or use reasonable default
  const maxPageWidth = estimatePageWidth(pageItems);
  let candidateWidth = Math.min(150, maxPageWidth - candidateX);

  // Check for next item on same line to constrain width
  const nextItem = findNextItemOnLine(label, pageItems);
  if (nextItem) {
    const maxWidth = nextItem.x - candidateX - 2; // 2pt gap before next item
    if (maxWidth > 20) {
      candidateWidth = Math.min(candidateWidth, maxWidth);
    }
  }

  // Validate candidate dimensions
  if (candidateX < 0 || candidateWidth <= 0) {
    return null;
  }

  const candidateRect = {
    x: candidateX,
    y: candidateY,
    width: candidateWidth,
    height: candidateHeight,
  };

  const score = scoreCandidate(candidateRect, [label]);

  const id = generateCandidateId('right_of_label', candidateRect, label.pageIndex);

  return {
    id,
    pageIndex: label.pageIndex,
    rect: {
      x: candidateX,
      y: candidateY,
      width: candidateWidth,
      height: candidateHeight,
    },
    typeHint: label.type,
    nearbyLabelIds: [label.id],
    nearbyLabelTypes: [label.type],
    score,
    source: 'right_of_label',
  };
}

/**
 * Find nearby labels for a text item or rect
 */
function findNearbyLabels(
  item: { x: number; y: number; width: number; height: number },
  labels: DetectedLabel[]
): DetectedLabel[] {
  const nearby: Array<{ label: DetectedLabel; distance: number }> = [];
  
  const itemCenterX = item.x + item.width / 2;
  const itemCenterY = item.y + item.height / 2;

  for (const label of labels) {
    const labelCenterX = label.rect.x + label.rect.width / 2;
    const labelCenterY = label.rect.y + label.rect.height / 2;
    
    const distance = Math.sqrt(
      Math.pow(itemCenterX - labelCenterX, 2) +
      Math.pow(itemCenterY - labelCenterY, 2)
    );
    
    // Consider labels within 200 points (roughly 2.8 inches)
    if (distance < 200) {
      nearby.push({ label, distance });
    }
  }

  // Sort by distance and return closest labels
  nearby.sort((a, b) => a.distance - b.distance);
  return nearby.slice(0, 3).map(n => n.label);
}

/**
 * Infer field type from nearby labels
 */
function inferTypeFromLabels(labels: DetectedLabel[]): WaiverLabelType {
  if (labels.length === 0) {
    return 'other';
  }

  // Use the closest label's type
  return labels[0].type;
}

/**
 * Score candidate based on proximity to labels and label compatibility
 */
function scoreCandidate(
  item: { x: number; y: number; width: number; height: number },
  nearbyLabels: DetectedLabel[]
): number {
  let score = 0.5; // Base score

  if (nearbyLabels.length === 0) {
    return score;
  }

  // Boost score for nearby labels
  const closestLabel = nearbyLabels[0];
  const distance = Math.sqrt(
    Math.pow(item.x - closestLabel.rect.x, 2) +
    Math.pow(item.y - closestLabel.rect.y, 2)
  );

  // Closer labels = higher score
  if (distance < 50) {
    score += 0.3;
  } else if (distance < 100) {
    score += 0.2;
  } else if (distance < 200) {
    score += 0.1;
  }

  // Boost for label confidence
  score += closestLabel.confidence * 0.2;

  return Math.min(1.0, score);
}

/**
 * Find the next text item on the same line (to the right)
 */
function findNextItemOnLine(
  label: DetectedLabel,
  items: PdfTextItem[]
): PdfTextItem | null {
  const labelRightEdge = label.rect.x + label.rect.width;
  const labelCenterY = label.rect.y + label.rect.height / 2;

  let closest: { item: PdfTextItem; distance: number } | null = null;

  for (const item of items) {
    const itemCenterY = item.y + item.height / 2;
    const verticalDistance = Math.abs(itemCenterY - labelCenterY);
    
    // Check if on same line (within 5 points vertically)
    if (verticalDistance < 5 && item.x > labelRightEdge) {
      const distance = item.x - labelRightEdge;
      
      if (!closest || distance < closest.distance) {
        closest = { item, distance };
      }
    }
  }

  return closest?.item || null;
}

/**
 * Estimate page width from text items
 */
function estimatePageWidth(items: PdfTextItem[]): number {
  if (items.length === 0) {
    return 612; // Default US Letter width
  }

  let maxX = 0;
  for (const item of items) {
    const rightEdge = item.x + item.width;
    if (rightEdge > maxX) {
      maxX = rightEdge;
    }
  }

  // Add some margin and use reasonable max
  return Math.min(maxX + 50, 800);
}

/**
 * Deduplicate overlapping candidates per page using IoU threshold.
 * Sorts by score descending first for deterministic results.
 */
function deduplicateCandidates(candidates: CandidateArea[]): CandidateArea[] {
  // Group by page
  const byPage = new Map<number, CandidateArea[]>();
  
  for (const candidate of candidates) {
    const existing = byPage.get(candidate.pageIndex) || [];
    existing.push(candidate);
    byPage.set(candidate.pageIndex, existing);
  }

  const deduplicated: CandidateArea[] = [];

  // Deduplicate within each page
  for (const [, pageCandidates] of byPage) {
    // Sort by score descending, then by id ascending for deterministic deduplication
    const sorted = [...pageCandidates].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });
    const kept: CandidateArea[] = [];

    for (const candidate of sorted) {
      // Check if this candidate overlaps significantly with any kept candidate
      const hasOverlap = kept.some(other => {
        const iou = calculateIoU(candidate.rect, other.rect);
        return iou > 0.5; // 50% IoU threshold
      });

      // Keep if no significant overlap with already-kept candidates
      if (!hasOverlap) {
        kept.push(candidate);
      }
    }

    deduplicated.push(...kept);
  }

  return deduplicated;
}

/**
 * Calculate Intersection over Union (IoU) for two rectangles
 */
function calculateIoU(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(rect1.x, rect2.x);
  const y1 = Math.max(rect1.y, rect2.y);
  const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0; // No overlap
  }

  const intersectionArea = (x2 - x1) * (y2 - y1);
  const area1 = rect1.width * rect1.height;
  const area2 = rect2.width * rect2.height;
  const unionArea = area1 + area2 - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

/**
 * Generate a deterministic ID for a candidate including width/height for stability
 */
function generateCandidateId(
  source: string,
  rect: { x: number; y: number; width: number; height: number },
  pageIndex: number
): string {
  const stableString = `${source}-${pageIndex}-${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
  
  const hash = createHash('sha256')
    .update(stableString)
    .digest('hex')
    .substring(0, 12);
  
  return `candidate-${hash}`;
}
