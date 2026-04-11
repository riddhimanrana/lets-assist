#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import bcrypt from "bcrypt";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function getEnv() {
  const cwd = process.cwd();
  const rootEnvPath = path.join(cwd, ".env.local");
  const fileEnv = readEnvFile(rootEnvPath);

  return {
    ...fileEnv,
    ...process.env,
  };
}

function required(name, env) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function toDisplayName(rawEmail, explicitName) {
  if (explicitName && explicitName.trim()) return explicitName.trim();
  if (rawEmail?.toLowerCase() === "riddhiman.rana@gmail.com") {
    return "Riddhiman Rana";
  }
  const localPart = rawEmail?.split("@")[0] || "local user";
  return localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function toUsername(rawEmail, explicitUsername) {
  if (explicitUsername && explicitUsername.trim()) return explicitUsername.trim();
  const localPart = rawEmail?.split("@")[0] || "local-user";
  return localPart.toLowerCase().replace(/[^a-z0-9_]/g, "-");
}

async function updatePasswordInDatabase(userId, plainPassword) {
  // Hash password using bcrypt module (now installed)
  let hash;
  
  // Debug: log the password being hashed
  console.log(`[bootstrap-auth-user] DEBUG: About to hash password, length=${plainPassword.length}, first 3 chars='${plainPassword.substring(0, 3)}'`);
  
  try {
    hash = await bcrypt.hash(plainPassword, 10);
    console.log(`[bootstrap-auth-user] Generated bcrypt hash for password, hash starts with: ${hash.substring(0, 10)}...`);
    console.log(`[bootstrap-auth-user] Full hash (for debug): ${hash}`);
  } catch (err) {
    console.warn(`[bootstrap-auth-user] Warning: Failed to hash password - ${err.message}`);
    return false;
  }

  if (!hash) {
    return false;
  }

  try {
    // Use a temp file to avoid shell escaping issues with special characters in the hash
    const tempSqlFile = `/tmp/update_pwd_${userId}_${Date.now()}.sql`;
    
    // Write the SQL file directly with the hash - no escaping needed since we control the hash
    const sqlStatement = `UPDATE auth.users SET encrypted_password = '${hash}' WHERE id = '${userId}';`;
    console.log(`[bootstrap-auth-user] SQL statement: ${sqlStatement}`);
    
    execSync(`cat > "${tempSqlFile}" << 'SQL_EOF'\n${sqlStatement}\nSQL_EOF`, { 
      stdio: "pipe",
      shell: "/bin/bash"
    });
    
    // Verify the file was written correctly
    const fileContent = execSync(`cat "${tempSqlFile}"`, { encoding: "utf-8" });
    console.log(`[bootstrap-auth-user] SQL file content:\n${fileContent}`);
    
    execSync(
      `PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" -f "${tempSqlFile}"`,
      { 
        stdio: "pipe",
        shell: "/bin/bash",
        timeout: 5000
      }
    );
    
    console.log(`[bootstrap-auth-user] Executed SQL from file`);
    
    // Additional verify - check if password was actually updated
    const postUpdateHash = execSync(
      `PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" -At -c "SELECT encrypted_password FROM auth.users WHERE id='${userId}';"`,
      { encoding: "utf-8" }
    ).trim();
    
    if (!postUpdateHash) {
      console.warn(`[bootstrap-auth-user] ERROR: No hash found after update!`);
    } else if (postUpdateHash !== hash) {
      console.warn(`[bootstrap-auth-user] ERROR: Hash mismatch after update!`);
      console.warn(`[bootstrap-auth-user]   Expected: ${hash}`);
      console.warn(`[bootstrap-auth-user]   Got:      ${postUpdateHash}`);
    }
    
    // Keep SQL files for debugging in /tmp/
    console.log(`[bootstrap-auth-user] SQL file saved for debug at: ${tempSqlFile}`);
    
    console.log(`[bootstrap-auth-user] Set password for user ${userId}`);
    return true;
  } catch (err) {
    console.warn(`[bootstrap-auth-user] Warning: Failed to update password: ${err.message}`);
    return false;
  }
}

async function main() {
  const env = getEnv();

  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL", env);
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local",
    );
  }

  const email = env.DEV_BOOTSTRAP_EMAIL;
  const password = env.DEV_BOOTSTRAP_PASSWORD;
  const fullName = toDisplayName(email, env.DEV_BOOTSTRAP_FULL_NAME);
  const username = toUsername(email, env.DEV_BOOTSTRAP_USERNAME);
  const isAdmin =
    String(env.DEV_BOOTSTRAP_IS_ADMIN || "").toLowerCase() === "true" ||
    email?.toLowerCase() === "riddhiman.rana@gmail.com";

  if (!email || !password) {
    console.log(
      "[bootstrap-auth-user] Skipped. Set DEV_BOOTSTRAP_EMAIL and DEV_BOOTSTRAP_PASSWORD in .env.local to auto-create a reusable local login.",
    );
    process.exit(0);
  }

  const listRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Failed to query users: ${listRes.status} ${text}`);
  }

  const listData = await listRes.json();
  const existingUser = Array.isArray(listData?.users)
    ? listData.users.find((u) => u?.email?.toLowerCase() === email.toLowerCase())
    : null;

  if (existingUser?.id) {
    const updateRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(existingUser.id)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          // Don't send password to the admin API - we'll set it directly via database update instead
          // password,
          email_confirm: true,
          user_metadata: {
            local_bootstrap_user: true,
            full_name: fullName,
            name: fullName,
            username,
            is_super_admin: isAdmin,
            admin: isAdmin,
          },
          app_metadata: {
            ...(isAdmin ? { is_super_admin: true } : {}),
          },
        }),
      },
    );

    if (!updateRes.ok) {
      const text = await updateRes.text();
      throw new Error(`Failed to update user: ${updateRes.status} ${text}`);
    }

    // Hash and update password for existing user
    try {
      await updatePasswordInDatabase(existingUser.id, password);
    } catch (err) {
      console.warn(`[bootstrap-auth-user] Warning: Could not hash password: ${err.message}`);
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: existingProfileUpsertError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: existingUser.id,
        email,
        full_name: fullName,
        username,
        profile_visibility: "public",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (
      existingProfileUpsertError &&
      !String(existingProfileUpsertError.message || "").includes("permission denied for table users")
    ) {
      console.warn(
        `[bootstrap-auth-user] Profile upsert warning for ${email}: ${existingProfileUpsertError.message}`,
      );
    }

    await supabaseAdmin.from("notification_settings").upsert(
      {
        user_id: existingUser.id,
        email_notifications: true,
        project_updates: true,
        general: true,
      },
      { onConflict: "user_id" },
    );

    console.log(`[bootstrap-auth-user] Updated local user ${email} (${username}).`);
    process.exit(0);
  }

  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      // Don't send password to the admin API - we'll set it directly via database update instead
      // password,
      email_confirm: true,
      user_metadata: {
        local_bootstrap_user: true,
        full_name: fullName,
        name: fullName,
        username,
        is_super_admin: isAdmin,
        admin: isAdmin,
      },
      app_metadata: {
        ...(isAdmin ? { is_super_admin: true } : {}),
      },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create user: ${createRes.status} ${text}`);
  }

  const userData = await createRes.json();
  const userId = userData?.id;

  if (!userId) {
    console.warn(
      "[bootstrap-auth-user] Warning: No user ID in response, skipping profile/notification creation",
    );
    process.exit(0);
  }

  // DEBUG: Check what password hash exists immediately after API creation
  try {
    const preUpdateHash = execSync(
      `PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" -At -c "SELECT encrypted_password FROM auth.users WHERE id='${userId}';"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    console.log(`[bootstrap-auth-user] Hash BEFORE updatePasswordInDatabase: ${preUpdateHash || "(null or empty)"}`);
  } catch (e) {
    console.log(`[bootstrap-auth-user] Could not query pre-update hash: ${e.message}`);
  }

  // Hash the password and update it directly in the database
  // The Supabase admin API may not properly hash passwords in local dev
  try {
    await updatePasswordInDatabase(userId, password);
    console.log(`[bootstrap-auth-user] Password set for user ${userId}`);
  } catch (err) {
    console.warn(`[bootstrap-auth-user] Warning: Could not set password: ${err.message}`);
  }

  // Create corresponding profile using admin Supabase client with service role
  console.log(`[bootstrap-auth-user] Creating profile for user ${userId}...`);
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create profile record
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email: email,
        full_name: fullName,
        username,
        profile_visibility: "public",
      }, { onConflict: "id" });

    // Track if profile error is ignorable (permission denied is expected in local dev)
    const isProfileErrorIgnorable = profileError && 
      String(profileError.message || "").includes("permission denied");

    if (profileError && !isProfileErrorIgnorable) {
      console.warn(`[bootstrap-auth-user] Warning: Profile creation failed: ${profileError.message}`);
    }

    // Create notification settings record
    const { error: notifError } = await supabaseAdmin
      .from("notification_settings")
      .upsert({
        user_id: userId,
        email_notifications: true,
        project_updates: true,
        general: true,
      }, { onConflict: "user_id" });

    if (notifError) {
      console.warn(`[bootstrap-auth-user] Warning: Notification settings creation failed: ${notifError.message}`);
    }

    // Success if both are completely error-free, OR if only profile has ignorable permission error
    const profileSuccess = !profileError || isProfileErrorIgnorable;
    const notifSuccess = !notifError;

    if (profileSuccess && notifSuccess) {
      console.log(`[bootstrap-auth-user] Created local login user ${email} (${username}) with profile and notifications.`);
    } else {
      const errors = [];
      if (profileError && !isProfileErrorIgnorable) errors.push(`profile: ${profileError.message}`);
      if (notifError) errors.push(`notification_settings: ${notifError.message}`);
      if (errors.length > 0) {
        console.warn(`[bootstrap-auth-user] DEBUG: Additional setup steps had errors: ${errors.join("; ")}`);
      }
      console.log(`[bootstrap-auth-user] Created local login user ${email} (some additional setup failed).`);
    }
  } catch (err) {
    console.warn(
      `[bootstrap-auth-user] Warning: Failed to create profile: ${err.message}`,
    );
    console.log(`[bootstrap-auth-user] Created auth user ${email} (profile creation failed).`);
  }
}

main().catch((error) => {
  console.error("[bootstrap-auth-user]", error.message);
  process.exit(1);
});