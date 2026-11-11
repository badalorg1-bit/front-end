// Apply ONLY supabase/migrations/0032_availability.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0032, so it cannot be used for this batch. This
// script does a read-only pre-flight, applies exactly ONE file (0032), then
// runs a post-flight so the diff is the proof.
//
// Ordering gate: 0031 must be applied first (admin_resolve_dispute exists).
//
// 0032 is IDEMPOTENT BY DESIGN (create table if not exists / create policy
// if not exists / drop constraint if exists) — and it writes NO data rows,
// so a re-run cannot create an availability window or move a booking.
//
// Usage:
//   node scripts/bayna-apply-0032.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0032.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0032.mjs           # pre -> apply -> post
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
async function fnPriv(fnSig, grantee) {
  const r = await one("select has_function_privilege($1, $2, 'execute') as b", [grantee, fnSig]);
  return r.b === true;
}
async function policyRow(policyName) {
  const r = await one(
    "SELECT coalesce(qual,'') || ' ' || coalesce(with_check,'') AS q, roles FROM pg_policies WHERE schemaname='public' AND tablename='listing_availability' AND policyname = $1",
    [policyName],
  );
  return r ?? null;
}
async function gistDef() {
  const r = await one(
    "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'listing_requests_no_rental_overlap'",
  );
  return r?.d ?? "";
}

/**
 * Data snapshot — proves 0032 writes NO rows (availability windows,
 * requests, notifications, audit).
 */
async function dataSnapshot() {
  const a = (await tableExists("public", "listing_availability"))
    ? num((await one("select count(*)::int as n from public.listing_availability")).n)
    : 0;
  const r = await one("select count(*)::int as n from public.listing_requests");
  const n = await one("select count(*)::int as n from public.notifications");
  const g = await one("select count(*)::int as n from public.admin_audit_log");
  return { availability: a, requests: num(r.n), notifications: num(n.n), audit: num(g.n) };
}
let before = null;

/**
 * Conditions that must hold BEFORE 0032 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0032's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gate: 0031 must already be applied ---
  expect(
    (await procCount("admin_resolve_dispute")) >= 1,
    "0031 applied (admin_resolve_dispute exists)",
    "0031 NOT applied yet — apply scripts/bayna-apply-0031.mjs first",
  );

  // --- Tables the migration touches ---
  for (const t of ["listings", "listing_requests"]) {
    expect(await tableExists("public", t), `table ${t} exists`, `table ${t} missing`);
  }
  const ownerCol = await one(
    "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='listings' AND column_name='owner_id'",
  );
  expect(num(ownerCol.n) === 1, "listings.owner_id exists (RLS join target)", "listings.owner_id missing");

  // --- GiST constraint: present in either predicate (re-run safe) ---
  const def = await gistDef();
  if (!def) {
    console.log("  ! listing_requests_no_rental_overlap will be created by 0032 (first run).");
  } else if (def.includes("disputed")) {
    console.log("  ! GiST predicate already includes disputed (0032 applied) — re-run safe.");
  } else {
    ok("GiST predicate is still the 0001 accepted-only one (first run)");
  }

  // --- listing_availability: first run vs re-run ---
  if (!(await tableExists("public", "listing_availability"))) {
    console.log("  ! listing_availability will be created by 0032 (first run).");
  } else {
    console.log("  ! listing_availability already exists (0032 applied) — re-run safe.");
  }

  // --- Blast radius (reported, not gated) ---
  before = await dataSnapshot();
  console.log(
    `  ! data now: ${before.availability} availability window(s) · ${before.requests} request(s) · ` +
      `${before.notifications} notification(s) · ${before.audit} audit row(s)`,
  );
  console.log("  ! 0032 writes NONE of those — post-flight must see the exact same numbers.");
}

/** Conditions 0032 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshot: preflight() below reassigns `before`.
  const pre = before;
  await preflight();

  // 1) The table: exists, RLS on, anon denied, authenticated keeps access.
  expect(await tableExists("public", "listing_availability"), "listing_availability exists", "listing_availability missing");
  const rls = await one(
    "SELECT c.relrowsecurity AS b FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='listing_availability'",
  );
  expect(rls?.b === true, "RLS enabled on listing_availability", "RLS NOT enabled");
  expect(
    !(await one("select has_table_privilege('anon', 'public.listing_availability', 'select') as b")).b,
    "anon has NO direct access to the table",
    "anon can read listing_availability directly — must go through the RPC",
  );
  expect(
    (await one("select has_table_privilege('authenticated', 'public.listing_availability', 'select') as b")).b,
    "authenticated retains access (RLS scopes it to the owner)",
    "authenticated lost table access — owner editor would break",
  );

  // 2) The four owner policies, all scoped by auth.uid() via listings.
  for (const p of [
    "listing_availability_owner_select",
    "listing_availability_owner_insert",
    "listing_availability_owner_update",
    "listing_availability_owner_delete",
  ]) {
    const row = await policyRow(p);
    if (!row) {
      fail(`policy ${p} missing`);
      continue;
    }
    expect(row.q.includes("auth.uid"), `${p} gates on auth.uid()`, `${p} lacks auth.uid gate`);
    expect(row.q.includes("listings"), `${p} verifies listing ownership`, `${p} does not check the listing owner`);
    expect(
      Array.isArray(row.roles) ? row.roles.includes("authenticated") : String(row.roles).includes("authenticated"),
      `${p} targets authenticated`,
      `${p} wrong roles: ${row.roles}`,
    );
  }

  // 3) The widened GiST: disputed bookings hold the slot (§17.7).
  const newDef = await gistDef();
  expect(newDef.includes("disputed"), "GiST predicate includes disputed", `GiST def wrong: ${newDef}`);
  expect(newDef.includes("accepted"), "GiST predicate still includes accepted", "GiST lost the accepted predicate");
  expect(newDef.includes("gist"), "GiST access method intact", "GiST constraint not an exclusion constraint");

  // 4) The RPC: exists, anon+authenticated granted, public denied.
  const sig = "public.check_listing_availability(uuid, date, date)";
  expect((await procCount("check_listing_availability")) >= 1, "check_listing_availability exists", "RPC missing");
  expect(await fnPriv(sig, "authenticated"), "RPC granted to authenticated", "RPC not granted to authenticated");
  expect(await fnPriv(sig, "anon"), "RPC granted to anon (public listing page)", "RPC not granted to anon");
  expect(!(await fnPriv(sig, "public")), "RPC denied to public pseudo-role", "RPC leaked to public");

  // prosrc: calendar payload + every §4.9 gate.
  expect(await procHas("check_listing_availability", "availability_not_found"), "listing existence gate", "existence gate missing");
  expect(await procHas("check_listing_availability", "availability_invalid_range"), "range validation (start/end)", "range validation missing");
  expect(await procHas("check_listing_availability", "past_dates"), "past-date refusal", "past-date gate missing");
  expect(await procHas("check_listing_availability", "outside_availability"), "owner-window coverage reason", "window coverage missing");
  expect(await procHas("check_listing_availability", "generate_series"), "day-granular union coverage check", "coverage check missing");
  expect(await procHas("check_listing_availability", "conflict"), "conflict detection vs accepted+disputed", "conflict detection missing");
  expect(await procHas("check_listing_availability", "'windows'"), "payload carries the calendar windows", "windows payload missing");
  expect(await procHas("check_listing_availability", "'booked'"), "payload carries booked periods", "booked payload missing");
  expect(
    (await procHas("check_listing_availability", "public.listing_availability")) === true,
    "payload reads owner windows",
    "windows read missing",
  );
  expect(
    (await procHas("check_listing_availability", "'note'")) === false,
    "public payload never projects the private owner note",
    "RPC projects `note` — the public calendar must not expose it",
  );

  // 5) No data rows created by the apply itself.
  expect(!!pre, "pre-apply data snapshot captured", "no pre-apply snapshot");
  const after = await dataSnapshot();
  for (const k of ["availability", "requests", "notifications", "audit"]) {
    expect(
      !!pre && after[k] === pre[k],
      `${k} unchanged (${after[k]})`,
      `${k} CHANGED — pre ${pre?.[k]} vs post ${after[k]}`,
    );
  }
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0032_availability.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0032 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0032_availability.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0032's end state
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
