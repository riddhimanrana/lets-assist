import { describe, expect, it } from 'vitest';

import {
  isPendingReportStatus,
  matchesReportStatusFilter,
  normalizeReportStatus,
} from './report-status';

describe('report status normalization', () => {
  it('maps null/empty values to pending', () => {
    expect(normalizeReportStatus(null)).toBe('pending');
    expect(normalizeReportStatus(undefined)).toBe('pending');
    expect(normalizeReportStatus('')).toBe('pending');
  });

  it('maps legacy pending aliases to pending', () => {
    expect(normalizeReportStatus('pending_review')).toBe('pending');
    expect(normalizeReportStatus('open')).toBe('pending');
    expect(normalizeReportStatus('new')).toBe('pending');
  });

  it('maps review aliases to under_review', () => {
    expect(normalizeReportStatus('in_review')).toBe('under_review');
    expect(normalizeReportStatus('under-review')).toBe('under_review');
    expect(normalizeReportStatus('reviewing')).toBe('under_review');
  });

  it('maps resolved and dismissed aliases correctly', () => {
    expect(normalizeReportStatus('closed')).toBe('resolved');
    expect(normalizeReportStatus('false_positive')).toBe('dismissed');
  });

  it('treats unknown values as pending fallback', () => {
    expect(normalizeReportStatus('totally_custom_status')).toBe('pending');
  });
});

describe('report status filters', () => {
  it('matches using normalized status', () => {
    expect(matchesReportStatusFilter('pending_review', 'pending')).toBe(true);
    expect(matchesReportStatusFilter('closed', 'resolved')).toBe(true);
    expect(matchesReportStatusFilter('in_review', 'under_review')).toBe(true);
  });

  it('returns true when no filter is provided', () => {
    expect(matchesReportStatusFilter('anything')).toBe(true);
  });

  it('checks pending helper from normalized value', () => {
    expect(isPendingReportStatus('pending')).toBe(true);
    expect(isPendingReportStatus('pending_review')).toBe(true);
    expect(isPendingReportStatus('resolved')).toBe(false);
  });
});