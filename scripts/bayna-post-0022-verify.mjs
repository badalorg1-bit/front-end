import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.server", ".env.local"]) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

let pass = 0, fail = 0;
function ok(n, d = "") { pass++; console.log("PASS", n, d ? `— ${d}` : ""); }
function no(n, d = "") { fail++; console.log("FAIL", n, d ? `— ${d}` : ""); }

// --- DB-level checks ---
const db = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

const status = await db.query(
  `select pg_get_constraintdef(oid) d from pg_constraint
   where conrelid='public.escrow_holds'::regclass and contype='c' and conname='escrow_holds_status_check'`
);
if (status.rows[0]?.d?.includes("pending_confirmation")) ok("C1 escrow status includes pending_confirmation");
else no("C1 escrow status check", status.rows[0]?.d);

const fns = await db.query(
  `select proname from pg_proc where proname in
   ('admin_confirm_external_payment','admin_reject_external_payment','escrow_pay_external','wallet_escrow_refund','notify_user')`
);
const fnSet = new Set(fns.rows.map(r => r.proname));
for (const f of ["admin_confirm_external_payment", "admin_reject_external_payment", "escrow_pay_external"]) {
  if (fnSet.has(f)) ok(`function exists: ${f}`);
  else no(`function missing: ${f}`);
}

const updateGrants = await db.query(
  `select grantee, string_agg(column_name, ',' order by column_name) cols
   from information_schema.column_privileges
   where table_schema='public' and table_name='listing_requests' and privilege_type='UPDATE'
   group by grantee order by grantee`
);
const ag = updateGrants.rows.find(r => r.grantee === "authenticated");
const ang = updateGrants.rows.find(r => r.grantee === "anon");
if (ag?.cols === "status,updated_at") ok("C2 authenticated update lockdown", ag.cols);
else no("C2 authenticated update", ag?.cols || "(none)");
if (!ang) ok("C2 anon cannot UPDATE listing_requests");
else no("C2 anon still has update", ang.cols);

const notify = await db.query(
  `select grantee from information_schema.routine_privileges
   where routine_schema='public' and routine_name='notify_user'`
);
const notifyRoles = notify.rows.map(r => r.grantee);
if (!notifyRoles.includes("authenticated") && !notifyRoles.includes("anon") && !notifyRoles.includes("PUBLIC")) {
  ok("H2 notify_user not client-callable", notifyRoles.join(","));
} else {
  no("H2 notify_user still exposed", notifyRoles.join(","));
}

const bucket = await db.query(`select file_size_limit from storage.buckets where id='payment-qr'`);
if (bucket.rows[0]?.file_size_limit == 5242880) ok("M5 payment-qr 5MB");
else no("M5 payment-qr limit", bucket.rows[0]?.file_size_limit);

// --- RPC smoke as service_role (create throwaway pending hold path) ---
const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

// Confirm admin RPC rejects when no hold
try {
  const { error } = await admin.rpc("admin_confirm_external_payment", { p_request_id: "00000000-0000-0000-0000-000000000001" });
  if (error && /hold not found|moderator/i.test(error.message)) ok("admin_confirm missing-hold rejected", error.message);
  else if (!error) no("admin_confirm unexpectedly succeeded with empty request");
  else no("admin_confirm unexpected error", error.message);
} catch (e) {
  no("admin_confirm threw", e.message);
}

// Reject same
try {
  const { error } = await admin.rpc("admin_reject_external_payment", { p_request_id: "00000000-0000-0000-0000-000000000001" });
  if (error && /hold not found|moderator/i.test(error.message)) ok("admin_reject missing-hold rejected", error.message);
  else if (!error) no("admin_reject unexpectedly succeeded");
  else no("admin_reject unexpected", error.message);
} catch (e) {
  no("admin_reject threw", e.message);
}

// wallet_escrow_refund must not accept pending_confirmation (check SQL body via pg_get_functiondef)
const refundDef = await db.query(
  `select pg_get_functiondef(oid) d from pg_proc where proname='wallet_escrow_refund'`
);
if (refundDef.rows[0]?.d?.includes("v_hold.status <> 'held'")) ok("wallet_escrow_refund requires held");
else no("wallet_escrow_refund status guard", refundDef.rows[0]?.d?.slice(0, 200));

// escrow_pay_external body uses pending_confirmation
const extDef = await db.query(
  `select pg_get_functiondef(oid) d from pg_proc where proname='escrow_pay_external'`
);
if (extDef.rows[0]?.d?.includes("pending_confirmation")) ok("escrow_pay_external mints pending_confirmation");
else no("escrow_pay_external body", "missing pending_confirmation");

// payment settings RPC still present (renamed frontend, same DB name)
const payFn = await db.query(`select proname from pg_proc where proname='get_badal_payment_settings'`);
if (payFn.rows.length) ok("get_badal_payment_settings intact (DB name unchanged)");
else no("get_badal_payment_settings missing");

// RLS enabled on critical tables
const rls = await db.query(
  `select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in
   ('listing_requests','escrow_holds','wallet_balances','profiles','wallet_transactions') order by 1`
);
for (const r of rls.rows) {
  if (r.rowsecurity) ok(`RLS on ${r.tablename}`);
  else no(`RLS off ${r.tablename}`);
}

// anon should have zero UPDATE/INSERT grant on escrow_holds / wallet_balances / wallet_transactions
const moneyGrants = await db.query(
  `select table_name, privilege_type, grantee
   from information_schema.column_privileges
   where table_schema='public' and table_name in ('escrow_holds','wallet_balances','wallet_transactions')
     and grantee in ('anon') and privilege_type in ('INSERT','UPDATE','DELETE') order by 1,2`
);
if (!moneyGrants.rows.length) ok("anon has no write grants on money tables");
else no("anon money write grants", JSON.stringify(moneyGrants.rows));

await db.end();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
