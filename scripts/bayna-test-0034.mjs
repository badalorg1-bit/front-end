// Behavioral permission tests for 0034 (role-based permission matrix),
// §17.16 #16 «التحقق من صلاحيات المستخدمين» — executed against production
// the safe way (same discipline as scripts/bayna-negative-tests.mjs):
//   * six throwaway users are created through the admin API and deleted
//     again at the end (existing accounts are never touched)
//   * every row they create lives inside ONE database transaction that is
//     rolled back in a finally block — nothing is ever committed
//   * role switches (authenticated / anon) happen inside savepoints, so a
//     raised exception cannot abort the remaining tests
//
// Coverage:
//   A. constraints        profiles_role_check (8 roles) + role_permissions
//   B. has_permission     the matrix per role + is_banned refusal
//   C. admin_list_role_permissions   96 rows, per-role counts, gates
//   D. admin_set_role_permission     all SIX refusal codes + happy path
//   E. admin_set_user_role           whitelist, rank gates, owner bootstrap
//   F. protect_profile_privileges    silent revert / loud self-escalation /
//                                    last-owner protection
//   G. RLS policies                  listings / requests / audit via
//                                    has_permission
//   H. re-declared function gates    complaints + listings.review
//   I. owner-gap fixes               consume_listing_quota + topup notify
//   J. anon                          has_permission granted BY DESIGN,
//                                    list/set RPCs denied
//
// Usage: node scripts/bayna-test-0034.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Env lives in ui-prototype/.env.server (same convention as the other scripts).
for (const name of [join(root, "ui-prototype", ".env.server"), join(root, ".env.server")]) {
  try {
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* optional */ }
}

const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_PW = process.env.SUPABASE_DB_PASSWORD;

if (!URL_ || !PUB || !SECRET || !DB_PW) {
  console.error("missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY / SUPABASE_DB_PASSWORD");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS  ${n}${d ? ` — ${d}` : ""}`); };
const bad = (n, d = "") => { fail++; console.log(`FAIL  ${n}${d ? ` — ${d}` : ""}`); };
const chk = (n, cond, d = "") => (cond ? ok(n, d) : bad(n, d));

// pg is only in ui-prototype/node_modules (same as the other scripts).
const require_ = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require_("pg");

const db = new Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password: DB_PW,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function adminFetch(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------- role helpers (all inside the one open transaction) ------------
let spSeq = 0;
const nextSp = () => `perm_sp_${++spSeq}`;

// Back to the plain postgres session role with no JWT claims, so the next
// setup statement cannot accidentally see a test user's auth.uid().
async function bePostgres() {
  await db.query("reset role");
  await db.query(`set local request.jwt.claims = '{}'`);
}

function claimsFor(user) {
  return `'${JSON.stringify({ sub: user.id, role: "authenticated", email: user.email })}'`;
}

// Run a statement as `user`. On success the writes stay; on error the
// savepoint is rolled back (recovering the transaction) and the original
// error is rethrown for the caller to fail on.
async function runAs(user, sql, params) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  await db.query("set local role authenticated");
  await db.query(`set local request.jwt.claims = ${claimsFor(user)}`);
  let res;
  try {
    res = await db.query(sql, params);
  } catch (e) {
    await db.query(`rollback to savepoint ${s}`);
    await bePostgres();
    throw e;
  }
  await bePostgres();
  return res;
}

// Run `sql` as `user` expecting a RAISED error matching `pattern`. The call
// (success or failure) is always rolled back, then the role is restored.
// user = null runs as plain postgres (constraint tests need no auth context).
async function expectRaise(label, user, sql, params, pattern) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  if (user) {
    await db.query("set local role authenticated");
    await db.query(`set local request.jwt.claims = ${claimsFor(user)}`);
  }
  let raised = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    raised = e;
  }
  await db.query(`rollback to savepoint ${s}`);
  await bePostgres();
  if (!raised) bad(label, `expected "${pattern}" but the call succeeded`);
  else if (String(raised.message).includes(pattern)) ok(label, `"${String(raised.message).trim()}"`);
  else bad(label, `expected "${pattern}", got "${String(raised.message).trim()}"`);
}

// Run `sql` as anon expecting `permission denied`. If this session cannot
// switch to anon at all, fall back to proving the refusal from the ACL.
async function expectAnonDenied(label, sql, params, signature) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  let raised = null;
  let setRoleError = null;
  try {
    await db.query("set local role anon");
    await db.query(`set local request.jwt.claims = '{}'`);
    try {
      await db.query(sql, params);
    } catch (e) {
      raised = e;
    }
  } catch (e) {
    setRoleError = e;
  }
  await db.query(`rollback to savepoint ${s}`);
  await bePostgres();

  if (setRoleError) {
    const r = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as allowed`,
      [signature],
    );
    if (r.rows[0].allowed === false) {
      ok(label, `anon lacks EXECUTE on ${signature} (set role anon unavailable: ${setRoleError.message})`);
    } else {
      bad(label, `anon HAS execute on ${signature}`);
    }
    return;
  }
  if (!raised) bad(label, "anon could execute the function");
  else if (/permission denied/i.test(String(raised.message))) ok(label, `"${String(raised.message).trim()}"`);
  else bad(label, `expected permission denied, got "${String(raised.message).trim()}"`);
}

// Run `sql` as `user` WITHOUT switching roles: postgres (table owner) keeps
// its grants, while auth.uid() still resolves to `user` through the JWT
// claims. Needed because 0017 §10 revoked UPDATE on profiles from
// authenticated — the protect_profile_privileges trigger tests must reach the
// table directly, and only the trigger (not RLS) is under test.
async function runDirect(user, sql, params) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  await db.query(`set local request.jwt.claims = ${claimsFor(user)}`);
  let res;
  try {
    res = await db.query(sql, params);
  } catch (e) {
    await db.query(`rollback to savepoint ${s}`);
    await db.query(`set local request.jwt.claims = '{}'`);
    throw e;
  }
  await db.query(`set local request.jwt.claims = '{}'`);
  return res;
}

// expectRaise, postgres+claims variant (see runDirect).
async function expectRaiseDirect(label, user, sql, params, pattern) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  await db.query(`set local request.jwt.claims = ${claimsFor(user)}`);
  let raised = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    raised = e;
  }
  await db.query(`rollback to savepoint ${s}`);
  await db.query(`set local request.jwt.claims = '{}'`);
  if (!raised) bad(label, `expected "${pattern}" but the call succeeded`);
  else if (String(raised.message).includes(pattern)) ok(label, `"${String(raised.message).trim()}"`);
  else bad(label, `expected "${pattern}", got "${String(raised.message).trim()}"`);
}

// has_permission is GRANTED to anon by design (policy evaluation), so the
// expectation is a successful call returning false — with an ACL fallback
// when the session cannot switch roles.
async function expectAnonHasPermission(label, perm) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  let value;
  let setRoleError = null;
  try {
    await db.query("set local role anon");
    await db.query(`set local request.jwt.claims = '{}'`);
    try {
      const r = await db.query(`select public.has_permission($1) as b`, [perm]);
      value = r.rows[0].b;
    } catch (e) {
      setRoleError = e;
    }
  } catch (e) {
    setRoleError = e;
  }
  await db.query(`rollback to savepoint ${s}`);
  await bePostgres();

  if (setRoleError) {
    const r = await db.query(
      `select has_function_privilege('anon', 'public.has_permission(text)', 'execute') as allowed`,
    );
    if (r.rows[0].allowed === true) {
      ok(label, `anon holds EXECUTE on has_permission by design (set role anon unavailable: ${setRoleError.message})`);
    } else {
      bad(label, "anon lacks EXECUTE on has_permission — policies would break for anon");
    }
    return;
  }
  chk(label, value === false, `has_permission('${perm}') as anon = ${value}, want false`);
}

// has_permission per role, from the role's own session.
async function expectPerm(label, user, perm, want) {
  const r = await runAs(user, `select public.has_permission($1) as b`, [perm]);
  chk(label, r.rows[0].b === want, `got ${r.rows[0].b}, want ${want}`);
}

// ---------- throwaway users ----------------------------------------------
const stamp = Date.now();
const U = {
  admin: { label: "admin", email: `perm.admin.${stamp}@badal-test.example`, name: "PermAdmin" },
  super: { label: "super", email: `perm.super.${stamp}@badal-test.example`, name: "PermSuper" },
  mod: { label: "mod", email: `perm.mod.${stamp}@badal-test.example`, name: "PermMod" },
  support: { label: "support", email: `perm.support.${stamp}@badal-test.example`, name: "PermSupport" },
  ops: { label: "ops", email: `perm.ops.${stamp}@badal-test.example`, name: "PermOps" },
  plain: { label: "plain", email: `perm.plain.${stamp}@badal-test.example`, name: "PermPlain" },
};
const ROLES = { admin: "admin", super: "super_admin", mod: "moderator", support: "support", ops: "operations", plain: "user" };

// ---------- the run --------------------------------------------------------
let draft1 = null;
let draft2 = null;
const preCounts = {};

await db.connect();
await db.query("begin");

try {
  // Baselines captured BEFORE the throwaway users exist, so the post-rollback
  // comparison proves the rollback (the profiles rows themselves are created
  // OUTSIDE this transaction — see below — and are removed in the cleanup).
  for (const t of ["profiles", "notifications", "admin_audit_log", "listings", "role_permissions"]) {
    const r = await db.query(`select count(*)::int as n from public.${t}`);
    preCounts[t] = r.rows[0].n;
  }
  console.log(`baselines: ${JSON.stringify(preCounts)}`);

  // Create the throwaway users. handle_new_user (0001) inserts each profile
  // in the GoTrue session — i.e. committed OUTSIDE this transaction — with the
  // default role 'user'. Roles are therefore assigned here with the guard
  // trigger briefly disabled (postgres owns the table; ALTER TABLE is
  // transactional, so a crash re-enables it on rollback).
  for (const u of Object.values(U)) {
    const created = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: u.email,
        password: `Pm-${randomUUID().slice(0, 8)}-2026!`,
        email_confirm: true,
        user_metadata: { display_name: u.name },
      }),
    });
    u.id = created.id;
  }
  console.log(`throwaway users: ${Object.entries(U).map(([k, u]) => `${k}=${u.id}`).join(" ")}`);

  await db.query("alter table public.profiles disable trigger protect_profile_privileges");
  for (const [key, role] of Object.entries(ROLES)) {
    const r = await db.query(`update public.profiles set role = $2 where id = $1`, [U[key].id, role]);
    if (r.rowCount !== 1) {
      bad(`setup: profile for ${key} was not created by handle_new_user`, `rows=${r.rowCount}`);
    }
  }
  await db.query("alter table public.profiles enable trigger protect_profile_privileges");

  // F4 demotes the throwaway super_admin — that only proves the last-standing
  // check does NOT over-trigger when a real, active super_admin exists.
  const activeSuper = await db.query(
    `select count(*)::int as n from public.profiles where role = 'super_admin' and is_banned = false and id <> $1`,
    [U.super.id],
  );
  chk("precheck: a second active super_admin exists (F4 precondition)",
    activeSuper.rows[0].n >= 1, `count=${activeSuper.rows[0].n}`);

  // Fixtures: two draft listings owned by `plain` (drafts are invisible to
  // anyone but the owner unless the viewer holds listings.review).
  for (const tag of ["1", "2"]) {
    const l = await runAs(U.plain, `
      insert into public.listings
        (owner_id, title, description, listing_type, category, city, status, rental_price, rental_unit)
      values
        ($1, $2, '0034 permission fixture — rolled back', 'rent', 'electronics', 'Cairo', 'draft', 10, 'يوم')
      returning id`, [U.plain.id, `PERMTEST ${stamp} ${tag}`]);
    if (tag === "1") draft1 = l.rows[0]?.id ?? null;
    else draft2 = l.rows[0]?.id ?? null;
  }
  chk("setup: two draft fixtures created", !!draft1 && !!draft2, `draft1=${draft1} draft2=${draft2}`);

  // ---------------- A. constraints ----------------------------------------
  await expectRaise(
    "A1 profiles_role_check rejects an unknown role",
    null,
    `insert into public.profiles (id, display_name, role) values ($1, 'BadRole', 'god')`,
    [randomUUID()],
    "profiles_role_check",
  );
  await expectRaise(
    "A2 role_permissions_role_check rejects an unknown role",
    null,
    `insert into public.role_permissions (role, permission) values ('god', 'reports.view')`,
    [],
    "role_permissions_role_check",
  );
  await expectRaise(
    "A3 role_permissions_permission_check rejects an unknown permission",
    null,
    `insert into public.role_permissions (role, permission) values ('admin', 'x.y')`,
    [],
    "role_permissions_permission_check",
  );

  // ---------------- B. has_permission per role ----------------------------
  await expectPerm("B1 support holds complaints.view", U.support, "complaints.view", true);
  await expectPerm("B1b support does NOT hold listings.review", U.support, "listings.review", false);
  await expectPerm("B2 ops holds listings.review", U.ops, "listings.review", true);
  await expectPerm("B2b ops does NOT hold complaints.manage", U.ops, "complaints.manage", false);
  await expectPerm("B3 mod holds disputes.manage", U.mod, "disputes.manage", true);
  await expectPerm("B3b mod does NOT hold audit.view", U.mod, "audit.view", false);
  await expectPerm("B4 plain holds nothing", U.plain, "reports.view", false);
  await expectPerm("B4b plain does NOT hold users.manage", U.plain, "users.manage", false);

  // is_banned refusal: ban support through the admin RPC (0017 revoked
  // direct UPDATE on profiles from authenticated), check, unban.
  await runAs(U.admin, `select public.admin_set_user_ban($1, true)`, [U.support.id]);
  await expectPerm("B5 a banned account holds NO permission", U.support, "complaints.view", false);
  await runAs(U.admin, `select public.admin_set_user_ban($1, false)`, [U.support.id]);
  await expectPerm("B5b unbanned, the permission returns", U.support, "complaints.view", true);

  // ---------------- C. admin_list_role_permissions -------------------------
  const c1 = await runAs(U.admin, `
    select count(*)::int as total,
           count(*) filter (where granted)::int as granted_n
      from public.admin_list_role_permissions()`);
  chk("C1 the matrix is 8x12 = 96 rows",
    c1.rows[0].total === 96 && c1.rows[0].granted_n === 49,
    `total=${c1.rows[0].total} granted=${c1.rows[0].granted_n}`);
  const c2 = await runAs(U.admin, `
    select role, count(*) filter (where granted)::int as g
      from public.admin_list_role_permissions()
     group by role`);
  const wantCounts = { user: 0, merchant: 0, support: 3, operations: 3, moderator: 8, admin: 11, super_admin: 12, owner: 12 };
  const gotCounts = Object.fromEntries(c2.rows.map((r) => [r.role, r.g]));
  chk("C2 per-role granted counts match the seeds",
    Object.entries(wantCounts).every(([k, v]) => gotCounts[k] === v),
    JSON.stringify(gotCounts));
  await expectRaise(
    "C3 a moderator cannot list the matrix",
    U.mod,
    `select * from public.admin_list_role_permissions()`,
    [],
    "permission denied",
  );
  await expectAnonDenied(
    "anon cannot call admin_list_role_permissions",
    `select * from public.admin_list_role_permissions()`,
    [],
    "public.admin_list_role_permissions()",
  );

  // ---------------- D. admin_set_role_permission ---------------------------
  await expectRaise("D1 a moderator cannot manage permissions", U.mod,
    `select public.admin_set_role_permission('support', 'reports.view', true)`, [], "permission denied");
  await expectRaise("D2 an ADMIN cannot manage permissions (needs permissions.manage)", U.admin,
    `select public.admin_set_role_permission('support', 'reports.view', true)`, [], "permission denied");
  await expectAnonDenied(
    "anon cannot call admin_set_role_permission",
    `select public.admin_set_role_permission('support', 'reports.view', true)`,
    [],
    "public.admin_set_role_permission(text,text,boolean)",
  );
  await expectRaise("D3 a null grant is refused", U.super,
    `select public.admin_set_role_permission('support', 'reports.view', null)`, [], "permission_grant_invalid");
  await expectRaise("D4 an unknown role is refused", U.super,
    `select public.admin_set_role_permission('god', 'reports.view', true)`, [], "role_invalid");
  await expectRaise("D5 an unknown permission is refused", U.super,
    `select public.admin_set_role_permission('support', 'x.y', true)`, [], "permission_unknown");
  await expectRaise("D6 editing your own role is refused", U.super,
    `select public.admin_set_role_permission('super_admin', 'reports.view', false)`, [], "permission_self_edit");
  await expectRaise("D7 a role at/above your rank is refused", U.super,
    `select public.admin_set_role_permission('owner', 'reports.view', true)`, [], "permission_rank");

  // Happy path: super grants support one more permission (+ audit row).
  const d8 = await runAs(U.super, `select public.admin_set_role_permission('support', 'reports.view', true) as r`);
  chk("D8 super can grant a permission it holds", d8.rows[0].r?.granted === true, JSON.stringify(d8.rows[0].r));
  const d8b = await db.query(
    `select count(*)::int as n from public.role_permissions where role='support' and permission='reports.view'`);
  chk("D8b the cell now exists", d8b.rows[0].n === 1, `rows=${d8b.rows[0].n}`);
  const d8c = await db.query(
    `select count(*)::int as n from public.admin_audit_log where action='set_role_permission'`);
  chk("D8c the change was audited", d8c.rows[0].n >= 1, `rows=${d8c.rows[0].n}`);

  // ---------------- E. admin_set_user_role ---------------------------------
  await expectRaise("E1 a plain user cannot change roles", U.plain,
    `select public.admin_set_user_role($1, 'moderator')`, [U.plain.id], "ليست لديك صلاحية تعديل الأدوار");
  await expectRaise("E2 support cannot change roles", U.support,
    `select public.admin_set_user_role($1, 'moderator')`, [U.plain.id], "ليست لديك صلاحية تعديل الأدوار");
  await expectRaise("E3 an unknown role name is refused", U.admin,
    `select public.admin_set_user_role($1, 'god')`, [U.plain.id], "دور غير صالح");
  await expectRaise("E4 an admin cannot mint a super_admin", U.admin,
    `select public.admin_set_user_role($1, 'super_admin')`, [U.plain.id], "لا يمكنك منح صلاحية أعلى من صلاحيتك");
  await expectRaise("E5 an admin cannot mint an owner", U.admin,
    `select public.admin_set_user_role($1, 'owner')`, [U.plain.id], "لا يمكنك منح صلاحية أعلى من صلاحيتك");
  await expectRaise("E6 an admin cannot edit a super_admin (equal/higher)", U.admin,
    `select public.admin_set_user_role($1, 'admin')`, [U.super.id], "لا يمكنك تعديل دور يساوي صلاحيتك أو يفوقها");

  // Positive: admin promotes plain -> support (below its own rank).
  await runAs(U.admin, `select public.admin_set_user_role($1, 'support')`, [U.plain.id]);
  const e7 = await db.query(`select role from public.profiles where id = $1`, [U.plain.id]);
  chk("E7 admin promotes plain -> support", e7.rows[0].role === "support", e7.rows[0].role);

  // E7b: put plain back to 'user' — the later blocks (F/G) must see a
  // below-admin account without any permission (support would hold three).
  await runAs(U.admin, `select public.admin_set_user_role($1, 'user')`, [U.plain.id]);
  const e7b = await db.query(`select role from public.profiles where id = $1`, [U.plain.id]);
  chk("E7b admin demotes support -> user", e7b.rows[0].role === "user", e7b.rows[0].role);

  // Positive: the owner bootstrap — super mints the FIRST owner (ops),
  // for someone else, while no active owner exists.
  await runAs(U.super, `select public.admin_set_user_role($1, 'owner')`, [U.ops.id]);
  const e8 = await db.query(`select role from public.profiles where id = $1`, [U.ops.id]);
  chk("E8 super mints the first owner (bootstrap)", e8.rows[0].role === "owner", e8.rows[0].role);

  // The bootstrap closes: a second owner is refused while one is active.
  await expectRaise("E9 a second owner is refused while one exists", U.super,
    `select public.admin_set_user_role($1, 'owner')`, [U.mod.id], "لا يمكنك منح صلاحية أعلى من صلاحيتك");

  // D9/D10 need the owner: revoke a permission from super, then watch the
  // grant-exceeds refusal when super tries to hand it out.
  const d9 = await runAs(U.ops, `select public.admin_set_role_permission('super_admin', 'settings.manage', false) as r`);
  chk("D9 the owner can revoke from super_admin", d9.rows[0].r?.granted === false, JSON.stringify(d9.rows[0].r));
  await expectRaise("D10 granting a permission you do not hold is refused", U.super,
    `select public.admin_set_role_permission('support', 'settings.manage', true)`, [], "permission_grant_exceeds");

  // ---------------- F. protect_profile_privileges (direct UPDATE) ----------
  // All four run as postgres+claims (runDirect): 0017 revoked direct UPDATE
  // on profiles from authenticated, and here the TRIGGER is the unit under
  // test — not RLS, not grants.
  const f0 = (await db.query(`select role from public.profiles where id = $1`, [U.plain.id])).rows[0].role;
  await runDirect(U.plain, `update public.profiles set role = 'admin' where id = $1`, [U.plain.id]);
  const f1 = (await db.query(`select role from public.profiles where id = $1`, [U.plain.id])).rows[0].role;
  chk("F1 below-admin self-escalation is silently reverted", f1 === f0, `${f0} -> ${f1}`);
  await expectRaiseDirect("F2 admin self-escalation fails LOUDLY", U.admin,
    `update public.profiles set role = 'super_admin' where id = $1`, [U.admin.id],
    "لا يمكنك منح صلاحية أعلى من صلاحيتك");
  await expectRaiseDirect("F3 the last owner cannot demote themselves", U.ops,
    `update public.profiles set role = 'admin' where id = $1`, [U.ops.id],
    "لا يمكن تخفيض صلاحية آخر مالك");
  // Demoting the throwaway super_admin is ALLOWED (the real one exists) —
  // the last-standing check must not over-trigger.
  await runDirect(U.ops, `update public.profiles set role = 'admin' where id = $1`, [U.super.id]);
  const f4 = (await db.query(`select role from public.profiles where id = $1`, [U.super.id])).rows[0].role;
  chk("F4 a non-last super_admin can be demoted", f4 === "admin", f4);

  // ---------------- G. RLS policies gated by has_permission ---------------
  const g1 = await runAs(U.ops, `select exists(select 1 from public.listings where id = $1) as b`, [draft1]);
  chk("G1 listings.review sees another user's draft", g1.rows[0].b === true, String(g1.rows[0].b));
  const g2 = await runAs(U.support, `select exists(select 1 from public.listings where id = $1) as b`, [draft1]);
  chk("G2 without listings.review the draft stays invisible", g2.rows[0].b === false, String(g2.rows[0].b));
  const g3 = await runAs(U.support, `select count(*)::int as n from public.listing_requests`);
  const g3t = (await db.query(`select count(*)::int as n from public.listing_requests`)).rows[0].n;
  chk("G3 requests.view sees the whole queue", g3.rows[0].n === g3t, `support=${g3.rows[0].n} total=${g3t}`);
  const g4 = await runAs(U.plain, `select count(*)::int as n from public.listing_requests`);
  chk("G4 without requests.view only own rows (none) show", g4.rows[0].n === 0, `rows=${g4.rows[0].n}`);
  const g5 = await runAs(U.admin, `select count(*)::int as n from public.admin_audit_log`);
  chk("G5 audit.view reads the audit log", g5.rows[0].n >= 1, `rows=${g5.rows[0].n}`);
  const g6 = await runAs(U.mod, `select count(*)::int as n from public.admin_audit_log`);
  chk("G6 without audit.view the audit log is empty", g6.rows[0].n === 0, `rows=${g6.rows[0].n}`);

  // ---------------- H. re-declared function gates --------------------------
  const h1 = await runAs(U.support, `select count(*)::int as n from public.admin_list_complaints()`);
  chk("H1 support can read the complaints queue", h1.rows[0].n >= 0, `rows=${h1.rows[0].n}`);
  // H2/H4 use `plain`: E8 made ops an owner (holds every permission), so the
  // "without permission" cases must run as the account that holds none.
  await expectRaise("H2 without complaints.view the queue is refused", U.plain,
    `select count(*) from public.admin_list_complaints()`, [], "permission denied");
  await expectRaise("H3 the status filter still guards after the gate", U.support,
    `select count(*) from public.admin_list_complaints('bogus')`, [], "invalid_status_filter");
  await expectRaise("H4 without complaints.manage the transition is refused", U.plain,
    `select public.update_complaint_status($1, 'in_review')`, [randomUUID()], "permission denied");
  await expectRaise("H5 without listings.review moderation is refused", U.support,
    `select public.admin_set_listing_status($1, 'blocked')`, [draft1], "ليست لديك صلاحية إدارة الإعلانات");
  await expectRaise("H6 the status whitelist still guards after the gate", U.ops,
    `select public.admin_set_listing_status($1, 'bogus')`, [draft2], "حالة غير صالحة");
  await runAs(U.ops, `select public.admin_set_listing_status($1, 'blocked')`, [draft1]);
  const h7 = (await db.query(`select status from public.listings where id = $1`, [draft1])).rows[0];
  chk("H7 ops moderates a listing through listings.review", h7?.status === "blocked", h7?.status);

  // ---------------- I. owner-gap fixes -------------------------------------
  const i1 = await runAs(U.ops, `select public.consume_listing_quota($1) as r`, [draft2]);
  chk("I1 consume_listing_quota treats owner as admin (no quota hit)",
    i1.rows[0].r?.source === "admin", JSON.stringify(i1.rows[0].r));
  const i2before = (await db.query(`select count(*)::int as n from public.notifications where user_id = $1`, [U.ops.id])).rows[0].n;
  const i2modBefore = (await db.query(`select count(*)::int as n from public.notifications where user_id = $1`, [U.mod.id])).rows[0].n;
  await db.query(`insert into public.wallet_topups (user_id, amount_egp) values ($1, 100)`, [U.plain.id]);
  const i2after = (await db.query(`select count(*)::int as n from public.notifications where user_id = $1`, [U.ops.id])).rows[0].n;
  const i2modAfter = (await db.query(`select count(*)::int as n from public.notifications where user_id = $1`, [U.mod.id])).rows[0].n;
  chk("I2 a top-up notifies the owner (owner-gap fix)", i2after === i2before + 1, `${i2before} -> ${i2after}`);
  chk("I2b a top-up does NOT notify a moderator", i2modAfter === i2modBefore, `${i2modBefore} -> ${i2modAfter}`);

  // ---------------- J. anon on has_permission ------------------------------
  await expectAnonHasPermission("J1 anon can evaluate has_permission (by design)", "reports.view");
} catch (e) {
  bad("script aborted before completion", e.message);
} finally {
  // The whole point of the script: nothing is ever committed.
  try {
    await db.query("rollback");
    console.log("transaction rolled back");
  } catch (e) {
    bad("rollback failed", e.message);
  }

  // The throwaway PROFILES rows were created outside the transaction
  // (handle_new_user runs in the GoTrue session), so the users must be
  // deleted before any count can match the pre-run baselines again.
  for (const u of Object.values(U)) {
    if (!u.id) continue;
    try {
      await adminFetch(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
      console.log(`cleanup: deleted throwaway ${u.label} ${u.id}`);
    } catch (e) {
      bad(`cleanup: could not delete throwaway ${u.label}`, e.message);
    }
  }

  // Verify the rollback + cleanup actually left nothing behind.
  try {
    const post = {};
    for (const t of ["profiles", "notifications", "admin_audit_log", "listings", "role_permissions"]) {
      const r = await db.query(`select count(*)::int as n from public.${t}`);
      post[t] = r.rows[0].n;
    }
    for (const t of Object.keys(preCounts)) {
      chk(`rollback restored ${t}`, post[t] === preCounts[t], `pre=${preCounts[t]} post=${post[t]}`);
    }
    const roles = (await db.query(
      `select coalesce(jsonb_object_agg(role, c), '{}'::jsonb) as d
         from (select role, count(*)::int as c from public.profiles group by role) t`)).rows[0].d;
    chk("rollback restored the role distribution",
      JSON.stringify(roles) === JSON.stringify({ user: 28, moderator: 1, super_admin: 1 }),
      JSON.stringify(roles));
  } catch (e) {
    bad("post-rollback verification failed", e.message);
  }

  try { await db.end(); } catch { /* ignore */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
