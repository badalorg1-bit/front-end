// Apply supabase/migrations/0041_owner_gap_policies_to_authenticated.sql.
//
// 0041 re-declares the eight 0034 owner-gap SELECT policies (PUBLIC role,
// quals reading profiles.role) restricted `to authenticated`. anon holds no
// grant on profiles.role, so every anon read on those tables raised
// "permission denied for table profiles" (broke /pricing + /promo for
// logged-out visitors; latent on the other six). Names and quals are copied
// verbatim from 0034:870-908 so bayna-apply-0034.mjs post-flight stays green.
//
// Usage:
//   node scripts/bayna-apply-0041.mjs --check   # pre-flight only
//   node scripts/bayna-apply-0041.mjs --verify  # post-flight only
//   node scripts/bayna-apply-0041.mjs           # pre -> apply -> post
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

// The eight 0034 owner-gap SELECT policies (name, table) — the same list
// scripts/bayna-apply-0034.mjs verifies (ownerGap).
const GAP = [
  ["pricing_plans_select_active", "pricing_plans"],
  ["subscriptions_select_own", "subscriptions"],
  ["subscription_orders_select_own", "subscription_orders"],
  ["promo_services_select_active", "promo_services"],
  ["listing_promos_select_own", "listing_promos"],
  ["promo_credits_ledger_select_own", "promo_credits_ledger"],
  ["banner_campaigns_select_own", "banner_campaigns"],
  ["listing_quota_log_select_own", "listing_quota_log"],
];

async function policyState(pname, tname) {
  const r = await one(
    `select pg_get_expr(p.polqual, p.polrelid, true) as qual,
            p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')] as only_auth,
            p.polroles @> array[0]::oid[] as has_public,
            p.polroles @> array[(select oid from pg_roles where rolname = 'anon')]::oid[] as has_anon
       from pg_policy p
      where p.polrelid = $1::regclass and p.polname = $2`,
    [tname, pname],
  );
  return r || null;
}

// anon read of one table inside a rolled-back tx: returns { ok, n | err }.
async function roleRead(role, sql, claims) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    if (claims) await client.query(`set local request.jwt.claims to '${JSON.stringify(claims)}'`);
    const r = await client.query(sql);
    await client.query("rollback");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { ok: false, err: e.message };
  }
}

async function snapshot() {
  const b = await one("select count(*)::int as rows, coalesce(sum(balance),0) as total from public.wallet_balances");
  const t = await one("select count(*)::int as rows, coalesce(sum(amount),0) as total from public.wallet_transactions");
  const h = await one("select count(*)::int as n from public.escrow_holds where status in ('held','pending_confirmation')");
  const u = await one("select count(*)::int as n, coalesce(sum(amount_egp),0) as egp from public.wallet_topups");
  const l = await one("select count(*)::int as n from public.listings");
  const p = await one("select count(*)::int as n from public.profiles");
  const pp = await one("select count(*)::int as n, count(*) filter (where is_active)::int as active from public.pricing_plans");
  return {
    balanceRows: num(b.rows), balanceTotal: Number(b.total),
    txRows: num(t.rows), txTotal: Number(t.total),
    activeHolds: num(h.n), topups: num(u.n), topupEgp: Number(u.egp),
    listings: num(l.n), profiles: num(p.n), plans: num(pp.n), activePlans: num(pp.active),
  };
}
let before = null;

async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");
  let pending = 0;
  for (const [pname, tname] of GAP) {
    const s = await policyState(pname, tname);
    if (!s) {
      fail(`${pname} MISSING on ${tname} — 0034 state not present, stop`);
      continue;
    }
    expect(
      String(s.qual ?? "").includes("'owner'"),
      `${pname} qual still carries 'owner' (0034 state intact)`,
      `${pname} qual lost 'owner' — possible hot-fix, stop: ${s.qual}`,
    );
    if (s.has_public) {
      pending++;
    } else if (s.only_auth && !s.has_anon && !s.has_public) {
      info(`${pname} already restricted to authenticated (0041 applied — re-run safe).`);
    } else {
      fail(`${pname} in an unexpected role state (only_auth=${s.only_auth} anon=${s.has_anon} public=${s.has_public}) — stop`);
    }
  }
  if (pending === GAP.length) info("all eight policies still PUBLIC — 0041 not yet applied.");
  else if (pending > 0) fail(`partial state: ${pending}/8 still PUBLIC — stop and inspect`);

  // The exact breakage 0041 removes (proof kept live so a re-run documents it).
  const anonPricing = await roleRead("anon", "select count(*)::int n from public.pricing_plans where is_active = true");
  if (!anonPricing.ok) info(`anon pricing_plans still errors as expected pre-0041: ${anonPricing.err}`);
  else if (anonPricing.rows[0].n > 0) info("anon pricing_plans already readable — 0041 already applied.");
  else fail("anon pricing_plans returns 0 active rows — unexpected state, stop");

  before = await snapshot();
  console.log(
    `  ! data now: ${before.balanceRows} balance row(s) = ${before.balanceTotal} pts · ` +
      `${before.txRows} ledger row(s) = ${before.txTotal} · ${before.activeHolds} active hold(s) · ` +
      `${before.topups} top-up(s) = ${before.topupEgp} EGP · ${before.listings} listings · ` +
      `${before.profiles} profiles · ${before.plans} plans (${before.activePlans} active)`,
  );
  console.log("  ! 0041 writes NONE of those — it only re-declares 8 SELECT policies.");
}

async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  if (!before) before = await snapshot();

  // 1) The eight: exist, exclusively authenticated, quals keep 'owner'.
  for (const [pname, tname] of GAP) {
    const s = await policyState(pname, tname);
    if (!s) {
      fail(`${pname} MISSING after apply`);
      continue;
    }
    expect(s.only_auth, `${pname} restricted to authenticated ONLY`, `${pname} roles are NOT {authenticated} (only_auth=${s.only_auth})`);
    expect(!s.has_public && !s.has_anon, `${pname} covers neither PUBLIC nor anon`, `${pname} still covers PUBLIC=${s.has_public} anon=${s.has_anon}`);
    expect(String(s.qual ?? "").includes("'owner'"), `${pname} qual keeps 'owner' (0034 verifier green)`, `${pname} qual lost 'owner': ${s.qual}`);
  }

  // 2) Class invariant: no PUBLIC policy on an anon-readable table references
  //    profiles anymore (the exact defect class 0041 removes).
  const cls = await one(`
    select count(*)::int n
      from pg_policy p join pg_class c on c.oid = p.polrelid
     where pg_get_expr(p.polqual, p.polrelid, true) like '%profiles%'
       and p.polroles @> array[0]::oid[]
       and has_table_privilege('anon', c.oid, 'select')`);
  expect(num(cls.n) === 0, "zero PUBLIC policies on anon-readable tables reference profiles", `${cls.n} PUBLIC policy(ies) still reference profiles on anon-readable tables`);

  // 3) anon: every one of the eight tables reads WITHOUT error.
  const broken = [];
  for (const [, tname] of GAP) {
    const r = await roleRead("anon", `select count(*)::int n from public.${tname}`);
    if (!r.ok) broken.push(`${tname}: ${r.err}`);
  }
  expect(broken.length === 0, "anon reads all 8 owner-gap tables without error", `anon still denied: ${broken.join(" | ")}`);

  // 4) anon /pricing keeps working via the 0025 anon policy.
  const anonPlans = await roleRead("anon", "select count(*)::int n from public.pricing_plans where is_active = true");
  expect(anonPlans.ok && anonPlans.rows[0].n >= 1, `anon reads active plans (${anonPlans.rows?.[0]?.n ?? "ERR"})`, `anon pricing_plans broken: ${anonPlans.err ?? anonPlans.rows[0].n + " rows"}`);

  // 5) authenticated (plain user) reads — the live app paths, unchanged.
  const plain = await one(`select id from public.profiles order by (role <> 'user'), created_at limit 1`);
  const claims = plain ? { sub: plain.id, role: "authenticated" } : null;
  if (!claims) {
    info("no profile row to impersonate — authenticated reads not exercised");
  } else {
    const a1 = await roleRead("authenticated", "select count(*)::int n from public.pricing_plans where is_active = true", claims);
    expect(a1.ok && a1.rows[0].n >= 1, "authenticated reads active plans", `authenticated pricing_plans: ${a1.err ?? a1.rows[0].n + " rows"}`);
    const a2 = await roleRead("authenticated", "select count(*)::int n from public.subscription_orders", claims);
    expect(a2.ok, "authenticated reads subscription_orders without error", `subscription_orders: ${a2.err}`);
    const a3 = await roleRead("authenticated", "select count(*)::int n from public.banner_campaigns", claims);
    expect(a3.ok, "authenticated reads banner_campaigns without error", `banner_campaigns: ${a3.err}`);
  }

  // 6) admin/owner still sees EVERY plan (incl. inactive) via has_min_role path.
  const adm = await one(`select id from public.profiles where role in ('admin','super_admin','owner') order by created_at limit 1`);
  if (adm) {
    const total = num((await one("select count(*)::int n from public.pricing_plans")).n);
    const r = await roleRead("authenticated", "select count(*)::int n from public.pricing_plans", { sub: adm.id, role: "authenticated" });
    expect(r.ok && r.rows[0].n === total, `admin sees all ${total} plans (incl. inactive)`, `admin sees ${r.ok ? r.rows[0].n : "ERR:" + r.err} of ${total}`);
  } else {
    info("no admin profile found — admin visibility not exercised");
  }

  // 7) Data untouched (0041 writes nothing).
  const after = await snapshot();
  for (const [k, label] of [
    ["balanceRows", "balances row count"], ["balanceTotal", "balances total"],
    ["txRows", "ledger row count"], ["txTotal", "ledger total"],
    ["activeHolds", "active holds"], ["topups", "top-ups"], ["topupEgp", "top-up EGP"],
    ["listings", "listings"], ["profiles", "profiles"], ["plans", "plans"],
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
      await applyFile(join(root, "supabase", "migrations", "0041_owner_gap_policies_to_authenticated.sql"));
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
