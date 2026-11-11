// Post-apply protocol for 0026_batch1_security_fixes.sql (the 8 checks listed
// at the bottom of the migration), executed read/write against production with
// throwaway pentest users only.
//
// SQL checks 1-3 run inside transactions that are ALWAYS rolled back, so no
// listing_requests / notification rows are ever committed.
// Storage checks 4-6 upload files that are removed again in cleanup.
//
// Usage: node scripts/bayna-post-0026-protocol.mjs
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require("pg");

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* optional */ }
}
loadEnv(join(root, "ui-prototype", ".env.server"));

const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const DB_PW = process.env.SUPABASE_DB_PASSWORD;

const USER_A = "5346fbfc-8e1f-47b3-bece-68d89dd4a03f"; // pentest-f2-f3318437
const USER_A_EMAIL = "pentest-f2-f3318437@example.com";
const USER_A_PW = "Pt-Bayna-2026-f2test-9Xk!";
const FOREIGN_ORDER = "ba2ec935-095b-4ef1-b642-50f3741f9954"; // owned by 9bbd19e1
const PUBLISHED_LISTING = "f89fb622-5458-4ed6-80a9-b05914a112a1"; // owner dd64e33d
const LISTING_OWNER = "dd64e33d-4456-4bca-ab92-98ed77d11c8c";

if (!URL_ || !PUB || !DB_PW) {
  console.error("missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_DB_PASSWORD");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS  ${n}${d ? ` — ${d}` : ""}`); };
const bad = (n, d = "") => { fail++; console.log(`FAIL  ${n}${d ? ` — ${d}` : ""}`); };
const chk = (n, cond, d = "") => (cond ? ok(n, d) : bad(n, d));

const db = new Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password: DB_PW,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

// Run `body` as the authenticated pentest user inside a transaction that is
// rolled back no matter what, so nothing is ever committed.
async function asUser(label, body) {
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query(
      `set local request.jwt.claims = '${JSON.stringify({
        sub: USER_A, role: "authenticated", email: USER_A_EMAIL,
      })}'`,
    );
    const out = await body();
    await db.query("rollback");
    return out;
  } catch (e) {
    try { await db.query("rollback"); } catch { /* ignore */ }
    return { error: e };
  }
}

// ---------------------------------------------------------------------------
// 1. INSERT with status='accepted' must land as 'pending' with paid_at null
// ---------------------------------------------------------------------------
{
  const r = await asUser("1", () =>
    db.query(
      `insert into public.listing_requests
         (listing_id, requester_id, owner_id, request_type, status, message)
       values ($1, $2, $3, 'purchase', 'accepted', 'post-0026 protocol probe')
       returning id, status, paid_at, payer_confirmed_at, payee_confirmed_at, created_at`,
      [PUBLISHED_LISTING, USER_A, LISTING_OWNER],
    ),
  );
  if (r.error) {
    bad("1 INSERT status='accepted' lands as pending", `unexpected error: ${r.error.message}`);
  } else {
    const row = r.rows[0];
    chk("1 INSERT status='accepted' lands as pending",
      row.status === "pending", `status=${row.status}`);
    chk("1 paid_at / payer_confirmed_at stay null",
      row.paid_at === null && row.payer_confirmed_at === null && row.payee_confirmed_at === null,
      `paid_at=${row.paid_at}`);
  }
}

// ---------------------------------------------------------------------------
// 2. INSERT naming paid_at / id / created_at must fail with permission denied
// ---------------------------------------------------------------------------
for (const col of ["paid_at", "id", "created_at"]) {
  const r = await asUser(`2-${col}`, () =>
    db.query(
      `insert into public.listing_requests
         (listing_id, requester_id, owner_id, request_type, ${col})
       values ($1, $2, $3, 'purchase', ${
         col === "paid_at" ? "now()" : col === "id" ? "gen_random_uuid()" : "now()"
       })`,
      [PUBLISHED_LISTING, USER_A, LISTING_OWNER],
    ),
  );
  const msg = r.error?.message ?? "no error";
  const denied = r.error?.code === "42501" || /permission denied for column/i.test(msg);
  chk(`2 INSERT naming ${col} -> permission denied`, denied, `${r.error?.code ?? ""} ${msg.slice(0, 90)}`);
}

// ---------------------------------------------------------------------------
// 3. escrow_pay_external + wallet_escrow_release still callable (drop-in)
//    Called with a non-existent request id so they raise their own business
//    error instead of a permission error, and mutate nothing.
// ---------------------------------------------------------------------------
for (const [fn, call] of [
  ["escrow_pay_external", `select public.escrow_pay_external('00000000-0000-0000-0000-0000000000ff', 100, 'wallet_qr')`],
  ["wallet_escrow_release", `select public.wallet_escrow_release('00000000-0000-0000-0000-0000000000ff')`],
]) {
  const r = await asUser(`3-${fn}`, () => db.query(call));
  const msg = r.error?.message ?? "";
  const permissionErr = /permission denied for function|does not exist/i.test(msg);
  chk(`3 ${fn} still callable`, r.error ? !permissionErr : true,
    r.error ? `raised: ${msg.slice(0, 90)}` : "returned");
}

// ---------------------------------------------------------------------------
// Storage + API checks need a real session
// ---------------------------------------------------------------------------
const a = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInErr } = await a.auth.signInWithPassword({
  email: USER_A_EMAIL, password: USER_A_PW,
});
if (signInErr) {
  console.error(`\ncannot sign in ${USER_A_EMAIL}: ${signInErr.message}`);
  console.log(`\n=== ${pass} passed, ${fail} failed (storage/API checks skipped) ===`);
  await db.end();
  process.exit(1);
}

const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
const uploads = [];
const cleanupOrder = [];

// ---------------------------------------------------------------------------
// 4. .list() on payment-qr must not enumerate other users / platform folder
// ---------------------------------------------------------------------------
{
  const { data, error } = await a.storage.from("payment-qr").list("", { limit: 100 });
  if (error) {
    chk("4 authenticated .list() on payment-qr", false, error.message);
  } else {
    const names = (data ?? []).map((d) => d.name);
    const foreign = names.filter((n) => n !== USER_A && !n.startsWith(USER_A));
    chk("4 authenticated .list() returns only own folder",
      foreign.length === 0, `saw: ${JSON.stringify(names).slice(0, 200)}`);
  }

  const { data: anonData, error: anonErr } = await anon.storage.from("payment-qr").list("", { limit: 100 });
  const anonNames = (anonData ?? []).map((d) => d.name);
  chk("4 anon .list() on payment-qr blocked or empty",
    !!anonErr || anonNames.length === 0,
    anonErr ? `err=${anonErr.message.slice(0, 80)}` : `saw ${anonNames.length} entries`);
}

// ---------------------------------------------------------------------------
// 5. .html under <uid>/ -> 403 ; .jpg under <uid>/ -> 200
// ---------------------------------------------------------------------------
{
  const htmlPath = `${USER_A}/protocol-probe.html`;
  const { error: htmlErr } = await a.storage.from("payment-qr")
    .upload(htmlPath, "<html><body>probe</body></html>", { contentType: "text/html", upsert: false });
  chk("5 upload .html under own folder -> 403", !!htmlErr,
    htmlErr ? `status hint: ${htmlErr.message.slice(0, 90)}` : "UPLOADED (not blocked)");

  const jpgPath = `${USER_A}/protocol-probe.jpg`;
  const jpgBytes = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA" +
    "AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMB" +
    "AAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAA" +
    "AAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAA" +
    "AAAAAAAAAAAAAAABAhAAAhAAh//9oACAECAAY/AkT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEB" +
    "AAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAADH/2gAIAQMBAT8Qf//EABQR" +
    "AQAAAAAAAAAAAAAAAAAAADH/2gAIAQIBAT8Qf//EABQQAQAAAAAAAAAAAAAAAAAAADH/2gAIAQEA" +
    "AT8Qf//Z",
    "base64",
  );
  const { error: jpgErr } = await a.storage.from("payment-qr")
    .upload(jpgPath, jpgBytes, { contentType: "image/jpeg", upsert: false });
  chk("5 upload .jpg under own folder -> 200", !jpgErr,
    jpgErr ? jpgErr.message.slice(0, 120) : "uploaded");
  if (!jpgErr) uploads.push(jpgPath);
}

// ---------------------------------------------------------------------------
// 6. subscription-screenshots: own order -> 200, someone else's -> 403
// ---------------------------------------------------------------------------
{
  // own order fixture (pending, for this throwaway user) — removed in cleanup
  const ownOrder = "11111111-2222-4333-8444-555555555555";
  const ins = await db.query(
    `insert into public.subscription_orders (id, user_id, plan_id, amount_egp, status, payment_method)
     values ($1, $2, 'free', 0, 'pending', 'trial')
     on conflict (id) do nothing returning id`,
    [ownOrder, USER_A],
  );
  if (ins.rowCount) cleanupOrder.push(ownOrder);

  const ownPath = `subscription-screenshots/${ownOrder}/probe.jpg`;
  const { error: ownErr } = await a.storage.from("payment-qr")
    .upload(ownPath, Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==", "base64"),
    { contentType: "image/jpeg", upsert: false });
  chk("6 upload subshot for OWN order -> 200", !ownErr,
    ownErr ? ownErr.message.slice(0, 140) : "uploaded");
  if (!ownErr) uploads.push(ownPath);

  const foreignPath = `subscription-screenshots/${FOREIGN_ORDER}/probe.jpg`;
  const { error: forErr } = await a.storage.from("payment-qr")
    .upload(foreignPath, Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEDEQ/EB//Z", "base64"),
    { contentType: "image/jpeg", upsert: false });
  chk("6 upload subshot for SOMEONE ELSE's order -> 403", !!forErr,
    forErr ? `blocked: ${forErr.message.slice(0, 90)}` : "UPLOADED (not blocked)");
}

// ---------------------------------------------------------------------------
// 7. public object URLs still render (QR + avatar)
// ---------------------------------------------------------------------------
for (const path of [
  "payment-qr/badal-platform/qr-instagram.jpg",
  "avatars/68835025-5214-4ca1-be53-574b5f21632d/seed-avatar-12.jpg",
]) {
  const { data } = a.storage.from(path.split("/")[0]).getPublicUrl(path.split("/").slice(1).join("/"));
  try {
    const res = await fetch(data.publicUrl, { method: "GET" });
    chk(`7 public URL renders (${path.split("/")[0]})`, res.status === 200,
      `HTTP ${res.status}`);
  } catch (e) {
    chk(`7 public URL renders (${path.split("/")[0]})`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
// 8. signed-in non-admin can read active pricing plans
// ---------------------------------------------------------------------------
{
  const { data, error } = await a
    .from("pricing_plans")
    .select("id, name, price_egp, is_active")
    .eq("is_active", true);
  chk("8 authenticated non-admin reads active pricing plans",
    !error && Array.isArray(data) && data.length > 0,
    error ? error.message.slice(0, 100) : `${data?.length ?? 0} rows`);
}

// ---------------------------------------------------------------------------
// Cleanup: uploaded objects + fixture order (nothing else is ever written,
// because checks 1-3 are rolled back inside their transactions).
// ---------------------------------------------------------------------------
if (uploads.length) {
  const { error } = await a.storage.from("payment-qr").remove(uploads);
  console.log(`cleanup uploads: ${error ? "ERROR " + error.message : `removed ${uploads.length}`}`);
}
if (cleanupOrder.length) {
  const r = await db.query(
    `delete from public.subscription_orders where id = any($1::uuid[]) returning id`,
    [cleanupOrder],
  );
  console.log(`cleanup fixture orders: deleted ${r.rowCount}`);
}
await db.end();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
