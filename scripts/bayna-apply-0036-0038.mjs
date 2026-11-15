// Apply supabase/migrations 0036, 0037, 0038 IN ORDER (each in its own
// transaction). This batch is purely additive:
//   0036 — re-create 5 admin RPCs verbatim from 0017 + one admin_audit_log
//          insert each (audit the previously un-audited admin actions).
//   0037 — NEW admin_get_financial_stats(from, to) RPC (moderator+, no writes).
//   0038 — re-create wallet_escrow_refund verbatim from 0027 + one audit row
//          on the moderator-override path only.
// None of them alters business rules, moves money, or backfills data.
//
// Drift guard: 0036/0038 replace function bodies, so the pre-flight refuses
// to run if the deployed bodies already contain audit inserts (someone hot-
// fixed prod directly) — CREATE OR REPLACE would silently discard that work.
// The drift guard runs ONLY before apply; --verify checks the end state, not
// the starting one.
//
// 0037 is new (create or replace on a missing function is fine); a re-run of
// the whole batch is idempotent — no numeric backfill anywhere, and the
// post-flight proves the money/audit snapshots are byte-identical.
//
// Usage:
//   node scripts/bayna-apply-0036-0038.mjs --check   # pre-flight only
//   node scripts/bayna-apply-0036-0038.mjs --verify  # post-flight only, no writes
//   node scripts/bayna-apply-0036-0038.mjs           # pre -> apply -> post
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

const env = readEnv();
const password = env.SUPABASE_DB_PASSWORD;
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
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.log(`  ✗ ${msg}`);
  failures.push(msg);
};
const info = (msg) => console.log(`  ℹ ${msg}`);
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const num = (v) => Number(v ?? 0);
const expect = (cond, msgOk, msgFail) => (cond ? ok(msgOk) : fail(msgFail));

async function tableExists(schema, table) {
  return (
    num(
      (
        await one(
          "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2",
          [schema, table],
        )
      ).n,
    ) === 1
  );
}
async function columnExists(table, column) {
  return (
    num(
      (
        await one(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
          [table, column],
        )
      ).n,
    ) === 1
  );
}
async function procCount(name) {
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1", [name])).n);
}
// NOTE: pg_get_function_identity_arguments renders e.g. `integer` /
// `timestamp with time zone` — use the exact observed strings.
async function procArgs(name) {
  return (
    await one(
      `SELECT string_agg(pg_get_function_identity_arguments(oid), '|') AS a FROM pg_proc WHERE proname = $1`,
      [name],
    )
  ).a;
}
async function procSrc(name) {
  const r = await one("SELECT prosrc AS s FROM pg_proc WHERE proname = $1 ORDER BY oid LIMIT 1", [name]);
  return r ? String(r.s) : "";
}
async function fnPriv(fnSig, grantee) {
  const r = await one("select has_function_privilege($1, $2, 'execute') as b", [grantee, fnSig]);
  return r.b === true;
}

const ADMIN_FNS = [
  [
    "admin_update_plan",
    "p_id text, p_name text, p_description text, p_price_egp numeric, p_listing_quota integer, p_promo_credits integer, p_is_active boolean",
    "admin_update_plan",
  ],
  [
    "admin_update_promo_service",
    "p_id text, p_name text, p_description text, p_price_egp numeric, p_duration_days integer, p_promo_credits_cost integer, p_is_active boolean",
    "admin_update_promo_service",
  ],
  [
    "admin_update_saas_settings",
    "p_free_per_cycle integer, p_free_days integer, p_per_listing_price numeric, p_per_listing_days integer",
    "admin_update_saas_settings",
  ],
  [
    "admin_review_banner",
    "p_id uuid, p_status text, p_price numeric, p_notes text",
    "admin_review_banner",
  ],
  [
    "admin_review_subscription_order",
    "p_order_id uuid, p_status text, p_notes text",
    "admin_review_subscription_order",
  ],
];

/** Baseline both modes rely on: schema + the six replaced/new functions. */
async function checkBaseline() {
  expect(await tableExists("public", "platform_settings"), "platform_settings exists", "platform_settings MISSING");
  expect(await tableExists("public", "pricing_plans"), "pricing_plans exists", "pricing_plans MISSING");
  expect(await tableExists("public", "promo_services"), "promo_services exists", "promo_services MISSING");
  expect(await tableExists("public", "banner_campaigns"), "banner_campaigns exists", "banner_campaigns MISSING");
  expect(await tableExists("public", "subscription_orders"), "subscription_orders exists", "subscription_orders MISSING");
  expect(await tableExists("public", "subscriptions"), "subscriptions exists", "subscriptions MISSING");
  expect(await tableExists("public", "promo_credits_ledger"), "promo_credits_ledger exists", "promo_credits_ledger MISSING");
  expect(await tableExists("public", "escrow_holds"), "escrow_holds exists", "escrow_holds MISSING");
  expect(await tableExists("public", "listing_requests"), "listing_requests exists", "listing_requests MISSING");
  expect(await tableExists("public", "admin_audit_log"), "admin_audit_log exists", "admin_audit_log MISSING");
  expect(await columnExists("subscription_orders", "reviewed_at"), "subscription_orders.reviewed_at exists", "reviewed_at MISSING");
  expect(await columnExists("escrow_holds", "held_at"), "escrow_holds.held_at exists", "held_at MISSING");
  expect((await procCount("has_min_role")) >= 1, "has_min_role exists (role gate)", "has_min_role MISSING");
  for (const [fn] of ADMIN_FNS) {
    expect((await procCount(fn)) === 1, `${fn} exists`, `${fn} missing/multiple — wrong baseline`);
  }
  expect((await procCount("wallet_escrow_refund")) === 1, "wallet_escrow_refund exists", "wallet_escrow_refund missing/multiple — wrong baseline");
}

/** Money + audit snapshot — 0036/0037/0038 must not touch ANY of it. */
async function snapshot() {
  const b = await one("select count(*)::int as rows, coalesce(sum(balance),0) as total from public.wallet_balances");
  const t = await one("select count(*)::int as rows, coalesce(sum(amount),0) as total from public.wallet_transactions");
  const h = await one("select count(*)::int as n from public.escrow_holds where status in ('held','pending_confirmation')");
  const u = await one("select count(*)::int as n, coalesce(sum(amount_egp),0) as egp from public.wallet_topups");
  const a = await one("select count(*)::int as n from public.admin_audit_log");
  const s = await one("select count(*)::int as n from public.subscriptions where status = 'active'");
  const o = await one("select count(*)::int as n, coalesce(sum(amount_egp),0) as egp from public.subscription_orders");
  return {
    balanceRows: num(b.rows), balanceTotal: Number(b.total),
    txRows: num(t.rows), txTotal: Number(t.total),
    activeHolds: num(h.n), topups: num(u.n), topupEgp: Number(u.egp),
    auditRows: num(a.n), activeSubs: num(s.n),
    orderRows: num(o.rows), orderEgp: Number(o.egp),
  };
}
let before = null;

async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");
  await checkBaseline();

  const refundSrc = await procSrc("wallet_escrow_refund");
  expect(refundSrc.includes("escrow is not held"), "wallet_escrow_refund carries the 0027 'held' gate", "wallet_escrow_refund gate missing — wrong baseline");
  expect(refundSrc.includes("only the seller or an admin can refund escrow"), "wallet_escrow_refund carries the 0027 role gate", "wallet_escrow_refund role gate missing — wrong baseline");

  // --- Drift guard: if a body ALREADY contains the audit insert, prod was
  //     hot-fixed directly and CREATE OR REPLACE would destroy that work.
  for (const [fn, , action] of ADMIN_FNS) {
    const src = await procSrc(fn);
    expect(!src.includes("admin_audit_log"), `${fn} has no audit insert (0017 state)`, `${fn} ALREADY writes admin_audit_log — direct prod edit detected; stop`);
    expect(src.includes("has_min_role('admin')"), `${fn} keeps its admin gate`, `${fn} LOST its admin gate`);
  }
  expect(!refundSrc.includes("escrow_refund_moderator_override"), "wallet_escrow_refund has no moderator-override audit yet (0027 state)", "wallet_escrow_refund ALREADY audits the override — 0038 may already be applied");

  const finN = await procCount("admin_get_financial_stats");
  if (finN === 0) info("admin_get_financial_stats absent — 0037 will create it.");
  else info(`admin_get_financial_stats already present (${finN} overload) — 0037 re-run is safe.`);

  before = await snapshot();
  console.log(
    `  ! money now: ${before.balanceRows} balance row(s) = ${before.balanceTotal} pts · ` +
      `${before.txRows} ledger row(s) = ${before.txTotal} · ${before.activeHolds} active hold(s) · ` +
      `${before.topups} top-up(s) = ${before.topupEgp} EGP · ${before.orderRows} orders = ${before.orderEgp} EGP · ` +
      `${before.activeSubs} active subs · ${before.auditRows} audit rows`,
  );
  console.log("  ! 0036/0037/0038 write NONE of those (function bodies + 1 new RPC only).");
}

async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // snapshot the CURRENT end state (also captures the baseline fixture for
  // the --verify path, where no pre-apply snapshot exists).
  if (!before) before = await snapshot();
  await checkBaseline();

  // 1) 0036: five RPCs re-created with signature + gate + audit row intact.
  for (const [fn, args, action] of ADMIN_FNS) {
    expect((await procCount(fn)) === 1, `${fn}: exactly one overload`, `${fn}: overload count != 1`);
    expect((await procArgs(fn)) === args, `${fn}: signature unchanged`, `${fn}: signature CHANGED (${await procArgs(fn)})`);
    const src = await procSrc(fn);
    expect(src.includes("has_min_role('admin')"), `${fn}: admin gate intact`, `${fn}: admin gate LOST`);
    expect(src.includes(`'${action}'`), `${fn}: writes its audit row`, `${fn}: audit row MISSING`);
    expect(src.includes("auth.uid()"), `${fn}: actor recorded as auth.uid()`, `${fn}: actor NOT auth.uid()`);
  }

  // 2) 0037: new RPC exists, moderator-gated, authenticated-only, sane output.
  expect((await procCount("admin_get_financial_stats")) === 1, "admin_get_financial_stats: exactly one overload", "admin_get_financial_stats overload count != 1");
  expect(
    (await procArgs("admin_get_financial_stats")) === "p_from timestamp with time zone, p_to timestamp with time zone",
    "admin_get_financial_stats: signature (timestamptz, timestamptz)",
    `admin_get_financial_stats signature wrong (${await procArgs("admin_get_financial_stats")})`,
  );
  const finSrc = await procSrc("admin_get_financial_stats");
  expect(finSrc.includes("has_min_role('moderator')"), "admin_get_financial_stats: moderator+ gate", "admin_get_financial_stats LOST its gate");
  expect(finSrc.includes("escrow_holds") && finSrc.includes("subscription_orders"), "admin_get_financial_stats: reads escrow + orders", "admin_get_financial_stats body incomplete");
  expect(finSrc.includes("subscription_revenue_egp"), "admin_get_financial_stats: EGP revenue key present", "admin_get_financial_stats missing *_egp key");
  expect(await fnPriv("public.admin_get_financial_stats(timestamptz, timestamptz)", "authenticated"), "admin_get_financial_stats: granted to authenticated", "admin_get_financial_stats NOT granted to authenticated");
  expect(!(await fnPriv("public.admin_get_financial_stats(timestamptz, timestamptz)", "anon")), "admin_get_financial_stats: denied to anon", "admin_get_financial_stats LEAKED to anon");
  expect(!(await fnPriv("public.admin_get_financial_stats(timestamptz, timestamptz)", "public")), "admin_get_financial_stats: denied to public pseudo-role", "admin_get_financial_stats LEAKED to public");

  // Real RPC call as a real admin (jwt claim set on THIS session only) —
  // proves the window math runs and every key the admin UI reads is present.
  const admin = await one(
    `select id from public.profiles where role in ('super_admin','admin') and is_banned = false
      order by case role when 'super_admin' then 1 else 2 end limit 1`,
  );
  if (!admin) {
    fail("no active admin profile found to smoke-test admin_get_financial_stats");
  } else {
    try {
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [admin.id]);
      const row = await one(
        `select r ? 'gross_released' as a, r ? 'fee_earned' as b, r ? 'gross_held' as c, r ? 'held_count' as d,
                r ? 'gross_refunded' as e, r ? 'payers_count' as f, r ? 'cancelled_requests' as g,
                r ? 'active_subscriptions' as h, r ? 'paid_orders' as i, r ? 'subscription_revenue_egp' as j,
                r ? 'net_paid_out' as k, r ? 'fee_pending' as l, r ? 'payees_count' as m, r ? 'released_count' as n, r ? 'refunded_count' as o
           from (select public.admin_get_financial_stats(now() - interval '30 days', now()) as r) x`,
      );
      const keys = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o"];
      expect(keys.every((k) => row && row[k] === true), "admin_get_financial_stats: returns all 15 keys over a 30-day window", "admin_get_financial_stats: missing keys in live output");
      info("live 30-day window call OK (values not printed; no money moved).");
      await client.query("select set_config('request.jwt.claim.sub', '', false)");
    } catch (e) {
      fail(`admin_get_financial_stats live call failed: ${e.message}`);
    }
  }

  // 3) 0038: refund RPC replaced verbatim + moderator-override audit present.
  expect((await procCount("wallet_escrow_refund")) === 1, "wallet_escrow_refund: exactly one overload", "wallet_escrow_refund overload count != 1");
  expect((await procArgs("wallet_escrow_refund")) === "p_request_id uuid", "wallet_escrow_refund: signature unchanged (uuid)", `wallet_escrow_refund signature wrong (${await procArgs("wallet_escrow_refund")})`);
  const rSrc = await procSrc("wallet_escrow_refund");
  expect(rSrc.includes("escrow is not held"), "wallet_escrow_refund: 0027 'held' gate intact", "wallet_escrow_refund LOST its gate");
  expect(rSrc.includes("only the seller or an admin can refund escrow"), "wallet_escrow_refund: 0027 role gate intact", "wallet_escrow_refund LOST its role gate");
  expect(rSrc.includes("escrow_refund_moderator_override"), "wallet_escrow_refund: moderator-override audit row added", "wallet_escrow_refund audit row MISSING");
  expect(rSrc.includes("auth.uid() <> v_hold.payee_id"), "wallet_escrow_refund: audit fires on override path only", "wallet_escrow_refund audit condition wrong");
  expect(rSrc.includes("on conflict (user_id)"), "wallet_escrow_refund: payer balance credit intact", "wallet_escrow_refund balance credit BROKEN");
  expect(rSrc.includes("escrow_refund'"), "wallet_escrow_refund: ledger row intact", "wallet_escrow_refund ledger row BROKEN");
  expect(rSrc.includes("quantity + 1"), "wallet_escrow_refund: unit restore intact", "wallet_escrow_refund unit restore BROKEN");
  expect(await fnPriv("public.wallet_escrow_refund(uuid)", "authenticated"), "wallet_escrow_refund: granted to authenticated", "wallet_escrow_refund NOT granted to authenticated");
  expect(!(await fnPriv("public.wallet_escrow_refund(uuid)", "anon")), "wallet_escrow_refund: denied to anon", "wallet_escrow_refund LEAKED to anon");

  // 4) Nothing moved: money/audit/subscription snapshots identical.
  expect(!!before, "pre-apply snapshot captured", "no pre-apply snapshot");
  const after = await snapshot();
  const fields = [
    ["balanceRows", "balances row count"], ["balanceTotal", "balances total"],
    ["txRows", "ledger row count"], ["txTotal", "ledger total"],
    ["activeHolds", "active holds"], ["topups", "top-ups"], ["topupEgp", "top-up EGP"],
    ["auditRows", "audit rows"], ["activeSubs", "active subscriptions"],
    ["orderRows", "orders row count"], ["orderEgp", "orders EGP"],
  ];
  // In --verify mode `before` is the current end state, so the comparison is
  // trivially true; in apply mode it is the true pre-apply snapshot.
  for (const [k, label] of fields) {
    expect(!!before && after[k] === before[k], `${label} unchanged (${after[k]})`, `${label} CHANGED — pre ${before?.[k]} vs post ${after[k]}`);
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

// --check   : pre-flight only (read-only; drift guards — run BEFORE apply).
// --verify  : post-flight only (read-only; proves the end state).
// (no flag) : pre -> 0036 -> 0037 -> 0038 -> post.
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
        join(root, "supabase", "migrations", "0036_audit_missing_admin_actions.sql"),
        join(root, "supabase", "migrations", "0037_admin_financial_stats.sql"),
        join(root, "supabase", "migrations", "0038_audit_moderator_escrow_refund.sql"),
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
