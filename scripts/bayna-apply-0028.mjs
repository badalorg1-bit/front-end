// Apply ONLY supabase/migrations/0028_booking_handover_codes.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0028, so it cannot be used for this batch.
// This script does a read-only pre-flight, applies exactly one file, then
// runs a post-flight so the diff is the proof.
//
// 0028 is IDEMPOTENT BY DESIGN (create table if not exists / insert ... where
// not exists / create or replace / drop policy if exists / on conflict do
// nothing), so a re-run is safe — but the pre-flight still proves the
// helpers it depends on exist first.
//
// Usage:
//   node scripts/bayna-apply-0028.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0028.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0028.mjs           # pre-flight -> apply -> post-flight
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
  return num((await one("SELECT count(*) AS n FROM pg_proc WHERE proname = $1 AND prosrc LIKE $2", [name, `%${fragment}%`])).n) === 1;
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
async function tblPriv(table, grantee) {
  const r = await one("select has_table_privilege($1, $2, 'select') as b", [grantee, table]);
  return r.b === true;
}

/**
 * Conditions that must hold BEFORE 0028 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0028's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Blast radius (reported, not gated) ---
  const held = num((await one("SELECT count(*) AS n FROM escrow_holds WHERE status = 'held'")).n);
  const pending = num((await one("SELECT count(*) AS n FROM escrow_holds WHERE status = 'pending_confirmation'")).n);
  const other = num((await one("SELECT count(*) AS n FROM escrow_holds WHERE status NOT IN ('held','pending_confirmation')")).n);
  const applied = await tableExists("public", "booking_handover_codes");
  console.log(`  ! escrow_holds now: ${held} held, ${pending} pending_confirmation, ${other} released/refunded`);
  console.log(
    applied
      ? "  ℹ booking_handover_codes already exists — a re-run is idempotent (no overwrite)."
      : `  ! 0028 will create booking_handover_codes and mint codes for the ${held} held hold(s).`,
  );

  // --- Hard gates: refuse to apply if these fail ---
  const pgcrypto = num(
    (
      await one(
        `SELECT count(*) AS n FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'extensions' AND p.proname = 'gen_random_bytes'`,
      )
    ).n,
  );
  expect(pgcrypto === 1, "extensions.gen_random_bytes available (code minting)", "extensions.gen_random_bytes missing");

  for (const fn of ["has_min_role", "is_user_banned", "enforce_request_transition"]) {
    const n = num(
      (
        await one(
          `SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [fn],
        )
      ).n,
    );
    expect(n === 1, `helper ${fn} exists`, `helper ${fn} missing`);
  }

  for (const fn of ["admin_confirm_external_payment", "wallet_escrow_release"]) {
    const n = num(
      (
        await one(
          `SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [fn],
        )
      ).n,
    );
    expect(n === 1, `${fn} exists (will be replaced)`, `${fn} missing — wrong migration baseline`);
  }

  expect(
    await tblPriv("public.listing_requests", "authenticated"),
    "authenticated can read listing_requests (RPCs depend on it)",
    "authenticated lost listing_requests SELECT",
  );
}

/** Conditions 0028 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  await preflight();

  // Table + shape.
  expect(await tableExists("public", "booking_handover_codes"), "booking_handover_codes exists", "booking_handover_codes missing");
  for (const c of ["purpose", "code", "valid_until", "attempts", "used_at", "used_by", "condition_note", "photos"]) {
    expect(await columnExists("booking_handover_codes", c), `column ${c} exists`, `column ${c} missing`);
  }
  const uniq = num(
    (
      await one(
        `SELECT count(*) AS n FROM pg_constraint
          WHERE conrelid = 'public.booking_handover_codes'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) LIKE '%(request_id, purpose)%'`,
      )
    ).n,
  );
  expect(uniq === 1, "unique (request_id, purpose)", "unique (request_id, purpose) missing");

  // Locked down: RLS on, zero policies, no default grants.
  const rls = await one("SELECT relrowsecurity AS b FROM pg_class WHERE oid = 'public.booking_handover_codes'::regclass");
  expect(rls && rls.b === true, "RLS enabled on booking_handover_codes", "RLS NOT enabled");
  const pols = num(
    (await one("SELECT count(*) AS n FROM pg_policies WHERE schemaname='public' AND tablename='booking_handover_codes'")).n,
  );
  expect(pols === 0, "zero RLS policies (blocked by default)", `${pols} policies exist — table is open?`);
  for (const role of ["anon", "authenticated", "service_role"]) {
    expect(!(await tblPriv("public.booking_handover_codes", role)), `${role} has NO table grant`, `${role} can SELECT codes directly!`);
  }

  // RPCs exist, correct bodies, correct grants.
  expect(await procHas("get_handover_codes", "has_min_role"), "get_handover_codes exists (status-only for mods)", "get_handover_codes missing/wrong");
  expect(await procHas("verify_handover_code", "code_mismatch"), "verify_handover_code exists (returns ok:false)", "verify_handover_code missing/wrong");
  expect(
    await procHas("verify_handover_code", "attempts + 1"),
    "verify_handover_code increments attempts",
    "verify_handover_code lacks attempt counting",
  );
  expect(
    await procHas("verify_handover_code", "invalid photo path"),
    "verify_handover_code validates photo paths",
    "verify_handover_code lacks photo path validation",
  );
  expect(
    await fnPriv("public.get_handover_codes(uuid)", "authenticated"),
    "authenticated may call get_handover_codes",
    "get_handover_codes NOT granted to authenticated",
  );
  expect(
    !(await fnPriv("public.get_handover_codes(uuid)", "anon")),
    "anon may NOT call get_handover_codes",
    "get_handover_codes leaked to anon",
  );
  expect(
    await fnPriv("public.verify_handover_code(uuid, text, text, text, text[])", "authenticated"),
    "authenticated may call verify_handover_code",
    "verify_handover_code NOT granted to authenticated",
  );
  expect(
    !(await fnPriv("public.verify_handover_code(uuid, text, text, text, text[])", "anon")),
    "anon may NOT call verify_handover_code",
    "verify_handover_code leaked to anon",
  );

  // Replacements actually landed.
  expect(
    await procHas("admin_confirm_external_payment", "booking_handover_codes"),
    "admin_confirm_external_payment mints codes",
    "admin_confirm_external_payment does not mint codes",
  );
  expect(
    await procHas("admin_confirm_external_payment", "gen_random_bytes"),
    "admin_confirm uses CSPRNG for codes",
    "admin_confirm lacks CSPRNG",
  );
  expect(
    await procHas("wallet_escrow_release", "return_code_required"),
    "wallet_escrow_release enforces the return-code gate",
    "wallet_escrow_release lacks return_code_required",
  );
  expect(
    await procHas("wallet_escrow_release", "escrow_release_return_code_bypass"),
    "wallet_escrow_release audits moderator bypass",
    "wallet_escrow_release does not audit bypass",
  );
  expect(
    await procHas("wallet_escrow_release", "quantity + 1"),
    "wallet_escrow_release still restores quantity",
    "wallet_escrow_release lost the quantity restore",
  );
  expect(
    await fnPriv("public.admin_confirm_external_payment(uuid)", "authenticated"),
    "admin_confirm still granted to authenticated",
    "admin_confirm grant lost on replace",
  );
  expect(
    await fnPriv("public.wallet_escrow_release(uuid)", "authenticated"),
    "wallet_escrow_release still granted to authenticated",
    "wallet_escrow_release grant lost on replace",
  );

  // Storage: private bucket + exactly the two policies.
  const bucket = await one("SELECT public FROM storage.buckets WHERE id = 'handover-photos'");
  expect(!!bucket, "handover-photos bucket exists", "handover-photos bucket missing");
  expect(bucket && bucket.public === false, "handover-photos is PRIVATE", "handover-photos is public!");
  const spols = num(
    (
      await one(
        `SELECT count(*) AS n FROM pg_policies
          WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'handover_photos%'`,
      )
    ).n,
  );
  expect(spols === 2, "exactly 2 storage policies (insert + select)", `${spols} handover policies found (expected 2)`);

  // Backfill sanity: every held hold has both codes (0 held right now -> 0 rows).
  const held = num((await one("SELECT count(*) AS n FROM escrow_holds WHERE status = 'held'")).n);
  const rows = num((await one("SELECT count(*) AS n FROM booking_handover_codes")).n);
  expect(
    rows === held * 2,
    `code rows (${rows}) = 2 x held holds (${held})`,
    `code rows (${rows}) != 2 x held holds (${held}) — backfill/mint mismatch`,
  );
  const badCode = num(
    (await one("SELECT count(*) AS n FROM booking_handover_codes WHERE code !~ '^[0-9]{6}$'")).n,
  );
  expect(badCode === 0, "all codes are 6 digits", `${badCode} malformed codes`);
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0028_booking_handover_codes.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0028 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0028_booking_handover_codes.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0028's end state
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
