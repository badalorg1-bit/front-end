// Read-only inspection before running the post-0026 protocol.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require("pg");

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* optional */ }
}
loadEnv(join(root, "ui-prototype", ".env.server"));

const client = new Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();

const show = async (label, sql, params = []) => {
  try {
    const r = await client.query(sql, params);
    console.log(`\n--- ${label} (${r.rowCount} rows)`);
    for (const row of r.rows) console.log("   ", JSON.stringify(row));
  } catch (e) {
    console.log(`\n--- ${label} ERROR: ${e.message}`);
  }
};

await show("pentest users in auth.users",
  `select id, email, created_at from auth.users
   where email like 'pentest-%' or email like 'probe.%' order by created_at desc limit 10`);

await show("sample listings (id, owner, status)",
  `select id, owner_id, status, title from public.listings order by created_at desc limit 5`);

await show("listing_requests count by status",
  `select status, count(*)::int as n from public.listing_requests group by status order by 1`);

await show("active pricing plans",
  `select id, name, price_egp, is_active from public.pricing_plans order by price_egp limit 10`);

await show("subscription_orders sample",
  `select id, user_id, plan_id, status from public.subscription_orders order by created_at desc limit 5`);

await show("payment-qr objects (first 8)",
  `select name, created_at from storage.objects where bucket_id='payment-qr'
   order by created_at desc limit 8`);

await show("payment-qr object count",
  `select count(*)::int as n from storage.objects where bucket_id='payment-qr'`);

await show("avatars objects (for public-url test)",
  `select name from storage.objects where bucket_id='avatars' limit 3`);

await show("profiles of pentest users",
  `select p.id, p.display_name, p.role from public.profiles p
   join auth.users u on u.id = p.id
   where u.email like 'pentest-%' order by u.created_at desc limit 5`);

await client.end();
