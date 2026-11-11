// Negative-path tests for 0028 (handover codes) + 0029 (points wallet),
// executed against production the safe way:
//   * two throwaway users are created through the admin API and deleted again
//     at the end (existing accounts are never touched)
//   * every row they create lives inside ONE database transaction that is
//     rolled back in a finally block — nothing is ever committed
//   * role switches (authenticated / anon) happen inside savepoints, so a
//     raised exception cannot abort the remaining tests
//
// Refusals covered (verbatim messages from the migrations):
//   1. escrow pay only allowed on accepted requests  (paying a pending request)
//   2. insufficient_points                           (wallet cannot cover the booking)
//   3. return_code_required                          (releasing before the return code)
//   4. condition photo required                      (verifying handover without photos)
//   5. permission denied for anon on every escrow RPC
// plus two authorization refusals found along the way.
//
// Usage: node scripts/bayna-negative-tests.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
const nextSp = () => `neg_sp_${++spSeq}`;

// Back to the plain postgres session role with no JWT claims, so the next
// setup statement cannot accidentally see a test user's auth.uid().
async function bePostgres() {
  await db.query("reset role");
  await db.query(`set local request.jwt.claims = '{}'`);
}

function claimsFor(user) {
  return `'${JSON.stringify({ sub: user.id, role: "authenticated", email: user.email })}'`;
}

// Run a setup statement as `user`. On success the writes stay; on error the
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
async function expectRaise(label, user, sql, params, pattern) {
  const s = nextSp();
  await db.query(`savepoint ${s}`);
  await db.query("set local role authenticated");
  await db.query(`set local request.jwt.claims = ${claimsFor(user)}`);
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

// ---------- throwaway users ----------------------------------------------
const stamp = Date.now();
const owner = { label: "owner", email: `neg.owner.${stamp}@badal-test.example`, name: "NegOwner" };
const tenant = { label: "tenant", email: `neg.tenant.${stamp}@badal-test.example`, name: "NegTenant" };

// ---------- the run --------------------------------------------------------
let listingId = null;
let requestId = null;
let deliveryCode = null;

await db.connect();
await db.query("begin");

try {
  // Two temporary users; profiles rows are inserted directly because the
  // signup trigger does not fire for admin-created users.
  for (const u of [owner, tenant]) {
    const created = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: u.email,
        password: `Ng-${randomUUID().slice(0, 8)}-2026!`,
        email_confirm: true,
        user_metadata: { display_name: u.name },
      }),
    });
    u.id = created.id;
    await db.query(
      `insert into public.profiles (id, display_name) values ($1, $2) on conflict (id) do nothing`,
      [u.id, u.name],
    );
  }
  console.log(`throwaway users: owner=${owner.id} tenant=${tenant.id}`);

  // Fixture: a published rent listing (2 days x 10 points = 20 points).
  const day = 86400000;
  const rentStart = new Date(Date.now() + 30 * day).toISOString().slice(0, 10);
  const rentEnd = new Date(Date.now() + 31 * day).toISOString().slice(0, 10);
  const expectedPoints = 2 * 10;

  // Created as a draft first: the quota trigger only runs on the
  // draft -> published transition (a BEFORE INSERT publish would FK-fail
  // against listing_quota_log because the listing row does not exist yet).
  const l = await runAs(owner, `
    insert into public.listings
      (owner_id, title, description, listing_type, category, city, status, rental_price, rental_unit)
    values
      ($1, $2, 'fixture for negative tests — rolled back', 'rent', 'electronics', 'Cairo', 'draft', 10, 'يوم')
    returning id`, [owner.id, `NEGTEST ${stamp} — كرسي مكتبي`]);
  listingId = l.rows[0]?.id ?? null;
  chk("setup: draft rent listing created", !!listingId, listingId ?? "no id");

  // Publish as the owner: consume_listing_quota needs auth.uid() = the owner.
  await runAs(owner, `update public.listings set status = 'published' where id = $1`, [listingId]);
  const lst = await db.query(`select status from public.listings where id = $1`, [listingId]);
  chk("setup: listing published", lst.rows[0]?.status === "published", lst.rows[0]?.status ?? "none");

  // Fixture: a pending rent request from the tenant.
  const r = await runAs(tenant, `
    insert into public.listing_requests
      (listing_id, requester_id, request_type, message, rent_start, rent_end)
    values
      ($1, $2, 'rent', 'negative-test fixture', $3, $4)
    returning id`, [listingId, tenant.id, rentStart, rentEnd]);
  requestId = r.rows[0]?.id ?? null;
  const st1 = await db.query(`select status from public.listing_requests where id = $1`, [requestId]);
  chk("setup: rent request created as pending",
    !!requestId && st1.rows[0]?.status === "pending",
    `${requestId ?? "none"} / ${st1.rows[0]?.status ?? "none"}`);

  // 1) paying a PENDING request must be refused (0029).
  await expectRaise(
    "0029 pay on a pending request is refused",
    tenant,
    `select public.escrow_pay_external($1, $2)`,
    [requestId, expectedPoints],
    "escrow pay only allowed on accepted requests",
  );

  // Setup: the owner accepts (the only role allowed to by enforce_request_transition).
  const acc = await runAs(owner,
    `update public.listing_requests set status = 'accepted' where id = $1`, [requestId]);
  const st2 = await db.query(`select status from public.listing_requests where id = $1`, [requestId]);
  chk("setup: owner accepted the request",
    acc.rowCount === 1 && st2.rows[0]?.status === "accepted",
    st2.rows[0]?.status ?? "none");

  // 2) an accepted request with an EMPTY wallet must stop at insufficient_points.
  await expectRaise(
    "0029 paying with an empty wallet is refused",
    tenant,
    `select public.escrow_pay_external($1, $2)`,
    [requestId, expectedPoints],
    "insufficient_points",
  );

  // Setup: grant exactly the booking amount (rolled back with everything else).
  await db.query(
    `insert into public.wallet_balances (user_id, balance, updated_at)
     values ($1, $2, now())
     on conflict (user_id) do update set balance = excluded.balance, updated_at = now()`,
    [tenant.id, expectedPoints],
  );
  await db.query(
    `insert into public.wallet_transactions (user_id, amount, kind, note)
     values ($1, $2, 'deposit', 'negative-test grant — rolled back')`,
    [tenant.id, expectedPoints],
  );
  ok("setup: points granted", `${expectedPoints} points`);

  // The happy path every later refusal assumes: points -> held + both codes.
  const pay = await runAs(tenant,
    `select public.escrow_pay_external($1, $2) as result`, [requestId, expectedPoints]);
  const payObj = pay.rows[0]?.result;
  chk("0029 points payment mints a held escrow",
    payObj?.status === "held" && payObj?.payment_method === "points",
    JSON.stringify(payObj ?? null));

  const codeRes = await db.query(
    `select code from public.booking_handover_codes
      where request_id = $1 and purpose = 'delivery'`, [requestId]);
  deliveryCode = codeRes.rows[0]?.code ?? null;
  chk("0028 delivery code minted at held time",
    /^[0-9]{6}$/.test(deliveryCode || ""), deliveryCode || "missing");

  // 3) releasing escrow before the return code is verified must be refused.
  await expectRaise(
    "0028 release without the return code is refused",
    owner,
    `select public.wallet_escrow_release($1)`,
    [requestId],
    "return_code_required",
  );

  // The tenant is not the payee — refused even before the return-code gate.
  await expectRaise(
    "0028 the tenant cannot release escrow",
    tenant,
    `select public.wallet_escrow_release($1)`,
    [requestId],
    "only the seller can release escrow",
  );

  // 4) condition record: note alone is not enough, a photo is mandatory.
  await expectRaise(
    "0028 delivery verification without photos is refused",
    tenant,
    `select public.verify_handover_code($1, 'delivery', $2, $3, '{}'::text[])`,
    [requestId, deliveryCode, "ملاحظة الحالة عند التسليم"],
    "condition photo required",
  );

  // The RETURN code belongs to the owner, not the tenant.
  await expectRaise(
    "0028 the tenant cannot verify the return code",
    tenant,
    `select public.verify_handover_code($1, 'return', '000000', 'ملاحظة', '{}'::text[])`,
    [requestId],
    "only the owner can verify return",
  );

  // 5) anon must not reach any of the escrow/handover RPCs.
  await expectAnonDenied(
    "anon cannot call escrow_pay_external",
    `select public.escrow_pay_external($1, $2)`,
    [requestId, expectedPoints],
    "public.escrow_pay_external(uuid,numeric)",
  );
  await expectAnonDenied(
    "anon cannot call wallet_escrow_release",
    `select public.wallet_escrow_release($1)`,
    [requestId],
    "public.wallet_escrow_release(uuid)",
  );
  await expectAnonDenied(
    "anon cannot call verify_handover_code",
    `select public.verify_handover_code($1, 'delivery', '000000', 'x', '{}'::text[])`,
    [requestId],
    "public.verify_handover_code(uuid,text,text,text,text[])",
  );
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

  // Verify the rollback actually left no rows behind.
  try {
    if (listingId) {
      const g1 = await db.query(`select count(*)::int as n from public.listings where id = $1`, [listingId]);
      chk("rollback removed the fixture listing", g1.rows[0].n === 0, `rows=${g1.rows[0].n}`);
    }
    if (requestId) {
      const g2 = await db.query(`select count(*)::int as n from public.escrow_holds where request_id = $1`, [requestId]);
      const g3 = await db.query(`select count(*)::int as n from public.booking_handover_codes where request_id = $1`, [requestId]);
      chk("rollback removed escrow hold + codes",
        g2.rows[0].n === 0 && g3.rows[0].n === 0,
        `holds=${g2.rows[0].n} codes=${g3.rows[0].n}`);
    }
    const ids = [owner.id, tenant.id].filter(Boolean);
    if (ids.length) {
      const g4 = await db.query(
        `select count(*)::int as n from public.wallet_balances where user_id = any($1::uuid[])`, [ids]);
      const g5 = await db.query(
        `select count(*)::int as n from public.wallet_transactions where user_id = any($1::uuid[])`, [ids]);
      chk("rollback removed wallet rows",
        g4.rows[0].n === 0 && g5.rows[0].n === 0,
        `balances=${g4.rows[0].n} tx=${g5.rows[0].n}`);
    }
  } catch (e) {
    bad("post-rollback verification failed", e.message);
  }

  try { await db.end(); } catch { /* ignore */ }

  // Immediate cleanup: delete the throwaway users (profiles cascade with them).
  for (const u of [owner, tenant]) {
    if (!u.id) continue;
    try {
      await adminFetch(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
      console.log(`cleanup: deleted throwaway ${u.label} ${u.id}`);
    } catch (e) {
      bad(`cleanup: could not delete throwaway ${u.label}`, e.message);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
