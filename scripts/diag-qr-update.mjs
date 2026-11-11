import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.server", ".env.local"]) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
if (!MGMT) {
  console.error("SUPABASE_ACCESS_TOKEN missing in .env.server");
  process.exit(1);
}

async function mgmtSql(query) {
  const res = await fetch("https://api.supabase.com/v1/projects/havpresypsvxevwwkjis/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Table-level grants on profiles
const tableGrants = await mgmtSql(`
  select grantee, privilege_type
  from information_schema.table_privileges
  where table_schema='public' and table_name='profiles'
  order by grantee, privilege_type
`);
console.log("table grants:", JSON.stringify(tableGrants, null, 2));

// Create a fresh probe user + profile
const probeEmail = `probe.diag.${Date.now()}@badal-test.example`;
const probePassword = `Pr0be!${randomUUID().slice(0, 8)}`;
const created = await fetch(`${URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: probeEmail, password: probePassword, email_confirm: true, user_metadata: { display_name: "Diag" } }),
}).then((r) => r.json());
const uid = created.id;
console.log("probe user:", uid);
await mgmtSql(`insert into public.profiles (id, display_name) values ('${uid}', 'Diag') on conflict (id) do nothing`);

const b = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInErr } = await b.auth.signInWithPassword({ email: probeEmail, password: probePassword });
if (signInErr) { console.error("sign-in failed", signInErr.message); process.exit(1); }

// Explicit update with full error
const ownPath = `${uid}/qr-ok.jpg`;
const upd = await b.from("profiles").update({ payment_qr_path: ownPath }).eq("id", uid).select("id, payment_qr_path");
console.log("update result:", JSON.stringify(upd, null, 2));

// Explicit select with full error
const sel = await b.from("profiles").select("payment_qr_path").eq("id", uid).maybeSingle();
console.log("select result:", JSON.stringify(sel, null, 2));

// Also select a known-granted column to compare
const sel2 = await b.from("profiles").select("display_name").eq("id", uid).maybeSingle();
console.log("select display_name:", JSON.stringify(sel2, null, 2));

// Cleanup
await fetch(`${URL}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } });
await mgmtSql(`delete from public.profiles where id='${uid}'`);
console.log("cleaned up");
