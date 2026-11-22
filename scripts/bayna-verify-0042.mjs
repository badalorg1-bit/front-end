import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("B:/badal/ui-prototype/package.json");
const { Client } = require("pg");

const env = {};
for (const line of readFileSync("B:/badal/ui-prototype/.env.server", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com", port: 5432,
  user: "postgres.havpresypsvxevwwkjis", password: env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});
await client.connect();

console.log("=== Verifying 0042 changes ===");

// 1. create_wallet_topup: check rate limit logic present
const cwt = await client.query(`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'create_wallet_topup' AND pronamespace = 'public'::regnamespace;`);
const cwtDef = cwt.rows[0]?.pg_get_functiondef || '';
console.log("create_wallet_topup:");
console.log("  has rate_limited check:", cwtDef.includes("rate_limited"));
console.log("  has 1-minute window:", cwtDef.includes("interval '1 minute'"));
console.log("  has pg_advisory_xact_lock:", cwtDef.includes("pg_advisory_xact_lock"));
console.log("  has pending_topup_exists:", cwtDef.includes("pending_topup_exists"));

// 2. admin_review_wallet_topup: check ledger kind='topup'
const arwt = await client.query(`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'admin_review_wallet_topup' AND pronamespace = 'public'::regnamespace;`);
const arwtDef = arwt.rows[0]?.pg_get_functiondef || '';
console.log("\nadmin_review_wallet_topup:");
console.log("  has wallet_transactions insert:", arwtDef.includes("wallet_transactions"));
console.log("  has kind='topup':", arwtDef.includes("'topup'"));
console.log("  has payment_method in note:", arwtDef.includes("payment_method"));

// 3. wallet_escrow_release: check net_amount in escrow_release row + fee row with 0 amount
const wer = await client.query(`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'wallet_escrow_release' AND pronamespace = 'public'::regnamespace;`);
const werDef = wer.rows[0]?.pg_get_functiondef || '';
console.log("\nwallet_escrow_release:");
console.log("  first insert uses net_amount:", werDef.includes("v_hold.net_amount") && werDef.includes("'escrow_release'"));
console.log("  second insert is fee with amount 0:", werDef.includes("0, 'fee'") || werDef.includes("0, 'fee'"));
console.log("  note mentions 'صافي بعد العمولة':", werDef.includes("صافي بعد العمولة"));

// 4. Revokes
const rev = await client.query(`
  SELECT routine_name
  FROM information_schema.routines
  WHERE routine_schema='public' AND routine_type='FUNCTION'
  AND routine_name IN ('create_wallet_topup','admin_review_wallet_topup','wallet_escrow_release')
  AND EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE grantee='public' AND specific_schema='public'
    AND specific_name = routines.routine_name
  )
`);
console.log("\nFunctions still GRANTED to public:", rev.rows.length === 0 ? "NONE ✅" : rev.rows.map(r => r.routine_name).join(", "));

await client.end();
console.log("\n=== Verification complete ===");