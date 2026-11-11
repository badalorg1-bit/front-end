// Apply ONLY supabase/migrations/0034_permissions.sql.
//
// Why this exists: scripts/bayna-apply-migrations.mjs replays 0001-0023 and
// knows nothing about 0024-0034, so it cannot be used for this batch. This
// script does a read-only pre-flight (capturing the pre-apply prosrc of the
// seven re-declared functions), applies exactly ONE file (0034), then runs a
// post-flight so the diff is the proof.
//
// Ordering gate: 0030 (admin_list_complaints) and 0033
// (admin_create_delivery_order) must be applied first.
//
// 0034 is IDEMPOTENT BY DESIGN (drop/add constraint if exists / create table
// if not exists / drop policy if exists / seeds on conflict do nothing /
// create or replace) — and it writes ONLY the 49 role_permissions seed rows,
// so a re-run changes no business data.
//
// The prosrc proof: the five VERBATIM re-declarations (admin_list_complaints,
// update_complaint_status, admin_set_listing_status, consume_listing_quota,
// on_wallet_topup_inserted) must equal the pre-apply body with EXACTLY the
// documented gate/owner substitution applied — line endings normalized
// (\r\n -> \n; 0030 is LF, 0003/0017/0019/0020 are CRLF, 0034 is LF).
// admin_set_user_role and protect_profile_privileges are intentionally
// restructured, so they get marker checks instead.
//
// Usage:
//   node scripts/bayna-apply-0034.mjs --check   # pre-flight only, no writes
//   node scripts/bayna-apply-0034.mjs --verify  # pre + post-flight, no writes
//   node scripts/bayna-apply-0034.mjs           # pre -> apply -> post
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

const norm = (s) => s.replace(/\r\n/g, "\n");

/** prosrc of every function 0034 re-declares, line endings normalized. */
const PROSRC_NAMES = [
  "admin_list_complaints",
  "update_complaint_status",
  "admin_set_listing_status",
  "consume_listing_quota",
  "on_wallet_topup_inserted",
  "admin_set_user_role",
  "protect_profile_privileges",
];
async function captureProsrc() {
  const out = {};
  for (const n of PROSRC_NAMES) {
    const rows = (await client.query("SELECT prosrc FROM pg_proc WHERE proname = $1", [n])).rows;
    out[n] = rows.map((r) => norm(r.prosrc));
  }
  return out;
}

// The five VERBATIM re-declarations: pre-body + EXACT substitution = post-body.
const VERBATIM = {
  admin_list_complaints: [["public.has_min_role('moderator')", "public.has_permission('complaints.view')"]],
  update_complaint_status: [["public.has_min_role('moderator')", "public.has_permission('complaints.manage')"]],
  admin_set_listing_status: [["has_min_role('moderator')", "public.has_permission('listings.review')"]],
  consume_listing_quota: [["('admin','super_admin')", "('admin','super_admin','owner')"]],
  on_wallet_topup_inserted: [["('admin', 'super_admin')", "('admin', 'super_admin', 'owner')"]],
};

// Marker checks for the two intentionally restructured functions.
const MARKERS = {
  admin_set_user_role: [
    "'merchant'", // 8-role whitelist
    "'support'",
    "'operations'",
    "'owner'",
    "actor_rank < 3", // entry rank (admin+)
    "actor_rank >= 4", // owner bootstrap requires super_admin+
    "actor_rank < 4", // super_admin grant requires super_admin+
  ],
  protect_profile_privileges: [
    "payment_qr_path", // 0019 QR rule kept
    "لا يمكنك منح صلاحية أعلى من صلاحيتك", // loud self-escalation
    "لا يمكن تخفيض صلاحية آخر مسؤول نظام", // last super_admin
    "لا يمكن تخفيض صلاحية آخر مالك", // last owner (0034)
    "new.role := old.role", // silent revert path
  ],
};

// The 49 seed rows — every one must exist after apply (re-run safe).
const SEEDS = [
  ["support", "requests.view"], ["support", "complaints.view"], ["support", "complaints.manage"],
  ["operations", "reports.view"], ["operations", "listings.review"], ["operations", "requests.view"],
  ["moderator", "reports.view"], ["moderator", "listings.review"], ["moderator", "requests.view"],
  ["moderator", "complaints.view"], ["moderator", "complaints.manage"], ["moderator", "disputes.manage"],
  ["moderator", "delivery.manage"], ["moderator", "notifications.broadcast"],
  ["admin", "reports.view"], ["admin", "listings.review"], ["admin", "requests.view"],
  ["admin", "complaints.view"], ["admin", "complaints.manage"], ["admin", "disputes.manage"],
  ["admin", "delivery.manage"], ["admin", "notifications.broadcast"], ["admin", "users.manage"],
  ["admin", "settings.manage"], ["admin", "audit.view"],
  ["super_admin", "reports.view"], ["super_admin", "listings.review"], ["super_admin", "requests.view"],
  ["super_admin", "complaints.view"], ["super_admin", "complaints.manage"], ["super_admin", "disputes.manage"],
  ["super_admin", "delivery.manage"], ["super_admin", "notifications.broadcast"], ["super_admin", "users.manage"],
  ["super_admin", "settings.manage"], ["super_admin", "audit.view"], ["super_admin", "permissions.manage"],
  ["owner", "reports.view"], ["owner", "listings.review"], ["owner", "requests.view"],
  ["owner", "complaints.view"], ["owner", "complaints.manage"], ["owner", "disputes.manage"],
  ["owner", "delivery.manage"], ["owner", "notifications.broadcast"], ["owner", "users.manage"],
  ["owner", "settings.manage"], ["owner", "audit.view"], ["owner", "permissions.manage"],
];

const RANKS = { user: 0, merchant: 0, support: 1, operations: 1, moderator: 2, admin: 3, super_admin: 4, owner: 5 };
const EIGHT_ROLES = Object.keys(RANKS);

/**
 * Data snapshot — proves 0034 writes ONLY the 49 seeds (profiles, listings,
 * requests, notifications, audit and every role distribution stay put).
 */
async function dataSnapshot() {
  const p = await one("select count(*)::int as n from public.profiles");
  const roles = await one(
    "select coalesce(jsonb_object_agg(role, c), '{}'::jsonb) as d from (select role, count(*)::int as c from public.profiles group by role) t",
  );
  const l = await one("select count(*)::int as n from public.listings");
  const r = await one("select count(*)::int as n from public.listing_requests");
  const n = await one("select count(*)::int as n from public.notifications");
  const g = await one("select count(*)::int as n from public.admin_audit_log");
  return {
    profiles: num(p.n),
    roles: roles.d ?? {},
    listings: num(l.n),
    requests: num(r.n),
    notifications: num(n.n),
    audit: num(g.n),
  };
}

let before = null;
let preProsrc = null;

/**
 * Conditions that must hold BEFORE 0034 runs — and remain true after it
 * (post-flight re-runs this whole function, so nothing here may depend on
 * 0034's absence). Also prints the blast radius. The pre-apply prosrc is
 * captured exactly once (guarded), so postflight's re-run keeps it.
 */
async function preflight() {
  console.log("\n== PRE-FLIGHT (read-only) ==");

  // --- Ordering gates: 0030 + 0033 must already be applied ---
  expect(
    (await procCount("admin_list_complaints")) >= 1,
    "0030 applied (admin_list_complaints exists)",
    "0030 NOT applied yet — apply scripts/bayna-apply-0030.mjs first",
  );
  expect(
    (await procCount("admin_create_delivery_order")) >= 1,
    "0033 applied (admin_create_delivery_order exists)",
    "0033 NOT applied yet — apply scripts/bayna-apply-0033.mjs first",
  );

  // --- Tables the migration touches ---
  const tables = [
    "profiles", "listings", "listing_images", "listing_requests", "ai_warnings",
    "admin_audit_log", "pricing_plans", "subscriptions", "subscription_orders",
    "promo_services", "listing_promos", "promo_credits_ledger", "banner_campaigns",
    "listing_quota_log", "complaints", "notifications",
  ];
  for (const t of tables) {
    expect(await tableExists("public", t), `table ${t} exists`, `table ${t} missing`);
  }

  // --- role_permissions: first run vs re-run ---
  if (!(await tableExists("public", "role_permissions"))) {
    console.log("  ! role_permissions will be created by 0034 (first run).");
  } else {
    const n = num((await one("select count(*)::int as n from public.role_permissions")).n);
    console.log(`  ! role_permissions already exists with ${n} row(s) (0034 applied) — re-run safe (seeds: on conflict do nothing).`);
  }

  // --- has_permission: first run vs re-run ---
  if ((await procCount("has_permission")) === 0) {
    console.log("  ! has_permission will be created by 0034 (first run).");
  } else {
    console.log("  ! has_permission already exists (0034 applied) — re-run safe.");
  }

  // --- Capture the pre-apply prosrc exactly once ---
  if (preProsrc === null) {
    preProsrc = await captureProsrc();
    for (const n of PROSRC_NAMES) {
      if (preProsrc[n].length === 0) fail(`pre-apply prosrc missing for ${n}`);
    }
  }

  // --- Blast radius (reported, not gated) ---
  before = await dataSnapshot();
  console.log(
    `  ! data now: ${before.profiles} profile(s) · ${before.listings} listing(s) · ` +
      `${before.requests} request(s) · ${before.notifications} notification(s) · ${before.audit} audit row(s)`,
  );
  console.log(`  ! role distribution: ${JSON.stringify(before.roles)}`);
  console.log("  ! 0034 writes NONE of those (only the 49 role_permissions seeds) — post-flight must see the exact same numbers.");
}

/** Conditions 0034 must create — checked only AFTER it runs. */
async function postflight() {
  console.log("\n== POST-FLIGHT (read-only) ==");
  // Keep the PRE-apply snapshots: preflight() below reassigns `before`.
  const pre = before;
  const preP = preProsrc;
  // true only in apply mode: that is the only mode where `preP` is a genuine
  // pre-apply snapshot (in --verify the "pre" capture is the current state).
  const appliedInProcess = !checkOnly && !verifyOnly;
  await preflight();

  // 1) profiles_role_check carries all eight §5.2 roles.
  const c = await one(
    "select pg_get_constraintdef(oid) as d from pg_constraint where conname='profiles_role_check' and conrelid='public.profiles'::regclass",
  );
  expect(!!c, "profiles_role_check exists", "profiles_role_check missing");
  for (const role of EIGHT_ROLES) {
    expect(!!c && c.d.includes(`'${role}'`), `role check allows '${role}'`, `role check MISSING '${role}'`);
  }

  // 2) app_role_rank maps the eight roles to 0,0,1,1,2,3,4,5 (old four keep
  //    their relative order, so every has_min_role gate keeps its meaning).
  for (const [role, want] of Object.entries(RANKS)) {
    const r = await one("select public.app_role_rank($1) as v", [role]);
    expect(num(r?.v) === want, `app_role_rank('${role}') = ${want}`, `app_role_rank('${role}') = ${r?.v}, want ${want}`);
  }
  const unk = await one("select public.app_role_rank('no_such_role') as v");
  expect(num(unk?.v) === -1, "unknown role rank = -1", `unknown role rank = ${unk?.v}`);

  // 3) role_permissions: RLS on, ZERO policies, no client-role grants,
  //    all 49 seed rows present.
  expect(await tableExists("public", "role_permissions"), "role_permissions exists", "role_permissions missing");
  const rls = await one(
    "SELECT c.relrowsecurity AS b FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='role_permissions'",
  );
  expect(rls?.b === true, "RLS enabled on role_permissions", "RLS NOT enabled on role_permissions");
  const rpPolicies = await one("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions'");
  expect(num(rpPolicies.n) === 0, "zero policies on role_permissions (RPC-only)", `${rpPolicies.n} policy(ies) on role_permissions`);
  expect(
    await tableGrantsRevoked("role_permissions"),
    "no client-role grants on role_permissions (only the owner postgres)",
    "role_permissions still grants a client role",
  );
  const placeholders = SEEDS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
  const seedRows = await one(
    `SELECT count(*)::int AS n FROM public.role_permissions rp WHERE (rp.role, rp.permission) IN (VALUES ${placeholders})`,
    SEEDS.flat(),
  );
  expect(num(seedRows.n) === 49, "all 49 seed rows present", `only ${seedRows.n}/49 seed rows present`);
  const dist = (await client.query(
    "SELECT role, count(*)::int AS c FROM public.role_permissions GROUP BY role ORDER BY public.app_role_rank(role)",
  )).rows;
  console.log(`  ! permission distribution: ${dist.map((d) => `${d.role}=${d.c}`).join(" · ") || "(empty)"}`);

  // 4) has_permission: granted to authenticated AND anon, denied to public;
  //    prosrc joins role_permissions and refuses is_banned.
  expect((await procCount("has_permission")) >= 1, "has_permission exists", "has_permission missing");
  expect(await fnPriv("public.has_permission(text)", "authenticated"), "has_permission granted to authenticated", "has_permission NOT granted to authenticated");
  expect(await fnPriv("public.has_permission(text)", "anon"), "has_permission granted to anon (policy evaluation)", "has_permission NOT granted to anon");
  expect(!(await fnPriv("public.has_permission(text)", "public")), "has_permission denied to public pseudo-role", "has_permission leaked to public");
  expect(await procHas("has_permission", "role_permissions"), "has_permission reads the matrix", "has_permission does not read role_permissions");
  expect(await procHas("has_permission", "is_banned"), "has_permission refuses banned accounts", "has_permission missing is_banned guard");

  // 5) The two new RPCs: exist, right grants, right gates.
  const rpcs = [
    ["admin_list_role_permissions", "public.admin_list_role_permissions()"],
    ["admin_set_role_permission", "public.admin_set_role_permission(text, text, boolean)"],
  ];
  for (const [name, sig] of rpcs) {
    expect((await procCount(name)) >= 1, `${name} exists`, `${name} missing`);
    expect(await fnPriv(sig, "authenticated"), `${name} granted to authenticated`, `${name} NOT granted to authenticated`);
    expect(!(await fnPriv(sig, "anon")), `${name} denied to anon`, `${name} leaked to anon`);
    expect(!(await fnPriv(sig, "public")), `${name} denied to public pseudo-role`, `${name} leaked to public`);
  }
  expect(await procHas("admin_list_role_permissions", "has_min_role('admin')"), "list gate = has_min_role('admin')", "list gate missing");
  expect(await procHas("admin_list_role_permissions", "role_rank"), "matrix carries role_rank", "role_rank column missing");
  expect(await procHas("admin_set_role_permission", "permissions.manage"), "set gate = permissions.manage", "set gate missing");
  for (const code of [
    "role_invalid", "permission_unknown", "permission_grant_invalid",
    "permission_self_edit", "permission_rank", "permission_grant_exceeds",
  ]) {
    expect(await procHas("admin_set_role_permission", code), `refusal code ${code}`, `refusal code ${code} missing`);
  }
  expect(await procHas("admin_set_role_permission", "set_role_permission"), "audit action set_role_permission", "audit row missing");
  expect(await procHas("admin_set_role_permission", "'role_permission'"), "audit target_type role_permission", "audit target_type missing");

  // 6) Re-declared functions: preserved grants (CREATE OR REPLACE keeps ACL).
  const preserved = [
    ["admin_set_user_role(uuid, text)", "authenticated"],
    ["admin_set_listing_status(uuid, text)", "authenticated"],
    ["admin_list_complaints(text)", "authenticated"],
    ["update_complaint_status(uuid, text, text)", "authenticated"],
    ["consume_listing_quota(uuid)", "authenticated"],
  ];
  for (const [sig, grantee] of preserved) {
    expect(await fnPriv(sig, grantee), `${sig} still granted to ${grantee}`, `${sig} LOST its grant to ${grantee}`);
  }

  // 7) prosrc proof.
  //    7a. VERBATIM: post === pre + documented substitution (apply mode),
  //        and in every mode post carries the NEW gate and not the old one.
  const postP = await captureProsrc();
  for (const [name, transforms] of Object.entries(VERBATIM)) {
    const post = postP[name];
    if (!post || post.length === 0) {
      fail(`${name} prosrc missing after apply`);
      continue;
    }
    const body = post[0];
    for (const [from, to] of transforms) {
      expect(body.includes(to), `${name} carries new gate ${to}`, `${name} missing new gate ${to}`);
      expect(!body.includes(from), `${name} old gate gone (${from})`, `${name} still contains old gate ${from}`);
      if (appliedInProcess && preP && preP[name]?.length === 1) {
        const preBody = preP[name][0];
        const occurrences = preBody.split(from).length - 1;
        expect(occurrences >= 1, `${name} pre-body contained the old gate (${occurrences}x)`, `${name} pre-body never contained ${from} — transform would be a no-op`);
        const expected = preBody.split(from).join(to);
        expect(
          body === expected,
          `${name} = pre-body + substitution only (${expected.length} bytes)`,
          `${name} DIFFERS from pre-body+substitution — unexpected edit in the re-declaration`,
        );
      }
    }
  }
  //    7b. MARKERS for the two restructured functions (both modes).
  for (const [name, markers] of Object.entries(MARKERS)) {
    const body = postP[name]?.[0];
    if (!body) {
      fail(`${name} prosrc missing after apply`);
      continue;
    }
    for (const m of markers) {
      expect(body.includes(m), `${name} marker: ${m}`, `${name} MISSING marker: ${m}`);
    }
  }

  // 8) pg_policies: replaced + added + owner-gap policies.
  async function policyQual(policyName, tableName, schema = "public") {
    return one(
      "select qual, with_check as wc from pg_policies where schemaname=$1 and tablename=$2 and policyname=$3",
      [schema, tableName, policyName],
    );
  }
  const permPolicies = [
    ["listings_select_admin", "listings", "listings.review"],
    ["listing_images_select_admin", "listing_images", "listings.review"],
    ["listing_requests_select_admin", "listing_requests", "requests.view"],
    ["ai_warnings_select_admin", "ai_warnings", "listings.review"],
    ["admin_audit_select", "admin_audit_log", "audit.view"],
  ];
  for (const [pname, tname, perm] of permPolicies) {
    const q = await policyQual(pname, tname);
    expect(!!q, `${pname} exists`, `${pname} missing`);
    expect(!!q && q.qual.includes("has_permission") && q.qual.includes(perm), `${pname} gates on ${perm}`, `${pname} does not gate on ${perm}: ${q?.qual ?? "n/a"}`);
  }
  const upd = await policyQual("ai_warnings_update_admin", "ai_warnings");
  expect(!!upd && upd.qual.includes("has_permission") && upd.qual.includes("listings.review"), "ai_warnings_update_admin USING gates on listings.review", "ai_warnings_update_admin USING wrong");
  expect(!!upd && upd.wc.includes("has_permission") && upd.wc.includes("listings.review"), "ai_warnings_update_admin WITH CHECK gates on listings.review", "ai_warnings_update_admin WITH CHECK wrong");
  const attach = await policyQual("complaint_attachments_select", "objects", "storage");
  expect(!!attach, "complaint_attachments_select exists", "complaint_attachments_select missing");
  expect(
    !!attach && attach.qual.includes("has_permission") && attach.qual.includes("complaints.view"),
    "complaint_attachments_select gained has_permission('complaints.view')",
    `complaint_attachments_select missing the added gate: ${attach?.qual ?? "n/a"}`,
  );
  expect(
    !!attach && attach.qual.includes("has_min_role"),
    "complaint_attachments_select kept the moderator path",
    "complaint_attachments_select lost has_min_role",
  );
  const ownerGap = [
    ["pricing_plans_select_active", "pricing_plans"],
    ["subscriptions_select_own", "subscriptions"],
    ["subscription_orders_select_own", "subscription_orders"],
    ["promo_services_select_active", "promo_services"],
    ["listing_promos_select_own", "listing_promos"],
    ["promo_credits_ledger_select_own", "promo_credits_ledger"],
    ["banner_campaigns_select_own", "banner_campaigns"],
    ["listing_quota_log_select_own", "listing_quota_log"],
  ];
  for (const [pname, tname] of ownerGap) {
    const q = await policyQual(pname, tname);
    expect(!!q, `${pname} exists`, `${pname} missing`);
    expect(!!q && q.qual.includes("'owner'"), `${pname} includes 'owner'`, `${pname} does NOT include 'owner': ${q?.qual ?? "n/a"}`);
  }

  // 9) Triggers still attached (CREATE OR REPLACE keeps them).
  expect(await triggerExists("protect_profile_privileges"), "profiles guard trigger attached", "protect_profile_privileges trigger missing");
  expect(await triggerExists("wallet_topups_notify_inserted"), "topup notify trigger attached", "wallet_topups_notify_inserted trigger missing");

  // 10) Data snapshot: 0034 writes ONLY the 49 seeds.
  expect(!!pre, "pre-apply data snapshot captured", "no pre-apply snapshot");
  const after = await dataSnapshot();
  for (const k of ["profiles", "listings", "requests", "notifications", "audit"]) {
    expect(
      !!pre && after[k] === pre[k],
      `${k} unchanged (${after[k]})`,
      `${k} CHANGED — pre ${pre?.[k]} vs post ${after[k]}`,
    );
  }
  expect(
    !!pre && JSON.stringify(after.roles) === JSON.stringify(pre.roles),
    "profile role distribution unchanged",
    `role distribution CHANGED — pre ${JSON.stringify(pre?.roles)} vs post ${JSON.stringify(after.roles)}`,
  );
}

async function applyMigration() {
  const file = join(root, "supabase", "migrations", "0034_permissions.sql");
  const sql = readFileSync(file, "utf8");
  if (!sql.trim()) {
    fail("0034 is empty — refusing to apply");
    return;
  }
  console.log(`\n== APPLY supabase/migrations/0034_permissions.sql (${sql.length} bytes) ==`);
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
// --verify  : pre-flight + post-flight (read-only; proves 0034's end state
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
