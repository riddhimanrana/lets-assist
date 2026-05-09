import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE URL or KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTests() {
  console.log("1. Authenticating as riddhiman.rana@gmail.com...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'riddhiman.rana@gmail.com',
    password: 'robo6737',
  });

  if (authError) {
    console.error("Authentication failed:", authError.message);
    process.exit(1);
  }

  console.log("Successfully authenticated as", authData.user.email);
  const userId = authData.user.id;

  // Find an org where this user is an admin
  const { data: orgMember, error: orgMemberError } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (orgMemberError || !orgMember) {
    console.error("User is not an admin of any organization! Seed error?", orgMemberError);
    process.exit(1);
  }

  const orgId = orgMember.organization_id;
  console.log("Using dynamic org ID:", orgId);

  // Create pluginDb client mimicking the app's behavior
  const pluginDb = supabase.schema('plugin_data');

  console.log(`\n2. Creating a test season for org ${orgId}...`);
  const { data: season, error: seasonError } = await pluginDb
    .from('org_seasons')
    .insert({
      organization_id: orgId,
      label: "Test Season 2026-2027",
      starts_at: "2026-08-01",
      ends_at: "2027-06-01",
      is_current: true
    })
    .select()
    .single();

  let checkSeasonId;
  if (seasonError) {
    console.error("❌ Failed to create season:", seasonError);
    // Might exist, let's fetch it
    const { data: fetchSeason } = await pluginDb.from('org_seasons').select('id').eq('organization_id', orgId).limit(1).single();
    checkSeasonId = fetchSeason?.id;
  } else {
    console.log("✅ Successfully created season:", season.id);
    checkSeasonId = season.id;
  }

  if (checkSeasonId) {
    console.log(`\n3. Creating a test tournament for org ${orgId}...`);
    const { data: tournament, error: tournamentError } = await pluginDb
      .from('dv_sd_tournaments')
      .insert({
        organization_id: orgId,
        season_id: checkSeasonId,
        name: "Test Local Tournament",
        starts_at: "2026-10-15T09:00:00Z",
        ends_at: "2026-10-16T17:00:00Z",
        location: "Local High School",
        status: "upcoming"
      })
      .select()
      .single();

    if (tournamentError) {
      console.error("❌ Failed to create tournament:", tournamentError);
    } else {
      console.log("✅ Successfully created tournament:", tournament.id);

      console.log(`\n4. Reading tournaments...`);
      const { data: tournamentsList, error: listError } = await pluginDb
        .from('dv_sd_tournaments')
        .select('*')
        .eq('organization_id', orgId);
      
      if (listError) {
        console.error("❌ Failed to list tournaments:", listError);
      } else {
        console.log(`✅ Successfully listed ${tournamentsList.length} tournaments.`);
      }
    }
  }

  console.log(`\n5. Adding a member profile...`);
  // Get org admin's user ID to use as user_id (already defined at top)
  const { data: profile, error: profileError } = await pluginDb
    .from('org_member_profiles')
    .insert({
      organization_id: orgId,
      user_id: userId,
      plugin_key: "dv-speech-debate",
      profile_data: { full_name: "Admin User", role: "coach", graduation_year: null }
    })
    .select()
    .single();

  if (profileError) {
    console.error("❌ Failed to create member profile:", profileError);
  } else {
    console.log("✅ Successfully created member profile:", profile.id);
  }

  console.log(`\nTests completed.`);
}

runTests().catch(err => {
  console.error("Unhandled error:", err);
});
