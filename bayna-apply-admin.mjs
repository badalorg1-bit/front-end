import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

function loadEnv(name) {
  try {
    const text = readFileSync(join(dir, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnv(".env.server");
loadEnv(".env.local");

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const secret = (process.env.SUPABASE_SECRET_KEY || "").trim();
const publishable = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!url || !secret) {
  console.error("Need SUPABASE_URL and SUPABASE_SECRET_KEY from .env.server");
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureAdminUser() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "mohamed_rashad.king@gmail.com").trim();
  const password = (process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
  const displayName = (process.env.BOOTSTRAP_ADMIN_NAME || "مسؤول النظام").trim();
  if (!password) throw new Error("BOOTSTRAP_ADMIN_PASSWORD missing in .env.server");

  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  let userId;
  if (existing) {
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw error;
    console.log("Updated existing admin user", userId);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("Created admin user", userId);
  }

  // Wait for profiles trigger
  for (let i = 0; i < 10; i++) {
    const { data: prof } = await admin.from("profiles").select("id, role, is_banned").eq("id", userId).maybeSingle();
    if (prof) {
      const { error: upErr } = await admin
        .from("profiles")
        .update({ role: "super_admin", is_banned: false, display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (upErr) throw upErr;
      const { data: after } = await admin.from("profiles").select("id, display_name, role, is_banned").eq("id", userId).maybeSingle();
      console.log("Profile:", JSON.stringify(after));
      return userId;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("profiles row not created for admin user");
}

async function verifyTables() {
  const probes = [
    ["profiles.role", "profiles", "role"],
    ["profiles.is_banned", "profiles", "is_banned"],
  ];
  for (const [label, table, col] of probes) {
    const { data, error } = await admin.from(table).select(col).limit(1);
    if (error) {
      console.error(`MISSING ${label}:`, error.message);
      return false;
    }
    console.log(`OK column ${label}`);
  }
  const { error: nErr } = await admin.from("notifications").select("id").limit(1);
  if (nErr) {
    console.error("MISSING notifications table:", nErr.message);
    return false;
  }
  console.log("OK table notifications");
  const { error: aErr } = await admin.from("admin_audit_log").select("id").limit(1);
  if (aErr) {
    console.error("MISSING admin_audit_log table:", aErr.message);
    return false;
  }
  console.log("OK table admin_audit_log");
  return true;
}

async function tryApplySqlViaRest() {
  // Supabase does not expose arbitrary SQL on PostgREST.
  // Probe whether migration already applied; if not, report clearly.
  const ok = await verifyTables();
  return ok;
}

async function main() {
  console.log("Project:", url);
  console.log("Secret key present:", Boolean(secret));
  console.log("Publishable key present:", Boolean(publishable));

  const schemaReady = await tryApplySqlViaRest();
  if (!schemaReady) {
    console.log("\nSCHEMA NOT READY — need to run migration SQL once.");
    console.log("File: supabase/migrations/0003_admin_system.sql");
    process.exit(2);
  }

  const uid = await ensureAdminUser();
  console.log("DONE super_admin id:", uid);
  console.log("Login:", process.env.BOOTSTRAP_ADMIN_EMAIL, "→ open /admin");
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
