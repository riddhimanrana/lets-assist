#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function persistUserId(email, userId, env) {
  const filePath = env.BOOTSTRAP_USER_ID_FILE;
  if (!filePath || !email || !userId) {
    return;
  }

  try {
    const existing = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf8"))
      : {};

    existing[email.toLowerCase()] = userId;
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  } catch {
    console.warn("[bootstrap-auth-user] Warning: Could not persist bootstrap user id.");
  }
}

const LOCAL_POSTGRES_URL = "postgresql://postgres@127.0.0.1:54322/postgres";

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runLocalPsql(sql) {
  return execFileSync(
    "psql",
    [LOCAL_POSTGRES_URL, "-At", "-c", sql],
    {
      encoding: "utf-8",
      env: {
        ...process.env,
        PGPASSWORD: "postgres",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

async function updatePasswordInDatabase(userId, plainPassword) {
  let hash;
  try {
    hash = await bcrypt.hash(plainPassword, 10);
  } catch {
    console.warn("[bootstrap-auth-user] Warning: Failed to hash password.");
    return false;
  }

  if (!hash) {
    return false;
  }

  try {
    runLocalPsql(
      `UPDATE auth.users SET encrypted_password = ${sqlLiteral(hash)} WHERE id = ${sqlLiteral(userId)};`,
    );

    const postUpdateHash = runLocalPsql(
      `SELECT encrypted_password FROM auth.users WHERE id = ${sqlLiteral(userId)} LIMIT 1;`,
    );

    if (!postUpdateHash) {
      console.warn("[bootstrap-auth-user] Warning: No password hash found after update.");
    } else if (postUpdateHash !== hash) {
      console.warn("[bootstrap-auth-user] Warning: Password hash verification mismatch.");
    }

    console.log("[bootstrap-auth-user] Password updated in local auth database.");
    return true;
  } catch {
    console.warn("[bootstrap-auth-user] Warning: Failed to update password.");
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

  const lookupUserIdByEmail = () => {
    try {
      return runLocalPsql(
        `SELECT id FROM auth.users WHERE lower(email) = lower(${sqlLiteral(email)}) LIMIT 1;`,
      );
    } catch {
      console.warn("[bootstrap-auth-user] Warning: Could not resolve existing user ID from database.");
      return "";
    }
  };

  const finalizeExistingUser = async (user) => {
    const updateRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
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

    try {
      await updatePasswordInDatabase(user.id, password);
    } catch {
      console.warn("[bootstrap-auth-user] Warning: Could not set password.");
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: existingProfileUpsertError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: user.id,
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
      console.warn("[bootstrap-auth-user] Warning: Profile upsert failed.");
    }

    await supabaseAdmin.from("notification_settings").upsert(
      {
        user_id: user.id,
        email_notifications: true,
        project_updates: true,
        general: true,
      },
      { onConflict: "user_id" },
    );

    persistUserId(email, user.id, env);
    console.log("[bootstrap-auth-user] Updated existing local user.");
  };

  if (existingUser?.id) {
    await finalizeExistingUser(existingUser);
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
    if (createRes.status === 422 && text.includes("email_exists")) {
      const dbUserId = lookupUserIdByEmail();
      if (dbUserId) {
        await finalizeExistingUser({ id: dbUserId });
        process.exit(0);
      }

      const retryRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        {
          method: "GET",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        },
      );

      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const retryUser = Array.isArray(retryData?.users)
          ? retryData.users.find((u) => u?.email?.toLowerCase() === email.toLowerCase())
          : null;

        if (retryUser?.id) {
          await finalizeExistingUser(retryUser);
          process.exit(0);
        }
      }
    }

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

  persistUserId(email, userId, env);

  try {
    const preUpdateHash = runLocalPsql(
      `SELECT encrypted_password FROM auth.users WHERE id = ${sqlLiteral(userId)} LIMIT 1;`,
    );
    if (!preUpdateHash) {
      console.log("[bootstrap-auth-user] No pre-existing password hash before update.");
    }
  } catch {
    console.log("[bootstrap-auth-user] Could not query pre-update password hash.");
  }

  try {
    await updatePasswordInDatabase(userId, password);
    console.log("[bootstrap-auth-user] Password setup completed.");
  } catch {
    console.warn("[bootstrap-auth-user] Warning: Could not set password.");
  }

  console.log("[bootstrap-auth-user] Creating profile and notification settings...");
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
      console.warn("[bootstrap-auth-user] Warning: Profile creation failed.");
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
      console.warn("[bootstrap-auth-user] Warning: Notification settings creation failed.");
    }

    // Success if both are completely error-free, OR if only profile has ignorable permission error
    const profileSuccess = !profileError || isProfileErrorIgnorable;
    const notifSuccess = !notifError;

    if (profileSuccess && notifSuccess) {
      console.log("[bootstrap-auth-user] Created local login user with profile and notifications.");
    } else {
      console.warn("[bootstrap-auth-user] Warning: Additional setup steps had errors.");
      console.log("[bootstrap-auth-user] Created local login user (some additional setup failed).");
    }
  } catch {
    console.warn("[bootstrap-auth-user] Warning: Failed to create profile.");
    console.log("[bootstrap-auth-user] Created auth user (profile creation failed).");
  }
}

main().catch(() => {
  console.error("[bootstrap-auth-user] Script failed.");
  process.exit(1);
});