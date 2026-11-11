// Apply ONLY supabase/migrations/0033_delivery.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0033, so it cannot be used for this batch. This
// script does a read-only pre-flight, applies exactly ONE file (0033), then
// runs a post-flight so the diff is the proof.
//
// Ordering gate: 0032 must be applied first (check_listing_availability
// exists).
//
// 0033 is IDEMPOTENT BY DESIGN (add column if not exists / create table if
// not exists / drop trigger if exists) — and it writes NO data rows, so a
// re-run cannot create a delivery order or move a booking.
//
// Usage:
//   node scripts/bayna-apply-0033.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0033.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0033.mjs           # pre -> apply -> post
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
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const num = (v) => Number(v ?? 0);
const expect = (cond, msgOk, msgFail) => (cond ? ok(msgOk) : fail(msgFail));

async function procHas(name, fragment) {
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1 AND prosrc LIKE $2", [name, `%${fragment}%`])).n) >= 1;
}
async function procCount(name) {
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1", [name])).n);
}
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
async function fnPriv(fnSig, grantee) {
  const r = await one("select has_function_privilege($1, $2, 'execute') as b", [grantee, fnSig]);
  return r.b === true;
}
async function triggerExists(name) {
  return (
    num(
      (
        await one(
          "SELECT count(*) AS n FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal",
          [name],
        )
      ).n,
    ) === 1
  );
}
async function tableGrantsRevoked(table) {
  // The OWNER (postgres) keeps its implicit rights — the security-definer
  // RPCs need them. What must be ZERO: every client-facing role.
  const r = await one(
    "SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=$1 AND grantee <> 'postgres'",
    [table],
  );
  return num(r.n) === 0;
}

/**
 * Data snapshot — proves 0033 writes NO rows (delivery orders, requests,
 * notifications, audit).
 */
async function dataSnapshot() {
  const d = (await tableExists("public", "delivery_orders"))
    ? num((await one("select count(*)::int as n from public.delivery_orders")).n)
    : 0;
  const r = await one("select count(*)::int as n from public.listing_requests");
  const n = await one("select count(*)::int as n from public.notifications");
  const g = await one("select count(*)::int as n from public.admin_audit_log");
  const l = await one("select count(*)::int as n from public.listings");
  return { deliveryOrders: d, requests: num(r.n), notifications: num(n.n), audit: num(g.n), listings: num(l.n) };
}
let before = null;

/**
 * Conditions that must hold BEFORE 0033 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0033's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gate: 0032 must already be applied ---
  expect(
    (await procCount("check_listing_availability")) >= 1,
    "0032 applied (check_listing_availability exists)",
    "0032 NOT applied yet — apply scripts/bayna-apply-0032.mjs first",
  );

  // --- Tables the migration touches ---
  for (const t of ["listings", "listing_requests", "profiles", "complaints"]) {
    expect(await tableExists("public", t), `table ${t} exists`, `table ${t} missing`);
  }

  // --- Columns: first run vs re-run ---
  for (const [t, c] of [
    ["listings", "delivery_available"],
    ["listings", "delivery_fee"],
    ["listing_requests", "delivery_requested"],
    ["listing_requests", "delivery_address"],
  ]) {
    if (!(await columnExists(t, c))) {
      console.log(`  ! ${t}.${c} will be added by 0033 (first run).`);
    } else {
      console.log(`  ! ${t}.${c} already exists (0033 applied) — re-run safe.`);
    }
  }

  // --- Trigger: first run vs re-run ---
  if (!(await triggerExists("listing_requests_enforce_delivery"))) {
    console.log("  ! listing_requests_enforce_delivery will be created by 0033 (first run).");
  } else {
    console.log("  ! listing_requests_enforce_delivery already exists (0033 applied) — re-run safe.");
  }

  // --- delivery_orders: first run vs re-run ---
  if (!(await tableExists("public", "delivery_orders"))) {
    console.log("  ! delivery_orders will be created by 0033 (first run).");
  } else {
    console.log("  ! delivery_orders already exists (0033 applied) — re-run safe.");
  }

  // --- Blast radius (reported, not gated) ---
  before = await dataSnapshot();
  console.log(
    `  ! data now: ${before.deliveryOrders} delivery order(s) · ${before.requests} request(s) · ` +
      `${before.listings} listing(s) · ${before.notifications} notification(s) · ${before.audit} audit row(s)`,
  );
  console.log("  ! 0033 writes NONE of those — post-flight must see the exact same numbers.");
}

/** Conditions 0033 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshot: preflight() below reassigns `before`.
  const pre = before;
  await preflight();

  // 1) Columns exist with the right types.
  for (const [t, c, type] of [
    ["listings", "delivery_available", "boolean"],
    ["listings", "delivery_fee", "numeric"],
    ["listing_requests", "delivery_requested", "boolean"],
    ["listing_requests", "delivery_address", "text"],
  ]) {
    const r = await one(
      "SELECT data_type AS t FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
      [t, c],
    );
    expect(r?.t === type, `${t}.${c} is ${type}`, `${t}.${c} wrong type: ${r?.t ?? "missing"}`);
  }

  // 2) The §9.2 server-side gate on requests.
  expect(await triggerExists("listing_requests_enforce_delivery"), "enforce trigger installed", "trigger missing");
  expect(
    await procHas("enforce_delivery_fields", "delivery_rent_only"),
    "rent-only gate",
    "rent-only gate missing",
  );
  expect(
    await procHas("enforce_delivery_fields", "delivery_address_required"),
    "address gate",
    "address gate missing",
  );
  expect(
    await procHas("enforce_delivery_fields", "delivery_not_available"),
    "listing-offers-delivery gate",
    "delivery_available gate missing",
  );

  // 3) delivery_orders: exists, RLS on, ALL grants revoked (RPC-only).
  expect(await tableExists("public", "delivery_orders"), "delivery_orders exists", "delivery_orders missing");
  const rls = await one(
    "SELECT c.relrowsecurity AS b FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='delivery_orders'",
  );
  expect(rls?.b === true, "RLS enabled on delivery_orders", "RLS NOT enabled");
  expect(
    await tableGrantsRevoked("delivery_orders"),
    "no client-role grants (only the owner postgres — RPCs only)",
    "delivery_orders still grants a client role (anon/authenticated/service_role)",
  );
  const uniq = await one(
    "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND tablename='delivery_orders' AND indexdef LIKE '%UNIQUE%'",
  );
  expect(num(uniq.n) >= 1, "one-order-per-booking UNIQUE index", "request_id UNIQUE missing");
  const checks = await one(
    "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.delivery_orders'::regclass AND contype = 'c'",
  );
  expect(num(checks.n) >= 6, "delivery_orders CHECK constraints (status, proof, note)", `only ${checks.n} checks`);

  // 4) The four RPCs: exist, granted to authenticated, denied to anon/public.
  const rpcs = [
    ["admin_create_delivery_order", "public.admin_create_delivery_order(uuid, text, text, numeric, text)"],
    ["admin_update_delivery_order", "public.admin_update_delivery_order(uuid, text, text, text)"],
    ["get_delivery_order", "public.get_delivery_order(uuid)"],
    ["admin_list_delivery_orders", "public.admin_list_delivery_orders()"],
  ];
  for (const [name, sig] of rpcs) {
    expect((await procCount(name)) >= 1, `${name} exists`, `${name} missing`);
    expect(await fnPriv(sig, "authenticated"), `${name} granted to authenticated`, `${name} not granted to authenticated`);
    expect(!(await fnPriv(sig, "anon")), `${name} denied to anon`, `${name} leaked to anon`);
    expect(!(await fnPriv(sig, "public")), `${name} denied to public pseudo-role`, `${name} leaked to public`);
  }

  // prosrc: the §9.2 gates, on the right functions.
  expect(await procHas("admin_create_delivery_order", "delivery_requires_accepted_booking"), "accepted-booking gate", "accepted gate missing");
  expect(await procHas("admin_create_delivery_order", "delivery_order_exists"), "one-order-per-booking gate", "duplicate gate missing");
  expect(await procHas("admin_create_delivery_order", "provider_required"), "provider gate", "provider gate missing");
  expect(await procHas("admin_create_delivery_order", "courier_order_no_too_long"), "order-no length gate", "order-no gate missing");
  expect(await procHas("admin_create_delivery_order", "delivery_address_required"), "address fallback gate", "address gate missing");
  expect(await procHas("admin_create_delivery_order", "admin_audit_log"), "audit row on create", "audit missing");
  expect(await procHas("admin_create_delivery_order", "notify_user"), "both parties notified (§7.1 step 13)", "notifications missing");

  expect(await procHas("admin_update_delivery_order", "invalid_delivery_status"), "status whitelist", "status gate missing");
  expect(await procHas("admin_update_delivery_order", "delivery_order_closed"), "terminal-state immutability", "terminal gate missing");
  expect(await procHas("admin_update_delivery_order", "invalid_delivery_transition"), "strict transitions", "transition gate missing");
  expect(await procHas("admin_update_delivery_order", "delivery_note_required"), "delay/failure note gate", "note gate missing");
  expect(await procHas("admin_update_delivery_order", "delivered_to_required"), "proof-of-delivery gate", "proof gate missing");
  expect(await procHas("admin_update_delivery_order", "admin_audit_log"), "audit row on update", "audit missing");

  expect(await procHas("get_delivery_order", "not a participant"), "participant-only read", "participant gate missing");
  expect(await procHas("admin_list_delivery_orders", "has_min_role"), "moderator+ list gate", "role gate missing");
  expect(await procHas("admin_list_delivery_orders", "delivery_requested"), "eligible list carries the §9.2 flags", "eligible payload missing");
  expect(await procHas("admin_list_delivery_orders", "مشكلة في التوصيل"), "linked delivery complaints (§9.2)", "complaint linkage missing");

  // 5) No data rows created by the apply itself.
  expect(!!pre, "pre-apply data snapshot captured", "no pre-apply snapshot");
  const after = await dataSnapshot();
  for (const k of ["deliveryOrders", "requests", "listings", "notifications", "audit"]) {
    expect(
      !!pre && after[k] === pre[k],
      `${k} unchanged (${after[k]})`,
      `${k} CHANGED — pre ${pre?.[k]} vs post ${after[k]}`,
    );
  }
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0033_delivery.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0033 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0033_delivery.sql (${sql.length} bytes) ==`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
    ok("COMMIT succeeded");
  } catch (e) {
    await client.query("ROLLBACK");
    fail(`ROLLBACK — ${e.message}`);
    throw e;
  }
}

// --check   : pre-flight only (read-only).
// --verify  : pre-flight + post-flight (read-only; proves 0033's end state
//             without re-applying — use after a successful apply).
// (no flag) : pre-flight -> apply (single transaction) -> post-flight.
const checkOnly = process.argv.includes("--check");
const verifyOnly = process.argv.includes("--verify");

try {
  await client.connect();
  await preflight();
  if (checkOnly) {
    console.log("\n--check: read-only pre-flight only. No writes performed.");
    if (failures.length) process.exitCode = 1;
  } else if (verifyOnly) {
    await postflight();
    console.log(failures.length ? `\nVERIFY FAILED (${failures.length})` : "\nVERIFY: ALL CHECKS PASSED");
    if (failures.length) process.exitCode = 1;
  } else if (failures.length) {
    console.error(`\nPRE-FLIGHT FAILED (${failures.length}) — refusing to apply.`);
    process.exitCode = 1;
  } else {
    await applyMigration();
    await postflight();
    console.log(failures.length ? `\nPOST-FLIGHT FAILED (${failures.length})` : "\nALL CHECKS PASSED");
    if (failures.length) process.exitCode = 1;
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
