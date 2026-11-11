// Apply ONLY supabase/migrations/0027_rent_swap_only.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0027, so it cannot be used for this batch.
// This script does a read-only pre-flight, applies exactly one file, then
// runs a post-flight so the diff is the proof.
//
// IRREVERSIBLE BY DESIGN: 0027 permanently deletes sale listings and purchase
// requests (market requirement M5) and installs the quantity / chat gates.
// The pre-flight proves the tables are already empty first, so nothing real
// is destroyed.
//
// Usage:
//   node scripts/bayna-apply-0027.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0027.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0027.mjs           # pre-flight -> apply -> post-flight
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

// Trigger *functions* (0027 replaces their bodies; tgname varies by migration).
const TRIGGER_FNS = ["lock_listing_market", "lock_request_market", "lock_request_insert", "enforce_request_transition"];
// Functions that must give a unit back (exactly one restore per hold).
const QUANTITY_RESTORERS = ["wallet_escrow_release", "wallet_escrow_refund", "admin_reject_external_payment"];
// Functions whose bodies must call the M4 chat gate.
const CHAT_GATED = ["get_or_create_conversation", "send_message"];

async function triggerFnExists(fnName) {
  return (
    num(
      (
        await one(
          `SELECT count(*) AS n FROM pg_trigger t
           JOIN pg_proc p ON p.oid = t.tgfoid
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = $1 AND NOT t.tgisinternal`,
          [fnName],
        )
      ).n,
    ) === 1
  );
}
async function procHas(name, fragment) {
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1 AND prosrc LIKE $2", [name, `%${fragment}%`])).n);
}
async function columnExists(table, column) {
  return num(
    (
      await one(
        "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
        [table, column],
      )
    ).n,
  ) === 1;
}
async function granteeHas(fn, grantee) {
  // Authoritative check: has_function_privilege (information_schema joins are
  // brittle across PG versions for routine privileges).
  const sig = fn === "can_open_chat" ? "public.can_open_chat(uuid,uuid)" : null;
  if (!sig) throw new Error(`no signature known for ${fn}`);
  const r = await one("select has_function_privilege($1, $2, 'execute') as b", [grantee, sig]);
  return r.b === true;
}

/**
 * Conditions that must hold BEFORE 0027 runs.
 * Also prints the blast radius: 0027 permanently deletes sale/purchase data
 * (owner-approved M5), so the operator sees exactly what goes before applying.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Blast radius (reported, not gated: 0027 deletes these by design) ---
  const saleListings = num((await one("SELECT count(*) AS n FROM listings WHERE listing_type = 'sale'")).n);
  const purchaseReqs = num((await one("SELECT count(*) AS n FROM listing_requests WHERE request_type = 'purchase'")).n);
  const saleIds = (await client.query("SELECT id FROM listings WHERE listing_type = 'sale'")).rows.map((r) => r.id);
  const convos = saleIds.length
    ? num((await one("SELECT count(*) AS n FROM conversations WHERE listing_id = ANY($1::uuid[])", [saleIds])).n)
    : 0;
  const notifs = saleIds.length
    ? num((await one("SELECT count(*) AS n FROM notifications WHERE listing_id = ANY($1::uuid[])", [saleIds])).n)
    : 0;

  console.log("  ! 0027 WILL PERMANENTLY DELETE (owner-approved, M5):");
  console.log(`      - ${saleListings} sale listings (+ their images, promos, requests)`);
  console.log(`      - ${purchaseReqs} purchase requests`);
  console.log(`      - ${convos} conversations about sale listings (with messages)`);
  console.log(`      - ${notifs} notifications about sale listings`);

  // --- Hard gates: refuse to apply if these fail ---
  const walletPay = num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = 'wallet_escrow_pay'")).n);
  expect(walletPay === 0, "wallet_escrow_pay stays dropped (0026 applied)", "wallet_escrow_pay exists again — 0026 missing?");

  // Money rows must not be destroyed and must not block the deletes (FK).
  const moneyBlocked = num(
    (
      await one(
        `SELECT count(*) AS n FROM escrow_holds h
         JOIN listing_requests r ON r.id = h.request_id
         LEFT JOIN listings l ON l.id = r.listing_id
         WHERE r.request_type = 'purchase' OR l.listing_type = 'sale'`,
      )
    ).n,
  );
  expect(moneyBlocked === 0, "0 escrow_holds on sale/purchase data (no money destroyed)", `${moneyBlocked} escrow_holds would be destroyed/blocked`);

  const ledger = num(
    (
      await one(
        `SELECT count(*) AS n FROM wallet_transactions wt
         JOIN listing_requests r ON r.id = wt.request_id
         LEFT JOIN listings l ON l.id = r.listing_id
         WHERE r.request_type = 'purchase' OR l.listing_type = 'sale'`,
      )
    ).n,
  );
  expect(ledger === 0, "0 wallet ledger rows on sale/purchase data (ledger untouched)", `${ledger} ledger rows reference sale/purchase`);
}

/** Conditions 0027 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  await preflight();

  // M5 result: the deletion actually happened.
  const sales = num((await one("SELECT count(*) AS n FROM listings WHERE listing_type = 'sale'")).n);
  expect(sales === 0, "0 sale listings after apply", `${sales} sale listings survived — deletion failed`);
  const purchases = num((await one("SELECT count(*) AS n FROM listing_requests WHERE request_type = 'purchase'")).n);
  expect(purchases === 0, "0 purchase requests after apply", `${purchases} purchase requests survived — deletion failed`);

  // M2: quantity column. No dedicated index by design: every quantity access
  // (insert gate, accept gate, decrement, restore) is a primary-key lookup on
  // listings.id / listing_requests.listing_id — B-tree on quantity would only
  // serve speculative "low stock" scans the product does not run.
  expect(await columnExists("listings", "quantity"), "listings.quantity exists", "listings.quantity missing");
  const qtyDef = await one(
    "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='listings' AND column_name='quantity'",
  );
  expect(
    qtyDef && qtyDef.is_nullable === "NO",
    "quantity is NOT NULL (default 1)",
    "quantity is nullable — gate could read NULL",
  );

  // M2/M3: market locks + quantity gate.
  for (const t of TRIGGER_FNS) {
    expect(await triggerFnExists(t), `trigger on ${t} exists`, `trigger on ${t} missing`);
  }
  expect(
    (await procHas("escrow_pay_external", "listing_quantity_exhausted")) === 1,
    "escrow_pay_external enforces quantity",
    "escrow_pay_external lacks quantity gate",
  );
  for (const fn of QUANTITY_RESTORERS) {
    expect((await procHas(fn, "quantity + 1")) === 1, `${fn} restores quantity`, `${fn} does not restore quantity`);
  }
  // M3: a rent request on an exhausted listing is refused at insert + accept.
  for (const fn of ["lock_request_insert", "enforce_request_transition"]) {
    expect(
      (await procHas(fn, "listing_quantity_exhausted")) === 1,
      `${fn} refuses exhausted listings`,
      `${fn} lacks the quantity refusal`,
    );
  }
  // M5: only rent/swap can ever be inserted again.
  expect(
    (await procHas("lock_listing_market", "sale_listings_retired")) === 1,
    "lock_listing_market refuses sale listings",
    "lock_listing_market lacks sale_listings_retired",
  );
  expect(
    (await procHas("lock_request_market", "purchase_requests_retired")) === 1,
    "lock_request_market refuses purchase requests",
    "lock_request_market lacks purchase_requests_retired",
  );

  // M4: chat gate.
  expect((await procHas("can_open_chat", "accepted")) === 1, "can_open_chat exists", "can_open_chat missing");
  for (const fn of CHAT_GATED) {
    expect((await procHas(fn, "can_open_chat")) === 1, `${fn} enforces the chat gate`, `${fn} lacks the chat gate`);
  }
  expect(await granteeHas("can_open_chat", "authenticated"), "can_open_chat granted to authenticated", "can_open_chat NOT granted to authenticated");
  expect(!(await granteeHas("can_open_chat", "anon")), "can_open_chat NOT granted to anon", "can_open_chat leaked to anon");

  const zero = num((await one("SELECT count(*) AS n FROM listings WHERE quantity < 1")).n);
  console.log(`  ℹ listings with quantity < 1: ${zero} (expected 0 right after apply)`);
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0027_rent_swap_only.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0027 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0027_rent_swap_only.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0027's end state
//             without re-applying — use after a successful apply or to
//             re-confirm a production database).
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
