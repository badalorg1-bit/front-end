// Apply ONLY supabase/migrations/0029_points_wallet.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0029, so it cannot be used for this batch. This
// script does a read-only pre-flight, applies exactly ONE file (0029), then
// runs a post-flight so the diff is the proof.
//
// Ordering gate: 0029 replaces escrow_pay_external and redefines
// wallet_escrow_release ON TOP of 0028's return-code gate, so this script
// refuses to run until booking_handover_codes exists (apply 0028 first).
//
// 0029 is IDEMPOTENT BY DESIGN (add column if not exists / create or replace /
// drop function if exists / on conflict do nothing) — and deliberately runs
// NO numeric backfill, so a re-run cannot double anything.
//
// Usage:
//   node scripts/bayna-apply-0029.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0029.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0029.mjs           # pre -> apply -> post
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

/** Money snapshot — proves 0029 ran NO numeric backfill. */
async function moneySnapshot() {
  const b = await one(
    "select count(*)::int as rows, coalesce(sum(balance),0) as total from public.wallet_balances",
  );
  const t = await one(
    "select count(*)::int as rows, coalesce(sum(amount),0) as total from public.wallet_transactions",
  );
  const h = await one(
    "select count(*)::int as n from public.escrow_holds where status in ('held','pending_confirmation')",
  );
  const u = await one(
    "select count(*)::int as n, coalesce(sum(amount_egp),0) as egp from public.wallet_topups",
  );
  return {
    balanceRows: num(b.rows),
    balanceTotal: Number(b.total),
    txRows: num(t.rows),
    txTotal: Number(t.total),
    activeHolds: num(h.n),
    topups: num(u.n),
    topupEgp: Number(u.egp),
  };
}
let before = null;

/**
 * Conditions that must hold BEFORE 0029 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0029's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gate: 0028 must already be applied ---
  expect(
    await tableExists("public", "booking_handover_codes"),
    "0028 applied (booking_handover_codes exists)",
    "0028 NOT applied yet — apply scripts/bayna-apply-0028.mjs first (0029 sits on top of its gate)",
  );
  expect(
    await procHas("wallet_escrow_release", "return_code_required"),
    "wallet_escrow_release already carries the 0028 return-code gate",
    "wallet_escrow_release lacks the 0028 gate — wrong migration baseline",
  );

  // --- Helpers 0029 redefines against ---
  for (const fn of ["has_min_role", "is_user_banned", "get_escrow_fee_percent", "admin_review_wallet_topup", "escrow_pay_external"]) {
    const n = await procCount(fn);
    expect(n >= 1, `helper ${fn} exists (will be replaced)`, `helper ${fn} missing — wrong migration baseline`);
  }
  expect(
    await tableExists("public", "platform_settings"),
    "platform_settings exists",
    "platform_settings missing",
  );
  const settingsRow = await one("SELECT count(*) AS n FROM public.platform_settings WHERE id = 1");
  expect(num(settingsRow.n) === 1, "platform_settings row id=1 present", "platform_settings row id=1 missing");

  // --- Blast radius (reported, not gated) ---
  before = await moneySnapshot();
  console.log(
    `  ! money now: ${before.balanceRows} balance row(s) = ${before.balanceTotal} · ` +
      `${before.txRows} ledger row(s) = ${before.txTotal} · ` +
      `${before.activeHolds} active hold(s) · ${before.topups} top-up(s) = ${before.topupEgp} EGP`,
  );
  console.log(
    "  ! 0029 re-reads those figures as POINTS (no numeric backfill) — post-flight must see the exact same numbers.",
  );

  const hasValue = await columnExists("platform_settings", "point_value_egp");
  console.log(
    hasValue
      ? "  ℹ point_value_egp already exists — a re-run is idempotent."
      : "  ! 0029 will add point_value_egp (default 0.5 => 100 points = 50 EGP).",
  );

  const overloads = num(
    (
      await one(
        `SELECT count(*) AS n FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'escrow_pay_external'`,
      )
    ).n,
  );
  const hasTextOverload = num(
    (
      await one(
        `SELECT count(*) AS n FROM pg_proc
         WHERE proname = 'escrow_pay_external'
           AND pg_get_function_identity_arguments(oid) like '%text'`,
      )
    ).n,
  );
  console.log(`  ! escrow_pay_external: ${overloads} overload(s), legacy p_method present: ${hasTextOverload === 1}`);
}

/** Conditions 0029 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshot: preflight() below reassigns `before`.
  const pre = before;
  await preflight();

  // 1) point value.
  expect(await columnExists("platform_settings", "point_value_egp"), "platform_settings.point_value_egp exists", "point_value_egp missing");
  const pv = await one("SELECT public.get_point_value_egp() AS v");
  expect(Number(pv.v) > 0, `get_point_value_egp() = ${pv.v}`, "get_point_value_egp() not usable");
  expect(
    await fnPriv("public.get_point_value_egp()", "authenticated"),
    "authenticated may read the point value",
    "get_point_value_egp NOT granted to authenticated",
  );
  expect(
    !(await fnPriv("public.get_point_value_egp()", "anon")),
    "anon may NOT read the point value",
    "get_point_value_egp leaked to anon",
  );

  // 2) top-ups now mint points.
  expect(await columnExists("wallet_topups", "points_granted"), "wallet_topups.points_granted exists", "points_granted missing");
  expect(
    await procHas("admin_review_wallet_topup", "points_granted"),
    "admin_review_wallet_topup records points_granted",
    "admin_review_wallet_topup does not record points_granted",
  );
  expect(
    await procHas("admin_review_wallet_topup", "'deposit'"),
    "admin_review_wallet_topup writes the deposit ledger row",
    "admin_review_wallet_topup writes no ledger row",
  );
  expect(
    await procHas("create_wallet_topup", "point_value_egp"),
    "create_wallet_topup returns the points estimate",
    "create_wallet_topup returns no points estimate",
  );
  expect(
    await procHas("list_my_wallet_topups", "points_granted"),
    "list_my_wallet_topups exposes points",
    "list_my_wallet_topups hides points",
  );
  expect(
    await procHas("admin_list_wallet_topups", "points_granted"),
    "admin_list_wallet_topups exposes points",
    "admin_list_wallet_topups hides points",
  );

  // 3) escrow pays from points, straight to 'held', mints 0028 codes.
  const args = (
    await one(
      `SELECT string_agg(pg_get_function_identity_arguments(oid), '|') AS a
         FROM pg_proc WHERE proname = 'escrow_pay_external'`,
    )
  ).a;
  expect(
    args === "p_request_id uuid, p_amount numeric",
    `escrow_pay_external has exactly the points signature (${args})`,
    `escrow_pay_external signature wrong (${args})`,
  );
  expect(await procHas("escrow_pay_external", "insufficient_points"), "escrow_pay_external guards the balance", "escrow_pay_external lacks insufficient_points");
  expect(await procHas("escrow_pay_external", "booking_handover_codes"), "escrow_pay_external mints handover codes", "escrow_pay_external does not mint codes");
  expect(
    await procHas("escrow_pay_external", "gen_random_bytes"),
    "escrow_pay_external uses CSPRNG for codes",
    "escrow_pay_external lacks CSPRNG",
  );
  expect(
    !(await procHas("escrow_pay_external", "pending_confirmation")),
    "escrow_pay_external no longer mints pending holds",
    "escrow_pay_external still mints pending_confirmation",
  );
  expect(
    !(await procHas("escrow_pay_external", "p_method")),
    "escrow_pay_external dropped p_method",
    "escrow_pay_external still carries p_method",
  );
  expect(
    await fnPriv("public.escrow_pay_external(uuid, numeric)", "authenticated"),
    "authenticated may call escrow_pay_external",
    "escrow_pay_external NOT granted to authenticated",
  );
  expect(
    !(await fnPriv("public.escrow_pay_external(uuid, numeric)", "anon")),
    "anon may NOT call escrow_pay_external",
    "escrow_pay_external leaked to anon",
  );

  const holdConstraint = await one(
    `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
      WHERE conrelid = 'public.escrow_holds'::regclass AND conname = 'escrow_holds_payment_method_check'`,
  );
  expect(
    !!holdConstraint && /points/.test(holdConstraint.d),
    "escrow_holds.payment_method allows 'points'",
    `escrow_holds payment_method check missing/wrong (${holdConstraint?.d ?? "none"})`,
  );

  // 4) release: 0028 gate survived + self-consistent ledger.
  expect(
    await procHas("wallet_escrow_release", "return_code_required"),
    "wallet_escrow_release kept the return-code gate",
    "wallet_escrow_release LOST the return_code_required gate",
  );
  expect(
    await procHas("wallet_escrow_release", "escrow_release_return_code_bypass"),
    "wallet_escrow_release still audits the moderator bypass",
    "wallet_escrow_release lost the bypass audit",
  );
  expect(
    await procHas("wallet_escrow_release", "تحصيل مبلغ الحجز"),
    "wallet_escrow_release writes the gross ledger row",
    "wallet_escrow_release ledger still writes net twice",
  );
  expect(
    await procHas("wallet_escrow_release", "quantity + 1"),
    "wallet_escrow_release still restores quantity",
    "wallet_escrow_release lost the quantity restore",
  );

  // 5) No numeric backfill: identical money figures to the PRE-apply snapshot.
  expect(!!pre, "pre-apply money snapshot captured", "no pre-apply snapshot — cannot prove absence of backfill");
  const after = await moneySnapshot();
  expect(
    !!pre && after.balanceRows === pre.balanceRows && after.balanceTotal === pre.balanceTotal,
    `balances unchanged (${after.balanceRows} rows = ${after.balanceTotal})`,
    `balances CHANGED — pre ${pre?.balanceRows}/${pre?.balanceTotal} vs post ${after.balanceRows}/${after.balanceTotal}`,
  );
  expect(
    !!pre && after.txRows === pre.txRows && after.txTotal === pre.txTotal,
    `ledger unchanged (${after.txRows} rows = ${after.txTotal})`,
    `ledger CHANGED — pre ${pre?.txRows}/${pre?.txTotal} vs post ${after.txRows}/${after.txTotal}`,
  );
  expect(
    !!pre && after.topups === pre.topups && after.topupEgp === pre.topupEgp,
    "top-up history unchanged",
    `top-up history CHANGED — pre ${pre?.topups}/${pre?.topupEgp} vs post ${after.topups}/${after.topupEgp}`,
  );

  // 6) 0028's lockdown survived (0029 must not reopen the codes table).
  const pols = num(
    (
      await one(
        "SELECT count(*) AS n FROM pg_policies WHERE schemaname='public' AND tablename='booking_handover_codes'",
      )
    ).n,
  );
  expect(pols === 0, "booking_handover_codes still has zero policies", `${pols} policies appeared on booking_handover_codes`);

  // 7) Active holds are still coherent (there are 0 today; any pre-existing
  //    pending hold keeps working through the untouched admin_confirm path).
  console.log(`  ! active holds after apply: ${after.activeHolds} (legacy pending ones still confirmable)`);
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0029_points_wallet.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0029 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0029_points_wallet.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0029's end state
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
