import { readFileSync } from "node:fs";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.server", ".env.local"]) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Drop over-broad moderator UPDATE on listings — moderation uses admin_set_listing_status RPC
await client.query(`drop policy if exists "listings_update_admin" on public.listings`);

// profiles_update_admin: only super_admin should update privileged columns.
// Trigger protect_profile_privileges already blocks self-escalation; still tighten to admin+ for non-role fields.
// Leave profiles_update_admin as-is (admin needed for ban display_name via RPC anyway).

const pols = await client.query(
  `select policyname, cmd, qual, with_check
   from pg_policies
   where schemaname='public' and tablename in ('listings','profiles','listing_requests','notifications','admin_audit_log')
   order by tablename, policyname`,
);
for (const p of pols.rows) {
  console.log(`${p.cmd} | ${p.policyname} | ${p.qual}`);
}

await client.end();
console.log("done");
