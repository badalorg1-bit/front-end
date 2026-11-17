// Apply supabase/migrations 0039 + 0040 IN ORDER (each in its own
// transaction). Neither moves money or backfills data:
//   0039 — revoke execute on 27 private RPCs from PUBLIC + anon (grants to
//          authenticated/service_role were verified live before writing it).
//   0040 — deferrable quota-log FK (P0 publish blocker), purchase_promo
//          whitelist + FOR UPDATE, consume_listing_quota ownership + lock,
//          create_wallet_topup pending-dedup, banner insert policy pending.
//
// Usage:
//   node scripts/bayna-apply-0039-0040.mjs --check   # pre-flight only
//   node scripts/bayna-apply-0039-0040.mjs --verify  # post-flight only
//   node scripts/bayna-apply-0039-0040.mjs           # pre -> apply -> post
//
// Reads SUPABASE_DB_PASSWORD from ui-prototype/.env.server (never printed).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const require = createRequire(join(root, "ui-prototype", "package.json"));
let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error("Cannot load `pg` from ui-prototype/node_modules:", e.message);
  process.exit(2);
}

function readEnv() {
  const p = join(root, "ui-prototype", ".env.server");
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const password = readEnv().SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD missing from ui-prototype/.env.server");
  process.exit(2);
}

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  failures.push(m);
};
const info = (m) => console.log(`  ℹ ${m}`);
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await client.query(sql, params)).rows;
const num = (v) => Number(v ?? 0);
const expect = (cond, a, b) => (cond ? ok(a) : fail(b));

// The 27 private RPCs revoked from anon by 0039 (names only — the signatures
// are read live so a signature drift fails loudly instead of silently
// revoking nothing).
const PRIVATE_FNS = [
  "admin_broadcast_notification", "admin_list_wallet_topups", "admin_notify_user",
  "admin_review_banner", "admin_review_subscription_order", "admin_review_wallet_topup",
  "admin_set_listing_status", "admin_set_user_ban", "admin_set_user_role",
  "admin_update_plan", "admin_update_promo_service", "admin_update_saas_settings",
  "send_message", "get_conversation_messages", "get_or_create_conversation", "list_my_conversations",
  "get_my_payment_profile", "get_direct_payment_history",
  "create_wallet_topup", "attach_wallet_topup_screenshot", "list_my_wallet_topups",
  "purchase_plan", "purchase_promo", "create_subscription_order", "attach_order_screenshot",
  "consume_listing_quota", "get_merchant_account",
];

async function procSrc(name) {
  const r = await one(
    "select prosrc as s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 order by p.oid limit 1",
    [name],
  );
  return r ? String(r.s) : "";
}
async function priv(sig, role) {
  return (await one("select has_function_privilege($1, $2, 'execute') as b", [role, sig])).b === true;
}
async function privateRows() {
  // oidvectortypes -> "uuid, boolean" (types only): has_function_privilege
  // parses the signature itself and rejects argument NAMES.
  return all(
    `select p.proname, oidvectortypes(p.proargtypes) args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[])`,
    [PRIVATE_FNS],
  );
}
async function fkState() {
  return one(
    `select condeferrable, condeferred from pg_constraint
      where conrelid = 'listing_quota_log'::regclass
        and confrelid = 'listings'::regclass and contype = 'f'`,
  );
}
async function bannerPolicy() {
  const r = await one(
    `select pg_get_expr(polwithcheck, polrelid, true) as q
       from pg_policy where polname = 'banner_campaigns_insert_own' limit 1`,
  );
  return r ? String(r.q ?? "") : "";
}
async function snapshot() {
  const b = await one("select count(*)::int as rows, coalesce(sum(balance),0) as total from public.wallet_balances");
  const t = await one("select count(*)::int as rows, coalesce(sum(amount),0) as total from public.wallet_transactions");
  const h = await one("select count(*)::int as n from public.escrow_holds where status in ('held','pending_confirmation')");
  const u = await one("select count(*)::int as n, coalesce(sum(amount_egp),0) as egp from public.wallet_topups");
  const l = await one("select count(*)::int as n from public.listings");
  const q = await one("select count(*)::int as n from public.listing_quota_log");
  return {
    balanceRows: num(b.rows), balanceTotal: Number(b.total),
    txRows: num(t.rows), txTotal: Number(t.total),
    activeHolds: num(h.n), topups: num(u.n), topupEgp: Number(u.egp),
    listings: num(l.n), quotaLog: num(q.n),
  };
}
let before = null;

async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");
  const rows = await privateRows();
  expect(rows.length === 27, "all 27 private RPCs found", `expected 27 private RPCs, found ${rows.length}`);

  // 0039: every target must currently still be executable by anon (else the
  // batch was already applied — re-run is idempotent, just say so).
  let anonNow = 0;
  for (const r of rows) {
    const sig = `public.${r.proname}(${r.args})`;
    if (await priv(sig, "anon")) anonNow++;
  }
  if (anonNow === rows.length) info("anon still executes all 27 — 0039 not yet applied.");
  else if (anonNow === 0) info("anon already denied on all 27 — 0039 already applied (re-run safe).");
  else fail(`partial 0039 state: anon executes ${anonNow}/27 — stop and inspect`);

  // 0040 drift guards: bodies must be either the known base or the known
  // fixed text — never a third, hot-fixed variant CREATE OR REPLACE would
  // silently overwrite.
  const promo = await procSrc("purchase_promo");
  expect(
    promo.includes("raise exception 'invalid_method';") === promo.includes("not in ('trial','credits','wallet_qr','instagram')"),
    "purchase_promo whitelist state is consistent",
    "purchase_promo whitelist markers inconsistent — possible hot-fix; stop",
  );
  if (promo.includes("for update of s")) info("purchase_promo already carries the #5b lock (0040 applied).");
  const quota = await procSrc("consume_listing_quota");
  const hasLock = quota.includes("pg_advisory_xact_lock");
  const hasOwn = quota.includes("and user_id = v_uid");
  expect(hasLock === hasOwn, "consume_listing_quota fix markers consistent", "consume_listing_quota markers inconsistent — possible hot-fix; stop");
  const topup = await procSrc("create_wallet_topup");
  expect(
    topup.includes("pending_topup_exists") === topup.includes("one pending top-up per user"),
    "create_wallet_topup fix markers consistent",
    "create_wallet_topup markers inconsistent — possible hot-fix; stop",
  );
  const fk = await fkState();
  if (fk.condeferrable) info("quota-log FK already deferrable (0040 applied).");
  const pol = await bannerPolicy();
  if (pol.includes("pending")) info("banner insert policy already forces pending (0040 applied).");

  before = await snapshot();
  console.log(
    `  ! data now: ${before.balanceRows} balance row(s) = ${before.balanceTotal} pts · ` +
      `${before.txRows} ledger row(s) = ${before.txTotal} · ${before.activeHolds} active hold(s) · ` +
      `${before.topups} top-up(s) = ${before.topupEgp} EGP · ${before.listings} listings · ${before.quotaLog} quota rows`,
  );
  console.log("  ! 0039/0040 write NONE of those (grants + function bodies + 1 policy + 1 FK flag).");
}

async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  if (!before) before = await snapshot();

  // 0039: anon + PUBLIC denied, authenticated + service_role granted, on all 27.
  const rows = await privateRows();
  expect(rows.length === 27, "all 27 private RPCs found", `expected 27 private RPCs, found ${rows.length}`);
  let anonLeak = 0, pubLeak = 0, authMissing = 0, svcMissing = 0;
  for (const r of rows) {
    const sig = `public.${r.proname}(${r.args})`;
    if (await priv(sig, "anon")) anonLeak++;
    if (await priv(sig, "public")) pubLeak++;
    if (!(await priv(sig, "authenticated"))) authMissing++;
    if (!(await priv(sig, "service_role"))) svcMissing++;
  }
  expect(anonLeak === 0, "anon denied on all 27 private RPCs", `${anonLeak}/27 still executable by anon`);
  expect(pubLeak === 0, "PUBLIC pseudo-role denied on all 27", `${pubLeak}/27 still granted to PUBLIC`);
  expect(authMissing === 0, "authenticated keeps all 27", `${authMissing}/27 lost the authenticated grant`);
  expect(svcMissing === 0, "service_role keeps all 27", `${svcMissing}/27 lost the service_role grant`);
  // Public-by-design RPCs must NOT have been swept up.
  for (const pub of ["get_listing_promos", "get_reviews_for_user", "get_user_public_profile", "get_merchant_store"]) {
    const r = await all(
      `select oidvectortypes(p.proargtypes) args from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`,
      [pub],
    );
    for (const a of r) {
      const sig = `public.${pub}(${a.args})`;
      expect(await priv(sig, "anon"), `${pub} stays public (by design)`, `${pub} was revoked from anon — public data RPC swept up`);
    }
  }

  // 0040a: FK deferrable + initially deferred.
  const fk = await fkState();
  expect(fk.condeferrable === true, "quota-log FK is DEFERRABLE", "quota-log FK still NOT deferrable — P0 publish blocker remains");
  expect(fk.condeferred === true, "quota-log FK is INITIALLY DEFERRED", "quota-log FK not initially deferred");

  // 0040b: purchase_promo whitelist + lock.
  const promo = await procSrc("purchase_promo");
  expect(promo.includes("not in ('trial','credits','wallet_qr','instagram')"), "purchase_promo has the #5a whitelist", "purchase_promo whitelist MISSING");
  expect(promo.includes("for update of s"), "purchase_promo has the #5b FOR UPDATE lock", "purchase_promo FOR UPDATE lock MISSING");
  expect(promo.includes("has_min_role") || promo.includes("is_user_banned"), "purchase_promo keeps its banned gate", "purchase_promo banned gate LOST");

  // 0040c: consume ownership + advisory lock.
  const quota = await procSrc("consume_listing_quota");
  expect(quota.includes("pg_advisory_xact_lock"), "consume has the per-user advisory lock", "consume advisory lock MISSING");
  expect(quota.includes("and user_id = v_uid"), "consume idempotency scoped to caller", "consume idempotency NOT scoped to caller");
  expect(quota.includes("raise exception 'not_owner'"), "consume raises not_owner for foreign listings", "consume not_owner check MISSING");
  expect(quota.includes("quota_exceeded"), "consume keeps the quota_exceeded gate", "consume quota gate LOST");

  // 0040d: top-up pending dedup.
  const topup = await procSrc("create_wallet_topup");
  expect(topup.includes("pending_topup_exists"), "create_wallet_topup has the pending dedup", "create_wallet_topup pending dedup MISSING");
  expect(topup.includes("invalid_method"), "create_wallet_topup keeps its method whitelist", "create_wallet_topup method whitelist LOST");

  // 0040e: banner policy forces pending.
  const pol = await bannerPolicy();
  expect(pol.includes("pending"), "banner insert policy forces status='pending'", "banner insert policy does NOT force pending");
  expect(pol.includes("created_by"), "banner insert policy keeps ownership check", "banner insert policy lost ownership check");

  // Money/data untouched.
  const after = await snapshot();
  for (const [k, label] of [
    ["balanceRows", "balances row count"], ["balanceTotal", "balances total"],
    ["txRows", "ledger row count"], ["txTotal", "ledger total"],
    ["activeHolds", "active holds"], ["topups", "top-ups"], ["topupEgp", "top-up EGP"],
    ["listings", "listings"], ["quotaLog", "quota rows"],
  ]) {
    expect(after[k] === before[k], `${label} unchanged (${after[k]})`, `${label} CHANGED — pre ${before?.[k]} vs post ${after[k]}`);
  }
}

async function applyFile(file) {
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail(`${file} is empty — refusing to apply`);
    return false;
  }
  console.log(`\n== APPLY ${file} (${sql.length} bytes) ==`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
    ok("COMMIT succeeded");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    fail(`ROLLBACK — ${e.message}`);
    return false;
  }
}

const checkOnly = process.argv.includes("--check");
const verifyOnly = process.argv.includes("--verify");

try {
  await client.connect();
  if (checkOnly) {
    await preflight();
    console.log("\n--check: read-only pre-flight only. No writes performed.");
    if (failures.length) process.exitCode = 1;
  } else if (verifyOnly) {
    await postflight();
    console.log(failures.length ? `\nVERIFY FAILED (${failures.length})` : "\nVERIFY: ALL CHECKS PASSED");
    if (failures.length) process.exitCode = 1;
  } else {
    await preflight();
    if (failures.length) {
      console.error(`\nPRE-FLIGHT FAILED (${failures.length}) — refusing to apply.`);
      process.exitCode = 1;
    } else {
      for (const f of [
        join(root, "supabase", "migrations", "0039_revoke_anon_from_private_rpcs.sql"),
        join(root, "supabase", "migrations", "0040_gap_fixes.sql"),
      ]) {
        if (!(await applyFile(f))) break;
      }
      await postflight();
      console.log(failures.length ? `\nPOST-FLIGHT FAILED (${failures.length})` : "\nALL CHECKS PASSED");
      if (failures.length) process.exitCode = 1;
    }
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
