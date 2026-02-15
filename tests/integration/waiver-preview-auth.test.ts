import { describe, it, expect } from 'vitest';
import { checkWaiverAccess, getContentDisposition } from '@/lib/waiver/preview-auth-helpers';

/**
 * Phase 7 Tests: Waiver Preview Authorization Parity with Download Route
 * 
 * Tests the extracted authorization helper that supports:
 * - Organizer access (project creator or org admin/staff)
 * - Signer self-access (authenticated user tied to signature)
 * - Anonymous signer access with required anonymousSignupId validation
 * 
 * These tests validate real authorization logic used in preview/download routes.
 */

describe('Waiver Preview Authorization Logic (Phase 7)', () => {
  describe('Organizer Access', () => {
    it('should authorize project creator', () => {
      const result = checkWaiverAccess({
        currentUserId: 'creator-001',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'creator-001', organization_id: null },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('organizer');
      expect(result.details).toContain('project creator');
    });

    it('should authorize org admin', () => {
      const result = checkWaiverAccess({
        currentUserId: 'org-admin-123',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'different-creator', organization_id: 'org-001' },
        orgMember: { role: 'admin' },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('organizer');
      expect(result.details).toContain('org admin');
    });

    it('should authorize org staff', () => {
      const result = checkWaiverAccess({
        currentUserId: 'org-staff-456',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'different-creator', organization_id: 'org-001' },
        orgMember: { role: 'staff' },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('organizer');
      expect(result.details).toContain('org staff');
    });

    it('should reject org member with non-admin/staff role', () => {
      const result = checkWaiverAccess({
        currentUserId: 'org-member-789',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'different-creator', organization_id: 'org-001' },
        orgMember: { role: 'member' },
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
    });
  });

  describe('Signer Self-Access', () => {
    it('should authorize authenticated user who owns the signature', () => {
      const result = checkWaiverAccess({
        currentUserId: 'user-123',
        signature: { user_id: 'user-123', anonymous_id: null },
        project: { creator_id: 'different-creator', organization_id: null },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('signer');
      expect(result.details).toContain('owns this signature');
    });

    it('should reject authenticated user for other users signature', () => {
      const result = checkWaiverAccess({
        currentUserId: 'user-123',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'different-creator', organization_id: null },
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
    });
  });

  describe('Anonymous Signer Access', () => {
    it('should authorize anonymous access with matching anonymousSignupId', () => {
      const result = checkWaiverAccess({
        currentUserId: null,
        signature: { user_id: null, anonymous_id: 'anon-456' },
        project: { creator_id: 'creator-001', organization_id: null },
        anonymousSignupIdParam: 'anon-456',
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('anonymous');
      expect(result.details).toContain('Valid anonymous access');
    });

    it('should reject anonymous access without anonymousSignupId parameter', () => {
      const result = checkWaiverAccess({
        currentUserId: null,
        signature: { user_id: null, anonymous_id: 'anon-456' },
        project: { creator_id: 'creator-001', organization_id: null },
        anonymousSignupIdParam: null,
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
      expect(result.details).toContain('requires anonymousSignupId parameter');
    });

    it('should reject anonymous access with mismatched anonymousSignupId', () => {
      const result = checkWaiverAccess({
        currentUserId: null,
        signature: { user_id: null, anonymous_id: 'anon-456' },
        project: { creator_id: 'creator-001', organization_id: null },
        anonymousSignupIdParam: 'wrong-id-999',
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
      expect(result.details).toContain('Invalid anonymousSignupId parameter');
    });

    it('should reject anonymous access for non-anonymous signatures', () => {
      const result = checkWaiverAccess({
        currentUserId: null,
        signature: { user_id: 'user-123', anonymous_id: null },
        project: { creator_id: 'creator-001', organization_id: null },
        anonymousSignupIdParam: 'anon-456',
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
    });
  });

  describe('Authorization Priority', () => {
    it('should prioritize organizer access over signer access', () => {
      // User is both project creator AND the signer
      const result = checkWaiverAccess({
        currentUserId: 'user-123',
        signature: { user_id: 'user-123', anonymous_id: null },
        project: { creator_id: 'user-123', organization_id: null },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('organizer');
    });

    it('should grant access through any valid authorization path', () => {
      // User is org admin accessing someone else's signature
      const result = checkWaiverAccess({
        currentUserId: 'org-admin',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'another-user', organization_id: 'org-001' },
        orgMember: { role: 'admin' },
      });

      expect(result.hasPermission).toBe(true);
      expect(result.reason).toBe('organizer');
    });
  });

  describe('Content-Disposition Helper', () => {
    it('should generate inline disposition for preview', () => {
      const disposition = getContentDisposition(true, 'sig-123');
      
      expect(disposition).toContain('inline');
      expect(disposition).toContain('filename="waiver-sig-123.pdf"');
      expect(disposition).not.toContain('attachment');
    });

    it('should generate attachment disposition for download', () => {
      const disposition = getContentDisposition(false, 'sig-456');
      
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('filename="signed-waiver-sig-456.pdf"');
      expect(disposition).not.toContain('inline');
    });
  });

  describe('Edge Cases', () => {
    it('should reject unauthenticated user without anonymous_id in signature', () => {
      const result = checkWaiverAccess({
        currentUserId: null,
        signature: { user_id: 'user-123', anonymous_id: null },
        project: { creator_id: 'creator-001', organization_id: null },
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
    });

    it('should reject when no authorization path matches', () => {
      const result = checkWaiverAccess({
        currentUserId: 'random-user',
        signature: { user_id: 'different-user', anonymous_id: null },
        project: { creator_id: 'creator-001', organization_id: null },
      });

      expect(result.hasPermission).toBe(false);
      expect(result.reason).toBe('unauthorized');
      expect(result.details).toContain('No authorization path matched');
    });
  });
});
