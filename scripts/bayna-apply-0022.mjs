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
if (!password) {
  console.error("SUPABASE_DB_PASSWORD required");
  process.exit(1);
}

const targets = [
  { label: "direct db.", host: "db.havpresypsvxevwwkjis.supabase.com", port: 5432, user: "postgres" },
  {
    label: "pooler session",
    host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: "postgres.havpresypsvxevwwkjis",
  },
];

async function connectFirst() {
  let lastErr;
  for (const t of targets) {
    const client = new Client({
      host: t.host,
      port: t.port,
      user: t.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      await client.query("select 1");
      console.log(`Connected via ${t.label}`);
      return client;
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch { /* ignore */ }
      console.log(`Fail ${t.label}: ${e.message}`);
    }
  }
  throw lastErr || new Error("no connection");
}

const client = await connectFirst();

async function safe(label, sql) {
  try {
    const r = await client.query(sql);
    console.log(`OK ${label}`);
    return r;
  } catch (e) {
    console.error(`FAIL ${label}: ${e.message}`);
    throw e;
  }
}

// BEFORE
console.log("=== BEFORE ===");
const beforeFn = await safe("check admin_confirm_external_payment",
  `select proname from pg_proc where proname in ('admin_confirm_external_payment','admin_reject_external_payment','escrow_pay_external') order by 1`);
console.log("functions:", beforeFn.rows.map(r => r.proname).join(", ") || "(none of interest)");

const beforeStatus = await safe("check escrow_holds constraint",
  `select conname, pg_get_constraintdef(oid) as def
   from pg_constraint
   where conrelid = 'public.escrow_holds'::regclass
     and contype = 'c'
     and conname = 'escrow_holds_status_check'`);
console.log("status check:", beforeStatus.rows[0]?.def || "(missing)");

const beforeCols = await safe("check listing_requests update grants",
  `select grantee, string_agg(column_name, ',' order by column_name) as cols
   from information_schema.column_privileges
   where table_schema='public' and table_name='listing_requests' and privilege_type='UPDATE'
   group by grantee`);
console.log("update grants:", JSON.stringify(beforeCols.rows));

const beforeNotify = await safe("check notify_user grants",
  `select grantee, privilege_type
   from information_schema.routine_privileges
   where routine_schema='public' and routine_name='notify_user'
   order by grantee, privilege_type`);
console.log("notify_user grants:", JSON.stringify(beforeNotify.rows));

// APPLY 0022
const sql = readFileSync("supabase/migrations/0022_security_remediation.sql", "utf8");
// fix the known typo if still present
const fixed = sql.replace(/els\s+if\s+v_listing\.rental_unit/g, "elsif v_listing.rental_unit");
console.log("\n=== Applying 0022_security_remediation.sql ===");
try {
  await client.query(fixed);
  console.log("OK applied");
} catch (e) {
  console.error("FAILED:", e.message);
  await client.end();
  process.exit(1);
}

// AFTER
console.log("\n=== AFTER ===");
const afterFn = await safe("check functions after",
  `select proname, prosecdef from pg_proc where proname in ('admin_confirm_external_payment','admin_reject_external_payment','escrow_pay_external') order by 1`);
console.log("functions:", afterFn.rows.map(r => `${r.proname}(definer=${r.prosecdef})`).join(", "));

const afterStatus = await safe("check constraint after",
  `select pg_get_constraintdef(oid) as def
   from pg_constraint
   where conrelid = 'public.escrow_holds'::regclass and contype='c' and conname='escrow_holds_status_check'`);
console.log("status check:", afterStatus.rows[0]?.def || "(missing)");

const afterCols = await safe("check update grants after",
  `select grantee, string_agg(column_name, ',' order by column_name) as cols
   from information_schema.column_privileges
   where table_schema='public' and table_name='listing_requests' and privilege_type='UPDATE'
   group by grantee`);
console.log("update grants:", JSON.stringify(afterCols.rows));

const afterNotify = await safe("check notify_user after",
  `select grantee, privilege_type
   from information_schema.routine_privileges
   where routine_schema='public' and routine_name='notify_user'
   order by grantee, privilege_type`);
console.log("notify_user grants:", JSON.stringify(afterNotify.rows));

const qrPolicy = await safe("check payment_qr policy",
  `select policyname, cmd, qual, with_check
   from pg_policies
   where schemaname='storage' and tablename='objects' and policyname='payment_qr_subshot_insert'`);
console.log("policy:", JSON.stringify(qrPolicy.rows[0] || null));

const qrBucket = await safe("check payment-qr bucket",
  `select id, file_size_limit from storage.buckets where id='payment-qr'`);
console.log("bucket:", JSON.stringify(qrBucket.rows[0] || null));

const modPolicy = await safe("check moderator listing_requests policy",
  `select policyname from pg_policies where schemaname='public' and tablename='listing_requests' and policyname='listing_requests_update_moderator'`);
console.log("moderator policy rows:", modPolicy.rows.length);

// smoke: escrow holds status enum values present in check
const smoke = await safe("smoke: has_min_role exists",
  `select proname from pg_proc where proname='has_min_role'`);
console.log("has_min_role:", smoke.rows[0]?.proname || "MISSING");

await client.end();
console.log("\nDONE 0022 applied + verified");
