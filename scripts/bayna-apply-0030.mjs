// Apply ONLY supabase/migrations/0030_complaints.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0030, so it cannot be used for this batch. This
// script does a read-only pre-flight, applies exactly ONE file (0030), then
// runs a post-flight so the diff is the proof.
//
// Ordering gate: 0029 must be applied first (the shared helper surface
// 0030 builds on — has_min_role/is_user_banned/notify_user — is stable, but
// the wallet migration marks the baseline this batch is verified against).
//
// 0030 is IDEMPOTENT BY DESIGN (create table if not exists / create or
// replace / drop policy if exists / on conflict do nothing) — and it writes
// NO data rows, so a re-run cannot create complaints or notifications.
//
// Usage:
//   node scripts/bayna-apply-0030.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0030.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0030.mjs           # pre -> apply -> post
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
async function tablePriv(table, grantee, priv) {
  try {
    const r = await one("select has_table_privilege($1, $2, $3) as b", [grantee, table, priv]);
    return r.b === true;
  } catch {
    return false; // relation does not exist => no privilege
  }
}

/** The eleven SRS §10.3 complaint types — every one must be in the CHECK. */
const SRS_TYPES = [
  "مشكلة في الحجز",
  "مشكلة في الدفع",
  "عدم تسليم المنتج",
  "اختلاف المنتج عن الوصف",
  "تلف المنتج",
  "تأخير الإرجاع",
  "خلاف حول التأمين",
  "مشكلة في التوصيل",
  "مشكلة في الحساب",
  "الإبلاغ عن إعلان مخالف",
  "الاشتباه في احتيال",
];

/** Data snapshot — proves 0030 writes NO rows (complaints/notifications/audit). */
async function dataSnapshot() {
  const hasComplaints = await tableExists("public", "complaints");
  const c = hasComplaints ? num((await one("select count(*)::int as n from public.complaints")).n) : 0;
  const n = await one("select count(*)::int as n from public.notifications");
  const a = await one("select count(*)::int as n from public.admin_audit_log");
  const r = await one("select count(*)::int as n from public.listing_requests");
  return { complaints: c, notifications: num(n.n), audit: num(a.n), requests: num(r.n) };
}
let before = null;

/**
 * Conditions that must hold BEFORE 0030 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0030's absence). Also prints the blast radius.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gate: 0029 must already be applied ---
  expect(
    await columnExists("platform_settings", "point_value_egp"),
    "0029 applied (platform_settings.point_value_egp exists)",
    "0029 NOT applied yet — apply scripts/bayna-apply-0029.mjs first",
  );

  // --- Helpers 0030 calls against ---
  for (const fn of ["has_min_role", "is_user_banned", "notify_user"]) {
    const n = await procCount(fn);
    expect(n >= 1, `helper ${fn} exists`, `helper ${fn} missing — wrong migration baseline (0013/0022)`);
  }
  expect(
    await tableExists("public", "notifications"),
    "notifications exists (0030 does not recreate it)",
    "notifications missing — apply 0003 first",
  );
  expect(
    await tableExists("public", "admin_audit_log"),
    "admin_audit_log exists (0030 writes decisions there)",
    "admin_audit_log missing — wrong migration baseline",
  );
  expect(
    await tableExists("public", "listing_requests"),
    "listing_requests exists (optional booking linkage)",
    "listing_requests missing",
  );
  expect(
    (await columnExists("listing_requests", "requester_id")) && (await columnExists("listing_requests", "owner_id")),
    "listing_requests has requester_id + owner_id (participant check)",
    "listing_requests participant columns missing",
  );
  if (await tableExists("public", "complaints")) {
    ok("complaints already exists — re-run is idempotent (create or replace)");
  } else {
    console.log("  ! complaints table will be created by 0030 (first run).");
  }

  // --- Blast radius (reported, not gated) ---
  before = await dataSnapshot();
  console.log(
    `  ! data now: ${before.complaints} complaint(s) · ${before.notifications} notification(s) · ` +
      `${before.audit} audit row(s) · ${before.requests} request(s)`,
  );
  console.log("  ! 0030 writes NONE of those — post-flight must see the exact same numbers.");
}

/** Conditions 0030 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshot: preflight() below reassigns `before`.
  const pre = before;
  await preflight();

  // 1) Table exists, locked down, zero rows.
  expect(await tableExists("public", "complaints"), "complaints table exists", "complaints table missing");
  const pols = num(
    (await one("SELECT count(*) AS n FROM pg_policies WHERE schemaname='public' AND tablename='complaints'")).n,
  );
  expect(pols === 0, "complaints has zero RLS policies (RPC-only door)", `${pols} policies appeared on complaints`);
  for (const g of ["anon", "authenticated", "service_role"]) {
    expect(
      !(await tablePriv("public.complaints", g, "select")),
      `${g} has NO direct table privilege on complaints`,
      `${g} can touch complaints directly — revoke missing`,
    );
  }

  // 2) The CHECK constraint carries ALL ELEVEN §10.3 literals.
  const cdef = (
    await one(
      `SELECT string_agg(pg_get_constraintdef(oid), E'\n') AS d FROM pg_constraint
        WHERE conrelid = 'public.complaints'::regclass AND contype = 'c'`,
    )
  )?.d ?? "";
  for (const t of SRS_TYPES) {
    expect(cdef.includes(t), `CHECK allows «${t}»`, `CHECK constraint missing «${t}»`);
  }
  expect(cdef.includes("'open'") && cdef.includes("'in_review'") && cdef.includes("'rejected'"), "status CHECK has open/in_review/resolved/rejected", "status CHECK wrong");
  expect(/CMP-\[0-9A-F\]\{8\}/.test(cdef), "reference CHECK enforces CMP-XXXXXXXX", "reference CHECK missing");
  expect(
    /char_length\(details\).*10/.test(cdef) && cdef.includes("5000"),
    "details bounded 10..5000",
    `details length bound missing (${cdef.match(/char_length\([^)]*\)[^,)]*/)?.[0] ?? "?"})`,
  );

  // 3) The five RPCs: exist, authenticated-only, right gates inside.
  const rpcs = [
    "public.open_complaint(text, text, uuid, uuid)",
    "public.add_complaint_attachment(uuid, text)",
    "public.list_my_complaints()",
    "public.admin_list_complaints(text)",
    "public.update_complaint_status(uuid, text, text)",
  ];
  for (const sig of rpcs) {
    const name = sig.slice(sig.lastIndexOf(".") + 1).split("(")[0];
    expect(await fnPriv(sig, "authenticated"), `${name} granted to authenticated`, `${name} NOT granted to authenticated (${sig})`);
    expect(!(await fnPriv(sig, "anon")), `${name} denied to anon`, `${name} leaked to anon`);
    expect((await procCount(name)) >= 1, `${name} exists`, `${name} missing`);
  }
  expect(await procHas("open_complaint", "complaint_type_invalid"), "open_complaint validates the §10.3 type", "open_complaint lacks complaint_type_invalid");
  expect(await procHas("open_complaint", "complaint_details_required"), "open_complaint requires details", "open_complaint lacks complaint_details_required");
  expect(await procHas("open_complaint", "open_complaint_limit"), "open_complaint enforces the flood limit", "open_complaint lacks open_complaint_limit");
  expect(await procHas("open_complaint", "not a participant"), "open_complaint validates booking linkage", "open_complaint lacks the participant check");
  expect(await procHas("open_complaint", "CMP-"), "open_complaint mints the CMP- reference", "open_complaint mints no reference");
  expect(await procHas("add_complaint_attachment", "not the reporter"), "attachment: reporter only", "attachment lacks not the reporter");
  expect(await procHas("add_complaint_attachment", "too many photos"), "attachment: max 6 enforced", "attachment lacks too many photos");
  expect(await procHas("list_my_complaints", "reporter_id = v_uid"), "list_my_complaints scoped to the reporter", "list_my_complaints not scoped");
  expect(await procHas("admin_list_complaints", "has_min_role"), "admin_list_complaints requires moderator+", "admin_list_complaints lacks has_min_role");
  expect(await procHas("admin_list_complaints", "permission denied"), "admin_list_complaints raises instead of empty", "admin_list_complaints silent on wrong role");
  expect(await procHas("update_complaint_status", "resolution_required"), "closing requires a written reason", "update_complaint_status lacks resolution_required");
  expect(await procHas("update_complaint_status", "invalid_status_transition"), "transition table enforced", "lacks invalid_status_transition");
  expect(await procHas("update_complaint_status", "notify_user"), "status change notifies the reporter", "no notify_user call");
  expect(await procHas("update_complaint_status", "admin_audit_log"), "status change writes the audit log", "no admin_audit_log entry");

  // 4) Private attachments bucket with exactly insert+select policies.
  const b = await one("SELECT public, count(*) OVER () AS n FROM storage.buckets WHERE id = 'complaint-attachments'");
  expect(!!b, "bucket complaint-attachments exists", "bucket complaint-attachments missing");
  expect(b?.public === false, "bucket is PRIVATE (signed URLs only)", "bucket is public");
  const bpols = num(
    (
      await one(
        "SELECT count(*) AS n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname like 'complaint_attachments%'",
      )
    ).n,
  );
  expect(bpols === 2, "exactly 2 storage policies (insert + select)", `${bpols} storage policies on complaint-attachments`);

  // 4b) The storage policies must route ownership through the DEFINER helper
  //     (a direct complaints select inside a policy = permission denied).
  expect((await procCount("is_complaint_reporter")) === 1, "is_complaint_reporter exists", "is_complaint_reporter missing");
  expect(
    await fnPriv("public.is_complaint_reporter(text)", "authenticated"),
    "is_complaint_reporter granted to authenticated",
    "is_complaint_reporter NOT granted to authenticated — uploads will 503",
  );
  expect(
    !(await fnPriv("public.is_complaint_reporter(text)", "anon")),
    "is_complaint_reporter denied to anon",
    "is_complaint_reporter leaked to anon",
  );
  const definer = await one(
    "SELECT prosecdef AS d FROM pg_proc WHERE proname = 'is_complaint_reporter'",
  );
  expect(definer?.d === true, "is_complaint_reporter is SECURITY DEFINER", "is_complaint_reporter is NOT security definer");
  const polQual = (
    await one(
      `SELECT string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ') AS q
         FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
          AND policyname like 'complaint_attachments%'`,
    )
  )?.q ?? "";
  expect(
    polQual.includes("is_complaint_reporter") && !polQual.includes("public.complaints"),
    "storage policies use the helper (no direct complaints select)",
    `storage policies wrong: ${polQual.slice(0, 200)}`,
  );

  // 5) No data rows created by the apply itself.
  expect(!!pre, "pre-apply data snapshot captured", "no pre-apply snapshot");
  const after = await dataSnapshot();
  expect(
    !!pre && after.complaints === pre.complaints,
    `complaints rows unchanged (${after.complaints})`,
    `complaints CHANGED — pre ${pre?.complaints} vs post ${after.complaints}`,
  );
  expect(
    !!pre && after.notifications === pre.notifications,
    `notifications unchanged (${after.notifications})`,
    `notifications CHANGED — pre ${pre?.notifications} vs post ${after.notifications}`,
  );
  expect(
    !!pre && after.audit === pre.audit,
    `audit log unchanged (${after.audit})`,
    `audit log CHANGED — pre ${pre?.audit} vs post ${after.audit}`,
  );
  expect(
    !!pre && after.requests === pre.requests,
    `listing_requests unchanged (${after.requests})`,
    `listing_requests CHANGED — pre ${pre?.requests} vs post ${after.requests}`,
  );
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0030_complaints.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0030 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0030_complaints.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0030's end state
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
