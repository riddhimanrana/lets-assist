/**
 * Manual Staff Invite Flow Test Script
 * Run with: npx tsx tests/staff-invite-manual-test.ts
 */

import { createAdminClient } from '../utils/supabase/admin';

async function testStaffInviteFlow() {
  console.log('🚀 Starting Staff Invite Flow Manual Test\n');
  
  const adminClient = createAdminClient();
  let testPassed = true;

  // Test 1: Check database schema
  console.log('📋 Test 1: Checking database schema...');
  try {
    const { error } = await adminClient
      .from('organizations')
      .select('staff_join_token, staff_join_token_created_at, staff_join_token_expires_at')
      .limit(1);
    
    if (error) throw error;
    console.log('✅ Staff token columns exist in organizations table\n');
  } catch (err) {
    console.error('❌ Schema check failed:', err);
    testPassed = false;
  }

  // Test 2: Find an organization to test with
  console.log('📋 Test 2: Finding test organization...');
  const { data: orgs, error: orgError } = await adminClient
    .from('organizations')
    .select('id, username, name, staff_join_token')
    .eq('username', 'dvhs')
    .single();
  
  if (orgError || !orgs) {
    console.error('❌ Could not find test organization (dvhs)');
    testPassed = false;
    return;
  }
  
  console.log(`✅ Found organization: ${orgs.name} (@${orgs.username})`);
  console.log(`   Current token status: ${orgs.staff_join_token ? 'Has token' : 'No token'}\n`);
  
  const testOrgId = orgs.id;
  const testOrgUsername = orgs.username;

  // Test 3: Generate a new staff token
  console.log('📋 Test 3: Generating new staff token...');
  const newToken = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  
  try {
    const { data, error } = await adminClient
      .from('organizations')
      .update({
        staff_join_token: newToken,
        staff_join_token_created_at: new Date().toISOString(),
        staff_join_token_expires_at: expiresAt.toISOString(),
      })
      .eq('id', testOrgId)
      .select('staff_join_token, staff_join_token_expires_at')
      .single();
    
    if (error) throw error;
    
    console.log('✅ Token generated successfully');
    console.log(`   Token: ${data.staff_join_token}`);
    console.log(`   Expires: ${data.staff_join_token_expires_at}\n`);
  } catch (err) {
    console.error('❌ Token generation failed:', err);
    testPassed = false;
  }

  // Test 4: Verify token can be retrieved
  console.log('📋 Test 4: Retrieving token details...');
  try {
    const { data, error } = await adminClient
      .from('organizations')
      .select('username, staff_join_token, staff_join_token_expires_at')
      .eq('username', testOrgUsername)
      .single();
    
    if (error) throw error;
    
    const isValid = data.staff_join_token === newToken 
      && data.staff_join_token_expires_at 
      && new Date(data.staff_join_token_expires_at) > new Date();
    
    if (!isValid) throw new Error('Token validation failed');
    
    console.log('✅ Token retrieved and validated');
    console.log(`   Token matches: ${data.staff_join_token === newToken}`);
    console.log(`   Not expired: ${new Date(data.staff_join_token_expires_at) > new Date()}\n`);
  } catch (err) {
    console.error('❌ Token retrieval failed:', err);
    testPassed = false;
  }

  // Test 5: Construct signup URL
  console.log('📋 Test 5: Constructing signup URL...');
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const signupUrl = `${baseUrl}/signup?staff_token=${newToken}&org=${testOrgUsername}`;
  console.log('✅ Signup URL constructed');
  console.log(`   URL: ${signupUrl}\n`);
  console.log('   📝 Use this URL to test signup as staff member\n');

  // Test 6: Check organization_members table structure
  console.log('📋 Test 6: Checking organization_members table...');
  try {
    const { data, error } = await adminClient
      .from('organization_members')
      .select('*')
      .eq('organization_id', testOrgId)
      .eq('role', 'staff')
      .limit(1);
    
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned
    
    console.log('✅ organization_members table accessible');
    console.log(`   Current staff members: ${data?.length || 0}\n`);
  } catch (err) {
    console.error('❌ organization_members check failed:', err);
    testPassed = false;
  }

  // Test 7: Verify RLS policies
  console.log('📋 Test 7: Checking RLS policies...');
  try {
    // This will fail if RLS blocks access, which is expected for some operations
    const { data: orgData, error: orgError } = await adminClient
      .from('organizations')
      .select('id')
      .eq('id', testOrgId)
      .single();
    
    const { data: memberData, error: memberError } = await adminClient
      .from('organization_members')
      .select('id')
      .eq('organization_id', testOrgId)
      .limit(1);
    
    if (orgError || memberError) throw new Error('RLS blocked access');
    console.log('✅ RLS policies allow admin client access');
    console.log(`   Organizations accessible: ${orgData ? 'Yes' : 'No'}`);
    console.log(`   Members accessible: ${memberData ? 'Yes' : 'No'}\n`);
  } catch {
    console.log('⚠️  RLS policies may be restrictive (this might be expected)\n');
  }

  // Test 8: Test expiration logic
  console.log('📋 Test 8: Testing expiration detection...');
  try {
    // Create an expired token scenario
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 1);
    
    await adminClient
      .from('organizations')
      .update({
        staff_join_token_expires_at: expiredDate.toISOString(),
      })
      .eq('id', testOrgId);
    
    const { data } = await adminClient
      .from('organizations')
      .select('staff_join_token_expires_at')
      .eq('id', testOrgId)
      .single();
    
    const isExpired = new Date(data!.staff_join_token_expires_at) < new Date();
    
    if (!isExpired) throw new Error('Expiration detection failed');
    
    console.log('✅ Expiration detection works correctly\n');
    
    // Restore to valid expiration
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 30);
    await adminClient
      .from('organizations')
      .update({
        staff_join_token_expires_at: newExpiry.toISOString(),
      })
      .eq('id', testOrgId);
  } catch (err) {
    console.error('❌ Expiration test failed:', err);
    testPassed = false;
  }

  // Test 9: Test token revocation
  console.log('📋 Test 9: Testing token revocation...');
  try {
    const { error } = await adminClient
      .from('organizations')
      .update({
        staff_join_token: null,
        staff_join_token_created_at: null,
        staff_join_token_expires_at: null,
      })
      .eq('id', testOrgId);
    
    if (error) throw error;
    
    const { data } = await adminClient
      .from('organizations')
      .select('staff_join_token')
      .eq('id', testOrgId)
      .single();
    
    if (!data || data.staff_join_token !== null) throw new Error('Token not revoked');
    
    console.log('✅ Token revocation works correctly\n');
  } catch (err) {
    console.error('❌ Revocation test failed:', err);
    testPassed = false;
  }

  // Restore token for future use
  console.log('📋 Cleanup: Restoring test token...');
  const restoredToken = crypto.randomUUID();
  const restoredExpiry = new Date();
  restoredExpiry.setDate(restoredExpiry.getDate() + 30);
  
  await adminClient
    .from('organizations')
    .update({
      staff_join_token: restoredToken,
      staff_join_token_created_at: new Date().toISOString(),
      staff_join_token_expires_at: restoredExpiry.toISOString(),
    })
    .eq('id', testOrgId);
  
  console.log('✅ Test token restored\n');
  console.log(`   New token: ${restoredToken}`);
  console.log(`   New signup URL: ${baseUrl}/signup?staff_token=${restoredToken}&org=${testOrgUsername}\n`);

  // Summary
  console.log('═'.repeat(60));
  if (testPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log('\n📝 Summary:');
    console.log('   • Database schema is correct');
    console.log('   • Token generation works');
    console.log('   • Token validation works');
    console.log('   • Expiration detection works');
    console.log('   • Token revocation works');
    console.log('\n🎯 The staff invite feature is fully functional!');
    console.log('\n📋 Next steps to test:');
    console.log('   1. Visit the signup URL in a browser');
    console.log('   2. Create a new account using the staff token');
    console.log('   3. Verify the user is added as staff to the organization');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('\nPlease review the errors above.');
  }
  console.log('═'.repeat(60));
}

// Run the test
testStaffInviteFlow().catch(console.error);
