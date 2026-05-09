import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { faker } from '@faker-js/faker';

// Load local environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pluginDb = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'plugin_data' }
});

const ORG_ID = 'bde9eacc-3dd0-43f6-812b-291b9420c32c'; // DV Speech and Debate

async function run() {
  console.log("🚀 Starting COMPREHENSIVE DV Speech & Debate Simulation Seeding...");

  try {
    // 1. Ensure Season (handle current constraint)
    await pluginDb.from('org_seasons').update({ is_current: false }).eq('organization_id', ORG_ID);
    
    const { data: season, error: seasonError } = await pluginDb
      .from('org_seasons')
      .upsert({
        organization_id: ORG_ID,
        label: '2024-2025 Comprehensive',
        starts_at: '2024-08-01',
        ends_at: '2025-06-15',
        is_current: true
      }, { onConflict: 'organization_id,label' })
      .select('id')
      .single();

    if (seasonError) throw seasonError;
    console.log(`✅ Current Season: ${season.id}`);

    // Get existing users
    const { data: { users } } = await supabase.auth.admin.listUsers();

    // 2. Create 10 Students & Parents
    const students = [];
    const eventTypes = ['Public Forum', 'Lincoln Douglas', 'Congress', 'Policy Debate', 'Original Oratory', 'Extemp'];

    for (let i = 0; i < 10; i++) {
      const email = `student${i+1}@simulation.dvsd.org`;
      const password = 'password123';
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();

      let userId;
      const existing = users.find(u => u.email === email);

      if (existing) {
        userId = existing.id;
      } else {
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: `${firstName} ${lastName}` }
        });
        if (authError) throw authError;
        userId = authUser.user.id;
      }

      students.push({ id: userId, firstName, lastName, email });

      // Create Profile
      await supabase.from('profiles').upsert({
        id: userId,
        email,
        full_name: existing ? (existing.user_metadata?.full_name || `${firstName} ${lastName}`) : `${firstName} ${lastName}`,
        username: `student-${i+1}`,
        profile_visibility: 'public'
      });

      // Add to Organization
      await supabase.from('organization_members').upsert({
        organization_id: ORG_ID,
        user_id: userId,
        role: 'member'
      });

      // Create DV Student Profile
      let studentProfileId;
      const studentName = existing ? (existing.user_metadata?.full_name || `${firstName} ${lastName}`) : `${firstName} ${lastName}`;
      const { data: existingSP } = await pluginDb.from('dv_sd_student_profiles').select('id').eq('organization_id', ORG_ID).eq('email', email).maybeSingle();
      if (existingSP) {
        studentProfileId = existingSP.id;
        await pluginDb.from('dv_sd_student_profiles').update({
            student_name: studentName,
            grade_level: (9 + (i % 4)).toString(),
            paid_membership: i % 2 === 0,
        }).eq('id', studentProfileId);
      } else {
        const { data: newSP, error: spError } = await pluginDb.from('dv_sd_student_profiles').insert({
            organization_id: ORG_ID,
            student_name: studentName,
            email,
            grade_level: (9 + (i % 4)).toString(),
            paid_membership: i % 2 === 0,
            source: 'signup'
        }).select('id').single();
        if (spError) throw spError;
        studentProfileId = newSP.id;
      }

      // Create Parent Profile
      let parentProfileId;
      const parentEmail = `parent${i+1}@simulation.dvsd.org`;
      const { data: existingPP } = await pluginDb.from('dv_sd_parent_profiles').select('id').eq('organization_id', ORG_ID).eq('email', parentEmail).maybeSingle();
      if (existingPP) {
        parentProfileId = existingPP.id;
      } else {
        const parentName = `${faker.person.firstName()} ${lastName}`;
        const { data: newPP, error: ppError } = await pluginDb.from('dv_sd_parent_profiles').insert({
            organization_id: ORG_ID,
            parent_name: parentName,
            email: parentEmail,
            can_judge: i % 3 !== 0,
            notes: faker.lorem.sentence()
        }).select('id').single();
        if (ppError) throw ppError;
        parentProfileId = newPP.id;
      }

      // Link Parent
      await pluginDb.from('dv_sd_profile_links').upsert({
        organization_id: ORG_ID,
        parent_profile_id: parentProfileId,
        student_profile_id: studentProfileId,
        relationship: i % 2 === 0 ? 'mother' : 'father',
        is_primary_contact: true
      }, { onConflict: 'organization_id,parent_profile_id,student_profile_id' });

      // Create Membership
      await pluginDb.from('dv_sd_memberships').upsert({
        organization_id: ORG_ID,
        user_id: userId,
        season_id: season.id,
        status: i % 5 === 0 ? 'pending' : 'active',
        role: i === 0 ? 'president' : i < 3 ? 'officer' : 'member',
        leadership_title: i === 0 ? 'President' : i === 1 ? 'VP of Debate' : i === 2 ? 'VP of Speech' : null,
        display_name: studentName,
        email,
        grade_level: (9 + (i % 4)).toString(),
        paid: i % 2 === 0
      }, { onConflict: 'organization_id,user_id,season_id' });
    }

    // 3. Create Meetings
    console.log("📅 Creating Mock Meetings...");
    const meetings = [
        { title: 'General Chapter Meeting', scheduled_at: '2025-02-01T15:30:00Z', meeting_type: 'general' },
        { title: 'Public Forum Prep', scheduled_at: '2025-02-03T16:00:00Z', meeting_type: 'category', category: 'Public Forum' },
        { title: 'Officer Sync', scheduled_at: '2025-02-05T07:30:00Z', meeting_type: 'officer' },
        { title: 'Mock Tournament Session', scheduled_at: '2025-02-10T15:00:00Z', meeting_type: 'prep' }
    ];

    for (const m of meetings) {
        await pluginDb.from('dv_sd_meetings').insert({
            organization_id: ORG_ID,
            duration_minutes: 60,
            location: 'Room 204',
            ...m
        });
    }

    // 4. Create Tournaments & Entries
    console.log("🏆 Creating Tournament Circuit...");
    const tournaments = [
        { name: 'Stanford Invitational', starts_at: '2025-02-15T08:00:00Z', location: 'Stanford University', status: 'registration_open' },
        { name: 'Berkeley Invitational', starts_at: '2025-03-01T08:00:00Z', location: 'UC Berkeley', status: 'upcoming' }
    ];

    for (const t of tournaments) {
        const { data: tourney } = await pluginDb.from('dv_sd_tournaments').insert({
            organization_id: ORG_ID,
            season_id: season.id,
            format: 'mixed',
            entries_per_judge: 2,
            entry_fee_cents: 5000,
            ...t
        }).select('id').single();

        if (tourney) {
            // Register some students for varied events
            for (let i = 0; i < 6; i++) {
                await pluginDb.from('dv_sd_tournament_entries').upsert({
                    tournament_id: tourney.id,
                    user_id: students[i].id,
                    event_name: eventTypes[i % eventTypes.length],
                    status: 'confirmed'
                }, { onConflict: 'tournament_id,user_id,event_name' });
            }
        }
    }

    // 5. Activity Logs
    console.log("📜 Adding Activity Logs...");
    for (let i = 0; i < 5; i++) {
        await pluginDb.from('dv_sd_profile_activity').insert({
            organization_id: ORG_ID,
            actor_user_id: students[0].id,
            profile_type: 'system',
            action: 'membership.signup',
            title: 'New Member Application',
            details: `Simulation student ${i+1} joined the roster.`
        });
    }

    console.log("✨ COMPREHENSIVE Simulation Seeding Complete!");

  } catch (error) {
    console.error("❌ Seeding Error:", error);
  }
}

run();
