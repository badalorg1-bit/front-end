// Apply ONLY supabase/migrations/0031_dispute_resolution.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0031, so it cannot be used for this batch. This
// script does a read-only pre-flight, applies exactly ONE file (0031), then
// runs a post-flight so the diff is the proof.
//
// Ordering gate: 0030 must be applied first (admin_list_disputes reads the
// complaints table that 0030 creates).
//
// 0031 is IDEMPOTENT BY DESIGN (create or replace / drop policy if exists)
// — and it writes NO data rows, so a re-run cannot resolve a dispute or
// create a notification.
//
// Usage:
//   node scripts/bayna-apply-0031.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0031.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0031.mjs           # pre -> apply -> post
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
async function procOccurrences(name, fragment) {
  const r = await one(
    "SELECT coalesce(length(prosrc) - length(replace(prosrc, $2, '')), 0) / nullif(length($2), 0) AS n FROM pg_proc WHERE proname = $1",
    [name, fragment],
  );
  return num(r?.n);
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
async function policyQual(policyName) {
  const r = await one(
    "SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS q FROM pg_policies WHERE schemaname='public' AND tablename='listing_requests' AND policyname = $1",
    [policyName],
  );
  return r?.q ?? "";
}

/**
 * Data snapshot — proves 0031 writes NO rows (requests/notifications/audit).
 * A dispute resolution in the apply itself would change all three.
 */
async function dataSnapshot() {
  const r = await one("select count(*)::int as n from public.listing_requests");
  const d = await one("select count(*)::int as n from public.listing_requests where status = 'disputed'");
  const n = await one("select count(*)::int as n from public.notifications");
  const a = await one("select count(*)::int as n from public.admin_audit_log");
  return { requests: num(r.n), disputed: num(d.n), notifications: num(n.n), audit: num(a.n) };
}
let before = null;

/**
 * Conditions that must hold BEFORE 0031 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0031's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gate: 0030 must already be applied ---
  expect(
    await tableExists("public", "complaints"),
    "0030 applied (complaints exists — admin_list_disputes reads it)",
    "0030 NOT applied yet — apply scripts/bayna-apply-0030.mjs first",
  );

  // --- Helpers 0031 calls against ---
  for (const fn of ["has_min_role", "notify_user"]) {
    const n = await procCount(fn);
    expect(n >= 1, `helper ${fn} exists`, `helper ${fn} missing — wrong migration baseline`);
  }
  expect(
    await procCount("enforce_request_transition") >= 1,
    "enforce_request_transition exists (0031 replaces its body)",
    "enforce_request_transition missing — wrong baseline (0001)",
  );
  expect(
    (await procHas("enforce_request_transition", "disputed")) === true,
    "current trigger already handles disputed transitions (0027 copy)",
    "trigger has no disputed branch — wrong baseline",
  );
  expect(
    await tableExists("public", "booking_handover_codes"),
    "booking_handover_codes exists (delivery/return log)",
    "booking_handover_codes missing — apply 0028 first",
  );
  for (const t of ["listing_requests", "listings", "profiles", "escrow_holds", "conversations", "messages", "admin_audit_log", "notifications"]) {
    expect(await tableExists("public", t), `table ${t} exists`, `table ${t} missing`);
  }
  expect(
    (await columnExists("listing_requests", "requester_id")) && (await columnExists("listing_requests", "owner_id")),
    "listing_requests has requester_id + owner_id",
    "listing_requests participant columns missing",
  );
  const qual = await policyQual("listing_requests_update_moderator");
  if (!qual) {
    console.log("  ! listing_requests_update_moderator will be created by 0031 (first run).");
  } else if (qual.includes("disputed")) {
    // Re-run after 0031: the new policy is already in place — idempotent.
    console.log("  ! moderator UPDATE policy already excludes disputed rows (0031 applied) — re-run safe.");
  } else {
    ok("moderator UPDATE policy is still the blanket 0022 one (first run)");
  }

  // --- Blast radius (reported, not gated) ---
  before = await dataSnapshot();
  console.log(
    `  ! data now: ${before.requests} request(s) · ${before.disputed} disputed · ` +
      `${before.notifications} notification(s) · ${before.audit} audit row(s)`,
  );
  console.log("  ! 0031 writes NONE of those — post-flight must see the exact same numbers.");
}

/** Conditions 0031 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshot: preflight() below reassigns `before`.
  const pre = before;
  await preflight();

  // 1) The extended trigger: moderator branch on disputed->completed + the
  //    NEW disputed->cancelled branch, participant path untouched.
  expect(
    await procHas("enforce_request_transition", "not public.has_min_role('moderator')"),
    "disputed->completed now also accepts moderator+",
    "trigger lacks the moderator branch on disputed->completed",
  );
  expect(
    await procHas("enforce_request_transition", "only moderators can cancel a disputed booking"),
    "NEW disputed->cancelled branch exists (moderator only)",
    "disputed->cancelled branch missing",
  );
  expect(
    await procHas("enforce_request_transition", "only participants can open a dispute"),
    "participant path untouched (still opens disputes)",
    "participant dispute-open branch changed — unexpected",
  );
  expect(
    num(
      (
        await one(
          `SELECT count(*) AS n FROM pg_trigger
            WHERE tgrelid = 'public.listing_requests'::regclass
              AND tgname = 'listing_requests_transition'
              AND NOT tgisinternal`,
        )
      ).n,
    ) === 1,
    "listing_requests_transition trigger still attached",
    "transition trigger detached",
  );

  // 2) The reason-bypass is closed: moderator UPDATE excludes disputed rows.
  const newQual = await policyQual("listing_requests_update_moderator");
  expect(
    newQual.includes("disputed"),
    "moderator UPDATE policy now excludes status = 'disputed'",
    `policy qual wrong: ${newQual.slice(0, 160)}`,
  );
  expect(
    newQual.includes("has_min_role"),
    "policy still requires moderator role",
    "policy lost its role gate",
  );

  // 3) The two RPCs: exist, authenticated-only, right gates inside.
  const rpcs = ["public.admin_list_disputes()", "public.admin_resolve_dispute(uuid, text, text)"];
  for (const sig of rpcs) {
    const name = sig.slice(sig.lastIndexOf(".") + 1).split("(")[0];
    expect(await fnPriv(sig, "authenticated"), `${name} granted to authenticated`, `${name} NOT granted to authenticated (${sig})`);
    expect(!(await fnPriv(sig, "anon")), `${name} denied to anon`, `${name} leaked to anon`);
    expect((await procCount(name)) >= 1, `${name} exists`, `${name} missing`);
  }

  // admin_list_disputes: §10.4 payload — booking, handover log, messages,
  // linked complaints, recorded history.
  expect(await procHas("admin_list_disputes", "permission denied"), "lister requires moderator+", "lister lacks role gate");
  expect(await procHas("admin_list_disputes", "not authenticated"), "lister rejects anonymous", "lister lacks auth gate");
  expect(await procHas("admin_list_disputes", "q.status = 'disputed'"), "lister queries disputed requests", "lister not scoped to disputed");
  expect(await procHas("admin_list_disputes", "booking_handover_codes"), "lister returns the delivery/return log", "handover log missing");
  expect(await procHas("admin_list_disputes", "public.messages"), "lister returns the parties' messages", "messages missing");
  expect(await procHas("admin_list_disputes", "public.complaints"), "lister returns linked complaints (0030)", "complaints missing");
  expect(await procHas("admin_list_disputes", "escrow_holds"), "lister returns escrow state", "escrow missing");
  expect(await procHas("admin_list_disputes", "resolve_dispute"), "lister returns the resolution history", "history missing");
  expect(
    (await procOccurrences("admin_list_disputes", "perform public.notify_user")) === 0,
    "lister is read-only (zero notify calls)",
    "lister writes notifications — it must only read",
  );

  // admin_resolve_dispute: moderator+, outcome+reason validation, lock,
  // audit row, BOTH parties notified, NO money movement.
  expect(await procHas("admin_resolve_dispute", "permission denied"), "resolver requires moderator+", "resolver lacks role gate");
  expect(await procHas("admin_resolve_dispute", "not authenticated"), "resolver rejects anonymous", "resolver lacks auth gate");
  expect(await procHas("admin_resolve_dispute", "invalid_dispute_outcome"), "resolver validates the outcome", "outcome validation missing");
  expect(await procHas("admin_resolve_dispute", "reason_required"), "resolver requires a written reason", "reason gate missing");
  expect(await procHas("admin_resolve_dispute", "reason_too_long"), "resolver bounds the reason (2000)", "reason ceiling missing");
  expect(await procHas("admin_resolve_dispute", "request is not disputed"), "resolver refuses non-disputed requests", "status gate missing");
  expect(await procHas("admin_resolve_dispute", "for update"), "resolver locks the row (FOR UPDATE)", "row lock missing");
  expect(await procHas("admin_resolve_dispute", "admin_audit_log"), "resolver records the decision + reason", "audit insert missing");
  expect(
    (await procOccurrences("admin_resolve_dispute", "perform public.notify_user")) === 2,
    "resolver notifies BOTH parties (exactly 2 notify calls)",
    `notify calls = ${await procOccurrences("admin_resolve_dispute", "perform public.notify_user")} (want 2)`,
  );
  expect(
    (await procOccurrences("admin_resolve_dispute", "wallet_escrow")) === 0 &&
      (await procOccurrences("admin_resolve_dispute", "escrow_holds")) === 0,
    "resolver moves NO money (no escrow calls)",
    "resolver touches escrow — violates §10.4 one-sided-claim rule",
  );

  // 4) No data rows created by the apply itself.
  expect(!!pre, "pre-apply data snapshot captured", "no pre-apply snapshot");
  const after = await dataSnapshot();
  for (const k of ["requests", "disputed", "notifications", "audit"]) {
    expect(
      !!pre && after[k] === pre[k],
      `${k} unchanged (${after[k]})`,
      `${k} CHANGED — pre ${pre?.[k]} vs post ${after[k]}`,
    );
  }
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0031_dispute_resolution.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0031 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0031_dispute_resolution.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0031's end state
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
