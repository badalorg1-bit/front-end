import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("B:/badal/ui-prototype/package.json");
const { Client } = require("pg");

const env = {};
for (const line of readFileSync("B:/badal/ui-prototype/.env.server", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.SUPABASE_DB_PASSWORD) {
  console.error("SUPABASE_DB_PASSWORD missing in .env.server");
  process.exit(1);
}

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com", port: 5432,
  user: "postgres.havpresypsvxevwwkjis", password: env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});

await client.connect();
console.log("Connected to production pooler — verifying 0043\n");

let allOk = true;
function check(label, ok, detail = "") {
  if (!ok) allOk = false;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// --- #10: FOR UPDATE present, body otherwise intact ---
const fn10 = await client.query(
  `select pg_get_functiondef(oid) x from pg_proc where proname='admin_review_subscription_order' and pronamespace='public'::regnamespace`
);
const d10 = fn10.rows[0]?.x || "";
check("#10 FOR UPDATE on subscription_orders SELECT",
  /select \* into v_order from public\.subscription_orders where id = p_order_id for update;/.test(d10));
check("#10 keeps paid/failed statuses", d10.includes("p_status not in ('paid', 'failed')"));
check("#10 keeps subscriptions insert (promo_credits_remaining)", d10.includes("promo_credits_remaining"));
check("#10 keeps promo_credits_ledger insert (subscription_id, delta)", d10.includes("subscription_id, delta"));
check("#10 keeps order_already_reviewed guard", d10.includes("order_already_reviewed"));

// --- #11: admin gate, signature unchanged ---
const fn11 = await client.query(
  `select pg_get_functiondef(oid) x, pg_get_function_identity_arguments(oid) a
   from pg_proc where proname='admin_confirm_external_payment' and pronamespace='public'::regnamespace`
);
const d11 = fn11.rows[0]?.x || "";
check("#11 gate is has_min_role('admin')", d11.includes("has_min_role('admin')"));
check("#11 moderator gate removed", !d11.includes("has_min_role('moderator')"));
check("#11 signature still (p_request_id uuid)", fn11.rows[0]?.a === "p_request_id uuid",
  fn11.rows[0]?.a);
check("#11 keeps FOR UPDATE on hold SELECT", d11.includes("where request_id = p_request_id for update"));
check("#11 keeps pending_confirmation status check", d11.includes("pending_confirmation"));
check("#11 keeps handover code minting", d11.includes("booking_handover_codes"));
check("#11 keeps audit log", d11.includes("confirm_external_payment"));

// --- #12: verify 0039 revokes hold (no SQL needed) ---
const p12 = await client.query(
  `select proname,
     has_function_privilege('public', oid, 'EXECUTE') pub,
     has_function_privilege('anon', oid, 'EXECUTE') anon,
     has_function_privilege('authenticated', oid, 'EXECUTE') authd
   from pg_proc where pronamespace='public'::regnamespace
     and (proname = 'get_my_payment_profile' or proname like 'admin_%')
   order by proname`
);
const bad12 = p12.rows.filter(r => r.pub || r.anon);
check("#12 get_my_payment_profile + all admin_* closed to public/anon",
  p12.rows.length >= 28 && bad12.length === 0,
  `${p12.rows.length} fns checked, ${bad12.length} still open${bad12.length ? ": " + bad12.map(b => b.proname).join(",") : ""}`);
const g12 = p12.rows.find(r => r.proname === "get_my_payment_profile");
check("#12 get_my_payment_profile callable by authenticated", g12?.authd === true);

console.log(allOk ? "\n=== 0043 VERIFY: ALL PASS ===" : "\n=== 0043 VERIFY: FAILURES ABOVE ===");
await client.end();
process.exit(allOk ? 0 : 1);
