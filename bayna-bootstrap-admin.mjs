import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  try {
    const text = readFileSync(join(dir, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

loadEnvLocal();

const url = (process.env.VITE_SUPABASE_URL ?? "").trim();
const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "mohamed_rashad.king@gmail.com").trim();
const password = (process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "").trim();
const displayName = (process.env.BOOTSTRAP_ADMIN_NAME ?? "مسؤول النظام").trim();

if (!url) {
  console.error("Missing VITE_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!password) {
  console.error("Set BOOTSTRAP_ADMIN_PASSWORD env var (do not commit it).");
  process.exit(1);
}
if (!secretKey) {
  console.error("Set SUPABASE_SECRET_KEY in env for bootstrap (server-side only).");
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Bootstrapping super_admin:", email);

  let userId = null;
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    userId = existing.id;
    console.log("User already exists:", userId);
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (pwErr) throw pwErr;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createErr) throw createErr;
    userId = created.user.id;
    console.log("User created:", userId);
  }

  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      display_name: displayName,
      role: "super_admin",
      is_banned: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (profErr) throw profErr;

  const { data: prof } = await admin
    .from("profiles")
    .select("id, display_name, role, is_banned")
    .eq("id", userId)
    .maybeSingle();

  console.log("OK profile:", JSON.stringify(prof, null, 2));
  console.log("Login with this email/password in the app, then open /admin");
}

main().catch((e) => {
  console.error("Bootstrap failed:", e?.message ?? e);
  process.exit(1);
});
