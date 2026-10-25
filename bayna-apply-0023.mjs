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

const before = await client.query(
  `select table_name, privilege_type from information_schema.column_privileges
   where table_schema='public' and table_name in ('escrow_holds','wallet_balances','wallet_transactions')
     and grantee='anon' and privilege_type in ('INSERT','UPDATE','DELETE') limit 5`
);
console.log("BEFORE anon money grants sample:", before.rows.length);

const sql = readFileSync("supabase/migrations/0023_revoke_anon_money_grants.sql", "utf8");
await client.query(sql);
console.log("OK applied 0023");

const after = await client.query(
  `select table_name, privilege_type from information_schema.column_privileges
   where table_schema='public' and table_name in ('escrow_holds','wallet_balances','wallet_transactions','listing_requests')
     and grantee='anon' and privilege_type in ('INSERT','UPDATE','DELETE')`
);
console.log("AFTER anon money/listing grants:", after.rows.length ? JSON.stringify(after.rows) : "(none)");

// authenticated listing_requests still status,updated_at only
const ag = await client.query(
  `select string_agg(column_name, ',' order by column_name) cols
   from information_schema.column_privileges
   where table_schema='public' and table_name='listing_requests' and privilege_type='UPDATE' and grantee='authenticated'`
);
console.log("authenticated update cols:", ag.rows[0]?.cols);

await client.end();
console.log("DONE 0023");
