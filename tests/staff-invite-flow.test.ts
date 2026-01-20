/**
 * Staff Invite Link End-to-End Test
 * Tests the complete flow of staff invite functionality
 * 
 * NOTE: Tests requiring database connection are skipped in CI.
 * Set SUPABASE_URL environment variable to run integration tests locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/utils/supabase/admin';

// Skip database-dependent tests in CI or when SUPABASE_URL is not set
const hasDatabase = !!process.env.SUPABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

describeWithDb('Staff Invite Link Flow', () => {
  let testOrgId: string;
  let testOrgUsername: string;
  let staffToken: string;
  let adminClient: ReturnType<typeof createAdminClient>;

  beforeAll(async () => {
    adminClient = createAdminClient();
    
    // Use an existing test organization (DVHS)
    const { data: org } = await adminClient
      .from('organizations')
      .select('id, username, staff_join_token, staff_join_token_expires_at')
      .eq('username', 'dvhs')
      .single();
    
    if (!org) {
      throw new Error('Test organization not found');
    }
    
    testOrgId = org.id;
    testOrgUsername = org.username;
    
    console.log('🧪 Testing with organization:', testOrgUsername);
  });

  describe('Database Schema', () => {
    it('should have staff_join_token columns in organizations table', async () => {
      const { data: columns } = await adminClient.rpc('exec_sql', {
        query: `
          SELECT column_name, data_type 
          FROM information_schema.columns
          WHERE table_name = 'organizations' 
            AND column_name LIKE 'staff_join%'
        `
      }).select('*');

      expect(columns).toBeDefined();
      // Should have 3 columns: token, created_at, expires_at
      expect(columns?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Token Generation', () => {
    it('should generate a valid UUID token', async () => {
      const testToken = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { data, error } = await adminClient
        .from('organizations')
        .update({
          staff_join_token: testToken,
          staff_join_token_created_at: new Date().toISOString(),
          staff_join_token_expires_at: expiresAt.toISOString(),
        })
        .eq('id', testOrgId)
        .select('staff_join_token, staff_join_token_expires_at')
        .single();

      expect(error).toBeNull();
      expect(data?.staff_join_token).toBe(testToken);
      expect(data?.staff_join_token_expires_at).toBeDefined();
      
      staffToken = testToken;
      console.log('✅ Token generated:', staffToken);
    });

    it('should have a valid expiration date in the future', async () => {
      const { data } = await adminClient
        .from('organizations')
        .select('staff_join_token_expires_at')
        .eq('id', testOrgId)
        .single();

      expect(data?.staff_join_token_expires_at).toBeDefined();
      const expiresAt = new Date(data!.staff_join_token_expires_at);
      const now = new Date();
      
      expect(expiresAt > now).toBe(true);
      console.log('✅ Token expires:', expiresAt.toISOString());
    });
  });

  describe('Token Validation', () => {
    it('should validate token matches organization username', async () => {
      const { data: org } = await adminClient
        .from('organizations')
        .select('username, staff_join_token, staff_join_token_expires_at')
        .eq('username', testOrgUsername)
        .single();

      expect(org).toBeDefined();
      expect(org?.staff_join_token).toBe(staffToken);
      console.log('✅ Token matches organization');
    });

    it('should check token expiration correctly', async () => {
      const { data: org } = await adminClient
        .from('organizations')
        .select('staff_join_token_expires_at')
        .eq('id', testOrgId)
        .single();

      const isExpired = org?.staff_join_token_expires_at 
        ? new Date(org.staff_join_token_expires_at) < new Date()
        : true;

      expect(isExpired).toBe(false);
      console.log('✅ Token is not expired');
    });

    it('should reject invalid token', async () => {
      const invalidToken = crypto.randomUUID();
      
      const { data: org } = await adminClient
        .from('organizations')
        .select('username, staff_join_token, staff_join_token_expires_at')
        .eq('username', testOrgUsername)
        .single();

      const isValid = org?.staff_join_token === invalidToken 
        && org?.staff_join_token_expires_at 
        && new Date(org.staff_join_token_expires_at) > new Date();

      expect(isValid).toBe(false);
      console.log('✅ Invalid token rejected');
    });
  });

  describe('Signup URL Format', () => {
    it('should construct correct signup URL', () => {
      const baseUrl = 'https://letsassist.org/signup';
      const signupUrl = `${baseUrl}?staff_token=${staffToken}&org=${testOrgUsername}`;
      
      expect(signupUrl).toContain('staff_token=');
      expect(signupUrl).toContain('org=');
      expect(signupUrl).toContain(staffToken);
      expect(signupUrl).toContain(testOrgUsername);
      
      console.log('✅ Signup URL:', signupUrl);
    });
  });

  describe('Organization Member Addition', () => {
    it('should verify organization_members table accepts staff role', async () => {
      // Check that the role constraint includes 'staff'
      const { data: constraints } = await adminClient.rpc('exec_sql', {
        query: `
          SELECT check_clause
          FROM information_schema.check_constraints
          WHERE constraint_name LIKE '%organization_members%role%'
        `
      }).select('*');

      // The constraint should allow 'admin', 'staff', 'member'
      const hasStaffRole = constraints?.some((c: any) => 
        c.check_clause?.includes("'staff'")
      );
      
      expect(hasStaffRole).toBe(true);
      console.log('✅ Staff role is allowed in organization_members');
    });

    it('should have correct foreign key relationships', async () => {
      const { data: fks } = await adminClient.rpc('exec_sql', {
        query: `
          SELECT 
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = 'organization_members'
        `
      }).select('*');

      expect(fks).toBeDefined();
      expect(fks?.length).toBeGreaterThan(0);
      
      // Should have FK to organizations and users
      const hasOrgFk = fks?.some((fk: any) => 
        fk.foreign_table_name === 'organizations'
      );
      const hasUserFk = fks?.some((fk: any) => 
        fk.foreign_table_name === 'users' || fk.column_name === 'user_id'
      );
      
      expect(hasOrgFk).toBe(true);
      expect(hasUserFk).toBe(true);
      console.log('✅ Foreign key relationships are correct');
    });
  });

  describe('Token Revocation', () => {
    it('should successfully revoke token', async () => {
      const { error } = await adminClient
        .from('organizations')
        .update({
          staff_join_token: null,
          staff_join_token_created_at: null,
          staff_join_token_expires_at: null,
        })
        .eq('id', testOrgId);

      expect(error).toBeNull();
      console.log('✅ Token revoked');
    });

    it('should verify token is null after revocation', async () => {
      const { data: org } = await adminClient
        .from('organizations')
        .select('staff_join_token')
        .eq('id', testOrgId)
        .single();

      expect(org?.staff_join_token).toBeNull();
      console.log('✅ Token is null after revocation');
    });
  });

  describe('Expiration Handling', () => {
    it('should handle expired tokens correctly', async () => {
      // Set an expired token
      const expiredToken = crypto.randomUUID();
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1); // Yesterday

      await adminClient
        .from('organizations')
        .update({
          staff_join_token: expiredToken,
          staff_join_token_created_at: new Date().toISOString(),
          staff_join_token_expires_at: expiredDate.toISOString(),
        })
        .eq('id', testOrgId);

      const { data: org } = await adminClient
        .from('organizations')
        .select('staff_join_token, staff_join_token_expires_at')
        .eq('id', testOrgId)
        .single();

      const isExpired = org?.staff_join_token_expires_at
        ? new Date(org.staff_join_token_expires_at) < new Date()
        : true;

      expect(isExpired).toBe(true);
      console.log('✅ Expired token detected correctly');
    });
  });

  afterAll(async () => {
    // Restore original token if it existed, or clear it
    const { data: originalOrg } = await adminClient
      .from('organizations')
      .select('staff_join_token')
      .eq('username', 'dvhs')
      .single();

    if (originalOrg) {
      // Generate a new valid token for DVHS
      const newToken = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await adminClient
        .from('organizations')
        .update({
          staff_join_token: newToken,
          staff_join_token_created_at: new Date().toISOString(),
          staff_join_token_expires_at: expiresAt.toISOString(),
        })
        .eq('id', testOrgId);
      
      console.log('🔄 Test organization token restored');
    }
  });
});

describe('Staff Invite Actions Integration', () => {
  it('should have generateStaffLink action exported', async () => {
    const { generateStaffLink } = await import('@/app/organization/[id]/settings/actions');
    expect(generateStaffLink).toBeDefined();
    expect(typeof generateStaffLink).toBe('function');
  });

  it('should have revokeStaffLink action exported', async () => {
    const { revokeStaffLink } = await import('@/app/organization/[id]/settings/actions');
    expect(revokeStaffLink).toBeDefined();
    expect(typeof revokeStaffLink).toBe('function');
  });

  it('should have getStaffLinkDetails action exported', async () => {
    const { getStaffLinkDetails } = await import('@/app/organization/[id]/settings/actions');
    expect(getStaffLinkDetails).toBeDefined();
    expect(typeof getStaffLinkDetails).toBe('function');
  });

  it('should have handleStaffTokenSignup in signup actions', async () => {
    // This is a private function, but we can verify the signup action exists
    const { signup } = await import('@/app/signup/actions');
    expect(signup).toBeDefined();
    expect(typeof signup).toBe('function');
  });
});

describeWithDb('RLS Policies Check', () => {
  it('should check if organizations table has RLS enabled', async () => {
    const adminClient = createAdminClient();
    const { data: tables } = await adminClient.rpc('exec_sql', {
      query: `
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'organizations'
      `
    }).select('*');

    expect(tables?.[0]?.rowsecurity).toBe(true);
    console.log('✅ RLS is enabled on organizations table');
  });

  it('should check if organization_members table has RLS enabled', async () => {
    const adminClient = createAdminClient();
    const { data: tables } = await adminClient.rpc('exec_sql', {
      query: `
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'organization_members'
      `
    }).select('*');

    expect(tables?.[0]?.rowsecurity).toBe(true);
    console.log('✅ RLS is enabled on organization_members table');
  });
});
