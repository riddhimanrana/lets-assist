#!/usr/bin/env node

/**
 * Test auto-join for a new OAuth user
 * This simulates the database trigger that runs on user creation.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function testAutoJoin(email) {
  console.log(`\n🧪 Testing auto-join for email: ${email}\n`);

  const domain = email.split("@")[1]?.toLowerCase();
  console.log(`1️⃣ Extracted domain: ${domain}`);

  if (!domain) {
    console.log("❌ No domain extracted");
    return;
  }

  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("id, name, auto_join_domain")
    .eq("auto_join_domain", domain)
    .single();

  console.log(`2️⃣ Organization lookup:`, org ? `✅ Found: ${org.name}` : `❌ Not found`);
  if (orgError) console.log(`   Error:`, orgError.message);

  if (!org) {
    console.log("\n❌ Test failed: No organization found with auto_join_domain");
    return;
  }

  const testEmail = `test+${Date.now()}@${domain}`;
  console.log(`\n3️⃣ Creating test user: ${testEmail}`);

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: testEmail,
    email_confirm: true,
    user_metadata: {
      full_name: "Test User",
      name: "Test User",
    },
  });

  if (authError) {
    console.log("❌ Failed to create test user:", authError.message);
    return;
  }

  const testUserId = authData.user.id;
  console.log(`   ✅ Created user: ${testUserId}`);

  // Trigger should auto-join the user; check membership
  console.log(`\n4️⃣ Verifying membership...`);
  const { data: membership, error: memberError } = await adminClient
    .from("organization_members")
    .select("role, joined_at")
    .eq("organization_id", org.id)
    .eq("user_id", testUserId)
    .maybeSingle();

  if (memberError) {
    console.log("❌ Error checking membership:", memberError.message);
  } else if (!membership) {
    console.log("❌ User was NOT auto-joined");
  } else {
    console.log(`   ✅ Membership confirmed: role=${membership.role}, joined_at=${membership.joined_at}`);
  }

  // Verify metadata
  console.log(`\n5️⃣ Checking user metadata...`);
  const { data: userData } = await adminClient.auth.admin.getUserById(testUserId);
  const meta = userData?.user?.user_metadata || {};
  console.log(`   auto_joined_org_id: ${meta.auto_joined_org_id || "<missing>"}`);
  console.log(`   auto_joined_org_name: ${meta.auto_joined_org_name || "<missing>"}`);

  // Clean up test user
  console.log(`\n6️⃣ Cleaning up test user...`);
  await adminClient.from("organization_members").delete().eq("user_id", testUserId);
  await adminClient.from("profiles").delete().eq("id", testUserId);
  await adminClient.auth.admin.deleteUser(testUserId);
  console.log(`   ✅ Test user deleted`);

  console.log(`\n✅ Test completed\n`);
}

testAutoJoin("test@troop941.org").catch((err) => {
  console.error(err);
  process.exit(1);
});
