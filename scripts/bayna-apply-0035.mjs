// Apply ONLY supabase/migrations/0035_payment_qr_sources.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 only,
// and 0024+ each got their own single-file applier (see bayna-apply-0034.mjs).
// 0035 follows the same pattern: read-only pre-flight, apply exactly ONE file
// in a single transaction, then a post-flight so the diff is the proof.
//
// 0035 is IDEMPOTENT BY DESIGN (add column if not exists + drop/create
// functions) and writes NO business data — only the platform_settings schema
// (one new column) and the two RPC signatures change.
//
// Usage:
//   node scripts/bayna-apply-0035.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0035.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0035.mjs           # pre -> apply -> post
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

async function procCount(name) {
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1", [name])).n);
}
async function fnPriv(fnSig, grantee) {
  const r = await one("select has_function_privilege($1, $2, 'execute') as b", [grantee, fnSig]);
  return r.b === true;
}
async function columnExists(table, column) {
  return (
    num(
      (
        await one(
          "SELECT count(*) AS N FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
          [table, column],
        )
      ).n,
    ) === 1
  );
}

/** Business snapshot — 0035 must not touch any of it. */
async function settingsSnapshot() {
  const r = await one(
    `select badal_wallet_name, badal_qr_path, badal_instagram, escrow_fee_percent,
            point_value_egp, free_listings_per_cycle, per_listing_price_egp,
            (select count(*)::int from public.admin_audit_log) as audit_n
     from public.platform_settings where id = 1`,
  );
  return r ?? null;
}

let before = null;

async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  expect(!!(await one("select 1 from public.platform_settings where id = 1")), "platform_settings row id=1 exists", "platform_settings row id=1 MISSING");
  expect(await columnExists("platform_settings", "badal_qr_path"), "legacy badal_qr_path column exists", "legacy badal_qr_path column missing");
  expect((await procCount("has_min_role")) >= 1, "has_min_role exists (set-fn gate)", "has_min_role missing");
  expect((await procCount("get_badal_payment_settings")) >= 1, "get_badal_payment_settings exists", "get_badal_payment_settings missing");
  expect((await procCount("admin_set_badal_payment")) >= 1, "admin_set_badal_payment exists", "admin_set_badal_payment missing");

  if (!(await columnExists("platform_settings", "badal_wallet_qr_path"))) {
    console.log("  ! badal_wallet_qr_path will be created by 0035 (first run).");
  } else {
    console.log("  ! badal_wallet_qr_path already exists (0035 applied) — re-run safe.");
  }

  before = await settingsSnapshot();
  console.log(`  ! settings now: wallet_name=${before?.badal_wallet_name} | qr_path=${before?.badal_qr_path} | instagram=${before?.badal_instagram} | fee=${before?.escrow_fee_percent} | audit=${before?.audit_n}`);
  console.log("  ! 0035 writes NONE of those (schema + 2 RPC signatures only) — post-flight must see the same values.");
}

async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  const pre = before;
  await preflight();

  // 1) New column present.
  expect(await columnExists("platform_settings", "badal_wallet_qr_path"), "badal_wallet_qr_path column exists", "badal_wallet_qr_path column MISSING");

  // 2) get: new return shape works, old columns still there, exactly one fn.
  expect((await procCount("get_badal_payment_settings")) === 1, "exactly one get fn", `get fn count = ${await procCount("get_badal_payment_settings")}`);
  try {
    const row = await one("select wallet_name, qr_path, wallet_qr_path, instagram, fee_percent from public.get_badal_payment_settings()");
    expect(!!row, "get returns all 5 columns", "get did not return a row");
    expect(row && "wallet_qr_path" in row, "get carries wallet_qr_path", "get missing wallet_qr_path");
  } catch (e) {
    fail(`get return shape broken: ${e.message}`);
  }
  expect(await fnPriv("public.get_badal_payment_settings()", "authenticated"), "get granted to authenticated", "get NOT granted to authenticated");
  expect(await fnPriv("public.get_badal_payment_settings()", "anon"), "get granted to anon", "get NOT granted to anon");
  expect(!(await fnPriv("public.get_badal_payment_settings()", "public")), "get denied to public pseudo-role", "get leaked to public");

  // 3) set: exactly one fn, 4 args, new param + new column in body, gate kept.
  expect((await procCount("admin_set_badal_payment")) === 1, "exactly one set fn", `set fn count = ${await procCount("admin_set_badal_payment")}`);
  const setFn = await one(
    `select pronargs, proargnames::text[] as args, prosrc
     from pg_proc where proname='admin_set_badal_payment'`,
  );
  expect(num(setFn?.pronargs) === 4, "set takes 4 args", `set takes ${setFn?.pronargs} args`);
  expect(!!setFn && setFn.args.includes("p_wallet_qr_path"), "set carries p_wallet_qr_path", "set missing p_wallet_qr_path");
  expect(!!setFn && setFn.prosrc.includes("badal_wallet_qr_path = coalesce(p_wallet_qr_path"), "set writes badal_wallet_qr_path", "set does not write badal_wallet_qr_path");
  expect(!!setFn && setFn.prosrc.includes("has_min_role('admin')"), "set keeps has_min_role('admin') gate", "set LOST its admin gate");
  expect(!!setFn && setFn.prosrc.includes("'set_badal_payment'"), "set keeps its audit action", "set lost its audit row");
  expect(await fnPriv("public.admin_set_badal_payment(text, text, text, text)", "authenticated"), "set granted to authenticated", "set NOT granted to authenticated");
  expect(!(await fnPriv("public.admin_set_badal_payment(text, text, text, text)", "anon")), "set denied to anon", "set leaked to anon");
  expect(!(await fnPriv("public.admin_set_badal_payment(text, text, text, text)", "public")), "set denied to public pseudo-role", "set leaked to public");

  // 4) Business data untouched.
  expect(!!pre, "pre-apply settings snapshot captured", "no pre-apply snapshot");
  const after = await settingsSnapshot();
  for (const k of ["badal_wallet_name", "badal_qr_path", "badal_instagram", "escrow_fee_percent", "point_value_egp", "free_listings_per_cycle", "per_listing_price_egp", "audit_n"]) {
    expect(!!pre && String(after?.[k]) === String(pre[k]), `${k} unchanged (${after?.[k]})`, `${k} CHANGED — pre ${pre?.[k]} vs post ${after?.[k]}`);
  }
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0035_payment_qr_sources.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0035 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0035_payment_qr_sources.sql (${sql.length} bytes) ==`);
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
