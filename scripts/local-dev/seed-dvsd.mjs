import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load local environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pluginDb = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'plugin_data' }
});

console.log("Seeding DV Speech and Debate Plugin Environment...");

async function run() {
  try {
    // ---------------------------------------------------------
    // 1. Target Organization
    // ---------------------------------------------------------
    
    // Create specific org
    let { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: 'The Golden State Speech & Debate Team',
        username: 'goldenspeech',
        type: 'school',
        description: 'Elite High School Speech and Debate Circuit Competitors.',
        join_code: 'GOLDEN'
      })
      .select('id')
      .single();

    if (orgError && orgError.code === '23505') { // unique violation
      const { data: existingOrg } = await supabase.from('organizations').select('id').eq('username', 'goldenspeech').single();
      org = existingOrg;
      console.log(`Organization already exists: ${org.id}`);
    } else if (orgError) {
      throw orgError;
    } else {
      console.log(`Created new Organization: ${org.id}`);
    }

    const orgId = org.id;

    // ---------------------------------------------------------
    // 2. Users and Organization Membership
    // ---------------------------------------------------------
    const adminEmail = 'dvsd.admin@local.test';
    
    // Check if user exists
    let { data: adminUserRes } = await supabase.auth.admin.listUsers();
    let adminAuthId = adminUserRes?.users.find(u => u.email === adminEmail)?.id;

    if (!adminAuthId) {
       const userParams = {
        email: adminEmail,
        password: 'TestPass123!',
        email_confirm: true,
        user_metadata: { name: 'DV Admin' }
       };
       const { data: newUser, error: userCreateError } = await supabase.auth.admin.createUser(userParams);
       if(userCreateError) throw userCreateError;
       adminAuthId = newUser.user.id;
       
       await supabase.from('users').update({ name: 'DV Admin' }).eq('id', adminAuthId);
       console.log(`Created admin user: ${adminEmail}`);
    }

    // Give admin role
    await supabase.from('organization_members').upsert({
      organization_id: orgId,
      user_id: adminAuthId,
      role: 'admin',
      status: 'active'
    });

    // ---------------------------------------------------------
    // 3. Force Plugin Installation (The "Managed" bypass)
    // ---------------------------------------------------------

    console.log("Forcing DV-Speech-Debate Plugin Installation...");

    await supabase.from('organization_plugin_entitlements').upsert({
       organization_id: orgId,
       plugin_key: 'dv-speech-debate',
       status: 'active',
       starts_at: new Date().toISOString()
    });

    await supabase.from('organization_plugin_installs').upsert({
       organization_id: orgId,
       plugin_key: 'dv-speech-debate',
       enabled: true,
       installed_version: '1.0.0',
       configuration: {
         require_payment_for_membership: false,
         membership_fee_cents: 0,
         auto_approve_memberships: true,
         max_entries_per_student: 5
       }
    });

    // ---------------------------------------------------------
    // 4. Seeding Plugin Data (Seasons & Tournaments)
    // ---------------------------------------------------------
    console.log("Seeding plugin data (Seasons & Tournaments)...");

    const { data: season, error: seasonErr } = await pluginDb.from('org_seasons').upsert({
      organization_id: orgId,
      label: '2026-2027 Team Roster',
      starts_at: '2026-08-01',
      ends_at: '2027-06-01',
      is_current: true
    }).select('id').single();

    if(seasonErr) {
       console.log("Season existed or failed:", seasonErr.message);
    }

    // Fetch season id if upsert didn't return due to uniqueness
    const activeSeason = season?.id || (await pluginDb.from('org_seasons').select('id').eq('organization_id', orgId).single()).data.id;

    // Tournaments
    const { data: tourney, error: tourneyErr } = await pluginDb.from('dv_sd_tournaments').upsert({
      organization_id: orgId,
      season_id: activeSeason,
      name: "California Invitational",
      starts_at: "2026-11-20T09:00:00Z",
      ends_at: "2026-11-22T17:00:00Z",
      location: "UC Berkeley",
      format: "mixed",
      status: "registration_open",
      registration_deadline: "2026-11-01T23:59:00Z",
      max_entries: 50,
      entry_fee_cents: 2500,
      override_required_judges: 10
    }).select("id").single();
    
    // ---------------------------------------------------------
    // 5. Creating dummy students + parent contacts and AI Judge Entrances
    // ---------------------------------------------------------
    
    // We create a student & a parent, add them to auth, mapping them up.
    const studentEmail = 'dvsd.student1@local.test';
    let { data: lists } = await supabase.auth.admin.listUsers();
    let studentAuthId = lists?.users.find(u => u.email === studentEmail)?.id;

    if (!studentAuthId) {
       const userParams = { email: studentEmail, password: 'TestPass123!', email_confirm: true, user_metadata: { name: 'Charlie Competitor' } };
       const { data: newUser } = await supabase.auth.admin.createUser(userParams);
       studentAuthId = newUser.user.id;
       await supabase.from('users').update({ name: 'Charlie Competitor' }).eq('id', studentAuthId);
    }

    await supabase.from('organization_members').upsert({ organization_id: orgId, user_id: studentAuthId, role: 'member', status: 'active' });

    await pluginDb.from('dv_sd_memberships').insert({
       organization_id: orgId,
       user_id: studentAuthId,
       season_id: activeSeason,
       status: 'active',
       role: 'member',
       display_name: 'Charlie Competitor',
       email: studentEmail,
       grade_level: 'Sophomore',
       events_interested: ['Lincoln Douglas', 'Original Oratory']
    });

    const parentEmail = 'dvsd.parent1@local.test';
    let parentAuthId = lists?.users.find(u => u.email === parentEmail)?.id;

    if (!parentAuthId) {
       const userParams = { email: parentEmail, password: 'TestPass123!', email_confirm: true, user_metadata: { name: 'Patty Parent' } };
       const { data: newUser } = await supabase.auth.admin.createUser(userParams);
       parentAuthId = newUser.user.id;
       await supabase.from('users').update({ name: 'Patty Parent' }).eq('id', parentAuthId);
    }
    
    await supabase.from('organization_members').upsert({ organization_id: orgId, user_id: parentAuthId, role: 'member', status: 'active' });
    await pluginDb.from('dv_sd_memberships').insert({
       organization_id: orgId,
       user_id: parentAuthId,
       season_id: activeSeason,
       status: 'active',
       role: 'member',
       display_name: 'Patty Parent',
       parent_name: 'Patty Parent',
       email: parentEmail,
       events_interested: ['Judge']
    });

    // Parent Student Link
    await pluginDb.from('dv_sd_parent_student_links').upsert({
      organization_id: orgId,
      student_membership_id: (await pluginDb.from('dv_sd_memberships').select('id').eq('user_id', studentAuthId).single()).data.id,
      parent_membership_id: (await pluginDb.from('dv_sd_memberships').select('id').eq('user_id', parentAuthId).single()).data.id,
      relationship_type: 'parent'
    });
    
    // Add an entry to tournament
    const tourId = tourney?.id || (await pluginDb.from('dv_sd_tournaments').select('id').eq('organization_id', orgId).single()).data.id;
    await pluginDb.from('dv_sd_tournament_entries').upsert({
      tournament_id: tourId,
      user_id: studentAuthId,
      event_name: 'Lincoln Douglas',
      status: 'confirmed'
    });

    console.log("✅ Fully Seeded Organization: 'The Golden State Speech & Debate Team' with admin: 'dvsd.admin@local.test' (TestPass123!)");
    
  } catch(e) {
    console.error("FATAL ERROR", e);
  }
}

run();
