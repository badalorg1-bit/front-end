import { readFileSync } from "node:fs";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
function loadEnv(name) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}
loadEnv(".env.server");
loadEnv(".env.local");

const password = process.env.SUPABASE_DB_PASSWORD;
const client = new Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();

const tables = await client.query(
  `select table_name from information_schema.tables where table_schema='public' order by 1`
);
console.log("TABLES:", tables.rows.map(r => r.table_name).join(", "));

const cols = await client.query(
  `select table_name, string_agg(column_name, ',' order by ordinal_position) c
   from information_schema.columns where table_schema='public' and table_name in ('listing_requests','escrow_holds','topup_orders','conversation_messages','notifications','reviews','ai_warnings')
   group by table_name order by 1`
);
for (const r of cols.rows) console.log(`COLS ${r.table_name}: ${r.c}`);

const fns = await client.query(
  `select proname from pg_proc where pronamespace='public'::regnamespace order by 1`
);
console.log("FNS:", fns.rows.map(r => r.proname).join(", "));

await client.end();
