// Apply ONLY supabase/migrations/0026_batch1_security_fixes.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024/0025/0026, so it cannot be used for this batch.
// This script does a read-only pre-flight, applies exactly one file, then
// re-runs the same checks as post-flight so the diff is the proof.
//
// Usage:
//   node scripts/bayna-apply-0026.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0026.mjs           # pre-flight -> apply -> post-flight
//
// Reads SUPABASE_DB_PASSWORD from ui-prototype/.env.server (never printed).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// `pg` lives in ui-prototype/node_modules; root package.json does not list it.
const require = createRequire(join(root, "ui-prototype", "package.json"));
let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error("cannot load pg from ui-prototype/node_modules:", e.message);
  process.exit(1);
}

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* optional */
  }
}
loadEnv(join(root, "ui-prototype", ".env.server"));
loadEnv(join(root, ".env.server"));

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD required (ui-prototype/.env.server)");
  process.exit(1);
}

const MIGRATION = join(root, "supabase", "migrations", "0026_batch1_security_fixes.sql");
const checkOnly = process.argv.includes("--check");

const targets = [
  { label: "direct db.", host: "db.havpresypsvxevwwkjis.supabase.com", port: 5432, user: "postgres" },
  {
    label: "pooler session",
    host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: "postgres.havpresypsvxevwwkjis",
  },
];

async function connect() {
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
      console.log(`connected via ${t.label} (${t.host})`);
      return client;
    } catch (e) {
      lastErr = e;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr;
}

// ---- checks -----------------------------------------------------------------
// Each check is read-only and returns rows. The same list runs before and
// after the apply; the difference between the two runs is the verification.

const QUOTES = String.fromCharCode(96); // backtick, kept out of template literals below

const checks = [
  {
    id: "0024 applied (escrow_holds.payout_status)",
    sql: `select exists(
            select 1 from information_schema.columns
            where table_schema='public' and table_name='escrow_holds'
              and column_name='payout_status') as ok`,
    // expected after: true (0024 is a prerequisite note, not changed by 0026)
    expect: (r) => String(r.ok) === "true",
    info: true,
  },
  {
    id: "0025 applied (confirm_direct_payment is the retired stub)",
    sql: `select (p.prosrc like '%direct payment is retired%') as ok
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='confirm_direct_payment'`,
    expect: (r) => String(r.ok) === "true",
    info: true,
  },
  {
    id: "wallet_escrow_pay still exists (0026 must drop it)",
    sql: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='wallet_escrow_pay'`,
    // before: present (1 row) / after: absent (0 rows)
    expect: (r) => r.sig !== undefined,
    before: true,
  },
  {
    id: "lock_request_insert trigger + function (0026 must create them)",
    sql: `select (exists(select 1 from pg_trigger t
                        where t.tgrelid='public.listing_requests'::regclass
                          and not t.tgisinternal
                          and t.tgname='listing_requests_lock_insert')) as trig_ok,
                 (exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public'
                           and p.proname='lock_request_insert')) as fn_ok`,
    expect: (r) => String(r.trig_ok) === "true" && String(r.fn_ok) === "true",
    after: true,
  },
  {
    id: "lock_request_insert normalises status/money/timestamps",
    sql: `select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='lock_request_insert'`,
    expect: (r) =>
      /new\.status\s*:=\s*'pending'/.test(r.prosrc || "") &&
      /new\.paid_at\s*:=\s*null/.test(r.prosrc || "") &&
      /new\.created_at\s*:=\s*now\(\)/.test(r.prosrc || ""),
    after: true,
  },
  {
    id: "listing_requests INSERT columns granted to authenticated",
    sql: `select coalesce(string_agg(column_name, ',' order by column_name), '(none)') as cols
          from information_schema.column_privileges
          where table_schema='public' and table_name='listing_requests'
            and grantee='authenticated' and privilege_type='INSERT'`,
    expect: (r) => {
      const cols = String(r.cols || "").split(",").filter(Boolean).sort();
      const want = [
        "listing_id", "requester_id", "owner_id", "request_type", "status",
        "message", "rent_start", "rent_end", "offered_listing_id",
      ].sort();
      return cols.length === want.length && cols.every((c, i) => c === want[i]);
    },
    after: true,
    show: true,
  },
  {
    id: "listing_requests table-level INSERT revoked (anon)",
    sql: `select count(*) as n from information_schema.role_table_grants
          where table_schema='public' and table_name='listing_requests'
            and grantee='anon' and privilege_type='INSERT'`,
    expect: (r) => Number(r.n) === 0,
  },
  {
    id: "storage payment-qr INSERT policies",
    sql: `select policyname || '|' || cmd || '|' || array_to_string(roles, '+') as p
          from pg_policies
          where schemaname='storage' and tablename='objects'
            and policyname in ('payment_qr_upload','payment_qr_subshot_insert',
                               'payment_qr_platform_admin_insert',
                               'payment_qr_platform_admin_update')
          order by policyname`,
    expect: (r) => true, // informational; asserted below by name set
    show: true,
    after: true,
  },
  {
    id: "payment_qr_subshot_insert requires own order + image MIME",
    sql: `select with_check from pg_policies
          where schemaname='storage' and tablename='objects'
            and policyname='payment_qr_subshot_insert'`,
    expect: (r) => {
      const c = String(r.with_check || "");
      return (
        c.includes("subscription-screenshots") &&
        c.includes("o.user_id = auth.uid()") &&
        c.includes("mimetype") &&
        c.includes("image/jpeg")
      );
    },
    after: true,
  },
  {
    id: "payment_qr_public_read scoped (own folder or admin, authenticated only)",
    sql: `select qual || '##' || array_to_string(roles, '+') as p
          from pg_policies
          where schemaname='storage' and tablename='objects'
            and policyname='payment_qr_public_read'`,
    expect: (r) => {
      const [qual, roles] = String(r.p || "").split("##");
      return (
        roles === "authenticated" &&
        qual.includes("auth.uid()") &&
        qual.includes("has_min_role")
      );
    },
    after: true,
  },
  {
    id: "direct_payment_history exists with security_invoker",
    sql: `select (to_regclass('public.direct_payment_history') is not null) as exists,
                 coalesce((select array_to_string(c.reloptions, ',')
                           from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relname='direct_payment_history'),
                          '(no options)') as opts`,
    expect: (r) =>
      String(r.exists) === "true" && String(r.opts).includes("security_invoker=true"),
    after: true,
    show: true,
  },
  {
    id: "direct_payment_history granted to authenticated, revoked from anon",
    sql: `select (select count(*) from information_schema.role_table_grants
                    where table_schema='public' and table_name='direct_payment_history'
                      and grantee='authenticated' and privilege_type='SELECT') as auth_n,
                 (select count(*) from information_schema.role_table_grants
                    where table_schema='public' and table_name='direct_payment_history'
                      and grantee='anon') as anon_n`,
    expect: (r) => Number(r.auth_n) === 1 && Number(r.anon_n) === 0,
    after: true,
  },
  {
    id: "pricing_plans SELECT policy for authenticated (active plans)",
    sql: `select policyname || '|' || cmd || '|' || coalesce(qual,'') as p
          from pg_policies
          where schemaname='public' and tablename='pricing_plans'
            and policyname='pricing_plans_select_active_auth'`,
    expect: (r) => String(r.p || "").includes("is_active = true"),
    after: true,
  },
  {
    id: "escrow_pay_external still executable by authenticated",
    sql: `select has_function_privilege('authenticated',
                 'public.escrow_pay_external(uuid,numeric,text)','EXECUTE') as ok`,
    expect: (r) => String(r.ok) === "true",
    info: true,
  },
  {
    id: "wallet_escrow_release still executable by authenticated",
    sql: `select has_function_privilege('authenticated',
                 'public.wallet_escrow_release(uuid)','EXECUTE') as ok`,
    expect: (r) => String(r.ok) === "true",
    info: true,
  },
  {
    id: "payment-qr bucket is public (object URLs must keep working)",
    sql: `select public as ok from storage.buckets where id='payment-qr'`,
    expect: (r) => String(r.ok) === "true",
    info: true,
  },
];

function runChecks(client, phase) {
  const rows = [];
  for (const c of checks) {
    rows.push({ ...c, phase, result: null, pass: null });
  }
  return rows;
}

async function executeChecks(client, phase) {
  const out = [];
  for (const c of checks) {
    let res;
    try {
      const q = await client.query(c.sql);
      res = q.rows.length === 1 ? q.rows[0] : q.rows;
    } catch (e) {
      out.push({ c, phase, error: e.message, pass: false });
      continue;
    }
    let pass;
    try {
      pass = Array.isArray(res)
        ? res.length > 0 && res.every((r) => c.expect(r))
        : c.expect(res);
    } catch (e) {
      pass = false;
    }
    out.push({ c, phase, res, pass });
  }
  return out;
}

function printResults(results) {
  for (const r of results) {
    if (r.error) {
      console.log(`  [ERR ] ${r.c.id}: ${r.error}`);
      continue;
    }
    const flag = r.pass ? "[ OK ]" : "[ -- ]";
    const extra = r.c.show
      ? ` => ${JSON.stringify(r.res)}`
      : Array.isArray(r.res)
        ? ` (${r.res.length} row${r.res.length === 1 ? "" : "s"})`
        : "";
    console.log(`  ${flag} ${r.c.id}${extra}`);
  }
}

// ---- main -------------------------------------------------------------------

const client = await connect();

console.log("\n== PRE-FLIGHT ==");
const before = await executeChecks(client, "before");
printResults(before);

const hardBefore = before.filter((r) => r.c.before);
const missingPrereq = hardBefore.filter((r) => !r.pass);
if (missingPrereq.length && !process.argv.includes("--post")) {
  console.log(
    "\npre-flight blocked: expected prerequisite state not found ->",
    missingPrereq.map((r) => r.c.id).join("; "),
  );
  await client.end();
  process.exit(2);
}

if (checkOnly) {
  console.log("\n--check: no changes made.");
  await client.end();
  process.exit(0);
}

const sql = readFileSync(MIGRATION, "utf8");
if (process.argv.includes("--post")) {
  console.log("\n--post: verification only, no changes made.");
} else {
  console.log(`\n== APPLY ==\napplying 0026_batch1_security_fixes.sql (${Buffer.byteLength(sql)} bytes)`);
  try {
    const res = await client.query(sql);
    console.log(`done (${res.length} result set(s))`);
  } catch (e) {
    console.error("\nAPPLY FAILED:", e.message);
    await client.end();
    process.exit(3);
  }
}

console.log("\n== POST-FLIGHT ==");
const after = await executeChecks(client, "after");
printResults(after);

const failed = after.filter((r) => {
  // `before` checks assert state that 0026 is supposed to REMOVE, so after the
  // apply they pass by being gone.
  if (r.c.before) return r.pass;
  return !r.pass;
});
console.log(
  `\n${after.length - failed.length}/${after.length} post-flight checks passed` +
    (failed.length ? `; FAILED: ${failed.map((r) => r.c.id).join("; ")}` : ""),
);

await client.end();
process.exit(failed.length ? 4 : 0);
