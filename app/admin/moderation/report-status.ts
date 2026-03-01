export type CanonicalReportStatus =
  | 'pending'
  | 'under_review'
  | 'resolved'
  | 'dismissed'
  | 'escalated';

const PENDING_LIKE = new Set(['pending', 'pending_review', 'open', 'new', 'queued']);
const UNDER_REVIEW_LIKE = new Set([
  'under_review',
  'under-review',
  'in_review',
  'in-review',
  'reviewing',
  'investigating',
]);
const RESOLVED_LIKE = new Set(['resolved', 'closed', 'completed', 'done']);
const DISMISSED_LIKE = new Set(['dismissed', 'rejected', 'false_positive', 'false-positive']);
const ESCALATED_LIKE = new Set(['escalated', 'legal_review', 'legal-review']);

export function normalizeReportStatus(status: string | null | undefined): CanonicalReportStatus {
  const normalized = status?.trim()?.toLowerCase();

  if (!normalized) {
    return 'pending';
  }

  if (PENDING_LIKE.has(normalized)) {
    return 'pending';
  }

  if (UNDER_REVIEW_LIKE.has(normalized)) {
    return 'under_review';
  }

  if (RESOLVED_LIKE.has(normalized)) {
    return 'resolved';
  }

  if (DISMISSED_LIKE.has(normalized)) {
    return 'dismissed';
  }

  if (ESCALATED_LIKE.has(normalized)) {
    return 'escalated';
  }

  return 'pending';
}

export function matchesReportStatusFilter(
  status: string | null | undefined,
  filter?: CanonicalReportStatus,
) {
  if (!filter) {
    return true;
  }

  return normalizeReportStatus(status) === filter;
}

export function isPendingReportStatus(status: string | null | undefined) {
  return normalizeReportStatus(status) === 'pending';
}