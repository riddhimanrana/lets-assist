import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { faker } from '@faker-js/faker';

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
    // 1. Target Organization
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

    // 2. Assign riddhiman.rana@gmail.com as Admin
    const adminEmail = 'riddhiman.rana@gmail.com';
    let { data: adminUserRes } = await supabase.auth.admin.listUsers();
    let adminAuthId = adminUserRes?.users.find(u => u.email === adminEmail)?.id;

    if (!adminAuthId) {
       console.log(`Please ensure ${adminEmail} is bootstrapped via bootstrap-dev-accounts.mjs.`);
    } else {
      await supabase.from('organization_members').upsert({
        organization_id: orgId,
        user_id: adminAuthId,
        role: 'admin',
        status: 'active'
      });
      console.log(`Assigned ${adminEmail} as admin of Golden Speech.`);
    }

    // 3. Force Plugin Installation
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

    // 4. Seeding Plugin Data (Seasons & Tournaments)
    console.log("Seeding plugin data (Seasons & Tournaments)...");
    const { data: season, error: seasonErr } = await pluginDb.from('org_seasons').upsert({
      organization_id: orgId,
      label: '2026-2027',
      starts_at: '2026-08-01',
      ends_at: '2027-06-15',
      is_current: true
    }, { onConflict: 'organization_id,label' }).select('id').single();

    const activeSeason = season?.id || (await pluginDb.from('org_seasons').select('id').eq('organization_id', orgId).single()).data.id;

    const { data: tourney } = await pluginDb.from('dv_sd_tournaments').upsert({
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

    // 5. Seed 45 Realistic Users
    console.log("Seeding 45 Realistic Users...");
    const testPassword = "DVSDTest2026!";
    const credentials = [];
    
    // Check if we already seeded
    const { count } = await pluginDb.from('dv_sd_student_profiles').select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
    
    if (count < 45) {
      for (let i = 0; i < 45 - count; i++) {
        const studentFirstName = faker.person.firstName();
        const studentLastName = faker.person.lastName();
        const studentEmail = faker.internet.email({ firstName: studentFirstName, lastName: studentLastName, provider: "dvhs.org" }).toLowerCase();

        const parentFirstName = faker.person.firstName();
        const parentLastName = studentLastName;
        const parentEmail = faker.internet.email({ firstName: parentFirstName, lastName: parentLastName }).toLowerCase();

        // Create Student Auth User
        const { data: sAuth, error: sError } = await supabase.auth.admin.createUser({
          email: studentEmail,
          password: testPassword,
          email_confirm: true,
          user_metadata: { full_name: `${studentFirstName} ${studentLastName}` }
        });

        if (sError && !sError.message.includes("already registered")) {
          console.error(`Failed to create student ${studentEmail}:`, sError);
          continue;
        }

        const sUser = sAuth?.user;
        if (sUser) {
          credentials.push({ email: studentEmail, role: "Student", name: `${studentFirstName} ${studentLastName}` });

          await supabase.from("organization_members").upsert({
            organization_id: orgId,
            user_id: sUser.id,
            role: "member",
            status: 'active'
          });

          // Insert Student Profile
          const { data: studentProfile } = await pluginDb.from("dv_sd_student_profiles").upsert({
            organization_id: orgId,
            student_name: `${studentFirstName} ${studentLastName}`,
            email: studentEmail,
            phone: faker.helpers.fromRegExp(/[0-9]{10}/),
            grade_level: faker.helpers.arrayElement(["9", "10", "11", "12"]),
            paid_membership: faker.datatype.boolean(0.8),
            created_by: adminAuthId || sUser.id,
          }).select('id').single();

          if (!studentProfile) {
            throw new Error(`Failed to seed student profile for ${studentEmail}`);
          }

          const studentId = studentProfile?.id;

          // Create Parent Auth User
          const { data: pAuth, error: pError } = await supabase.auth.admin.createUser({
            email: parentEmail,
            password: testPassword,
            email_confirm: true,
            user_metadata: { full_name: `${parentFirstName} ${parentLastName}` }
          });

          const pUser = pAuth?.user;
          if (pUser) {
            credentials.push({ email: parentEmail, role: "Parent", name: `${parentFirstName} ${parentLastName}` });

            await supabase.from("organization_members").upsert({
              organization_id: orgId,
              user_id: pUser.id,
              role: "member",
              status: 'active'
            });

            // Insert Parent Profile
            const { data: parentProfile } = await pluginDb.from("dv_sd_parent_profiles").upsert({
              organization_id: orgId,
              parent_name: `${parentFirstName} ${parentLastName}`,
              email: parentEmail,
              phone: faker.helpers.fromRegExp(/[0-9]{10}/),
              created_by: adminAuthId || pUser.id,
            }).select('id').single();

            if (!parentProfile) {
              throw new Error(`Failed to seed parent profile for ${parentEmail}`);
            }
            
            const parentId = parentProfile?.id;

            // Link them
            if (studentId && parentId) {
              const { error: linkError } = await pluginDb.from("dv_sd_profile_links").upsert({
                organization_id: orgId,
                student_profile_id: studentId,
                parent_profile_id: parentId,
                relationship: "parent",
                created_by: adminAuthId || pUser.id,
              });

              if (linkError) {
                throw new Error(`Failed to seed profile link for ${studentEmail} ↔ ${parentEmail}: ${linkError.message}`);
              }
            }
          }
        }
      }
      console.log(`Seeded missing users to reach 45.`);
    } else {
      console.log(`45+ users already seeded.`);
    }

    console.log("✅ Fully Seeded Organization: 'The Golden State Speech & Debate Team' with admin: 'riddhiman.rana@gmail.com'");

  } catch(e) {
    console.error("FATAL ERROR", e);
  }
}

run();
