import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.server", ".env.local"]) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;

let pass = 0, fail = 0;
function ok(n, d = "") { pass++; console.log("PASS", n, d ? `— ${d}` : ""); }
function no(n, d = "") { fail++; console.log("FAIL", n, d ? `— ${d}` : ""); }

const anon = createClient(URL, PUB, { auth: { persistSession: false } });

// 1) Public browse: listings readable by anon
{
  const { data, error } = await anon.from("listings").select("id,title,status,listing_type").limit(5);
  if (error) no("anon browse listings", error.message);
  else if (data) ok("anon browse listings", `${data.length} rows`);
}

// 2) Payment settings / fee: authenticated-only after 0017 (login pages only)
//    Anon is expected to get permission denied.
{
  const { error } = await anon.rpc("get_badal_payment_settings");
  if (error && /permission denied/i.test(error.message)) ok("get_badal_payment_settings not anon-callable");
  else if (!error) no("get_badal_payment_settings open to anon", JSON.stringify(error));
  else no("get_badal_payment_settings unexpected", error.message);
}
{
  const { error } = await anon.rpc("get_escrow_fee_percent");
  if (error && /permission denied/i.test(error.message)) ok("get_escrow_fee_percent not anon-callable");
  else if (!error) no("get_escrow_fee_percent open to anon");
  else no("get_escrow_fee_percent unexpected", error.message);
}

// 4) notify_user should fail for anon
{
  const { error } = await anon.rpc("notify_user", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_title: "x",
    p_body: "x",
    p_kind: "system",
    p_listing_id: null,
  });
  if (error) ok("notify_user blocked for anon", error.message.slice(0, 80));
  else no("notify_user succeeded for anon");
}

// 5) escrow_pay_external should fail for anon (auth required)
{
  const { error } = await anon.rpc("escrow_pay_external", {
    p_request_id: "00000000-0000-0000-0000-000000000001",
    p_amount: 100,
    p_method: "wallet_qr",
  });
  if (error) ok("escrow_pay_external blocked for anon", error.message.slice(0, 80));
  else no("escrow_pay_external succeeded for anon");
}

// 6) admin_confirm blocked for anon
{
  const { error } = await anon.rpc("admin_confirm_external_payment", {
    p_request_id: "00000000-0000-0000-0000-000000000001",
  });
  if (error) ok("admin_confirm blocked for anon", error.message.slice(0, 80));
  else no("admin_confirm succeeded for anon");
}

// 7) Profiles private columns not readable via select *
{
  const { data, error } = await anon.from("profiles").select("*").limit(3);
  if (error) ok("anon profiles query limited", error.message.slice(0, 80));
  else if (data && data.length === 0) ok("anon profiles empty (RLS)");
  else if (data) {
    const keys = Object.keys(data[0] || {});
    const sensitive = keys.filter(k => /role|is_banned|payment_note|wallet_name|instagram|whatsapp|payment_qr/i.test(k));
    if (!sensitive.length) ok("anon profiles has no sensitive columns", keys.join(","));
    else no("anon profiles leaked columns", sensitive.join(","));
  }
}

// 8) Wallet/escrow tables: empty for anon (RLS) — no error and no rows
{
  const { data, error } = await anon.from("wallet_balances").select("user_id,balance").limit(1);
  if (!error && (!data || data.length === 0)) ok("anon wallet_balances empty (RLS)");
  else if (error) ok("anon wallet_balances blocked", error.message.slice(0, 80));
  else no("anon could read wallet_balances rows", String(data?.length));
}

{
  const { data, error } = await anon.from("escrow_holds").select("id").limit(1);
  if (!error && (!data || data.length === 0)) ok("anon escrow_holds empty (RLS)");
  else if (error) ok("anon escrow_holds blocked", error.message.slice(0, 80));
  else no("anon could read escrow_holds rows", String(data?.length));
}

// 9) Reviews readable (public product reviews)
{
  const { data, error } = await anon.from("reviews").select("id,rating").limit(3);
  if (error) no("anon reviews", error.message);
  else ok("anon reviews readable", `${data?.length ?? 0} rows`);
}

// 10) Platform settings: not directly readable (definer RPC only)
{
  const { data, error } = await anon.from("platform_settings").select("id,escrow_fee_percent,badal_wallet_name").limit(1);
  if (error) ok("platform_settings not anon-selectable", error.message.slice(0, 80));
  else if (!data?.length) ok("platform_settings empty for anon");
  else no("anon could read platform_settings", JSON.stringify(data[0]));
}

console.log(`\nE2E pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);

