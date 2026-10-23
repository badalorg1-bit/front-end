import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
const SECRET = process.env.SUPABASE_SECRET_KEY;

if (!URL || !PUB || !SECRET) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY");
  process.exit(1);
}

let passCount = 0;
let failCount = 0;
function pass(name, detail = "") {
  passCount++;
  console.log("PASS", name, detail ? `— ${detail}` : "");
}
function fail(name, detail = "") {
  failCount++;
  console.log("FAIL", name, detail ? `— ${detail}` : "");
}

const anon = createClient(URL, PUB, { auth: { persistSession: false } });

// ---------- Create a throwaway NORMAL user via management API ----------
const probeEmail = `probe.sec.${Date.now()}@badal-test.example`;
const probePassword = `Pr0be!${randomUUID().slice(0, 8)}`;
let probeUserId = null;

async function adminFetch(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
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

try {
  const created = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: probeEmail,
      password: probePassword,
      email_confirm: true,
      user_metadata: { display_name: "Prober" },
    }),
  });
  probeUserId = created.id;
  console.log("Created probe user:", probeEmail, probeUserId);
  // Create the profiles row via management SQL (signup trigger does not fire for admin-created users).
  const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!mgmtToken) throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.server");
  const qres = await fetch(`https://api.supabase.com/v1/projects/havpresypsvxevwwkjis/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmtToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `insert into public.profiles (id, display_name) values ('${probeUserId}', 'Prober') on conflict (id) do nothing returning id`,
    }),
  });
  if (!qres.ok) throw new Error(`profile insert: ${qres.status} ${(await qres.text()).slice(0, 200)}`);
  console.log("Probe profile row created");
} catch (e) {
  console.error("Could not create probe user:", e.message);
  process.exit(1);
}

const b = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const { error } = await b.auth.signInWithPassword({ email: probeEmail, password: probePassword });
  if (error) {
    console.error("Probe sign-in failed:", error.message);
    process.exit(1);
  }
}

try {
  // ---------- 1. Role escalation: normal user tries to update own role ----------
  const { error } = await b.from("profiles").update({ role: "super_admin" }).eq("id", probeUserId);
  const { data: row } = await b.from("profiles").select("role").eq("id", probeUserId).single();
  if (error || row?.role !== "super_admin") {
    pass("role escalation blocked", error ? `error: ${error.message.slice(0, 80)}` : `role=${row?.role}`);
  } else {
    fail("role escalation ALLOWED", `role became ${row?.role}`);
  }

  // ---------- 2. QR path ownership: foreign folder must be rejected ----------
  // Direct column select of payment_qr_path is denied (0012), so read back
  // through the SECURITY DEFINER RPC the app itself uses.
  const readQr = async () => {
    const { data, error } = await b.rpc("get_my_payment_profile");
    if (error) throw new Error(`get_my_payment_profile failed: ${error.message}`);
    return data?.[0]?.payment_qr_path ?? null;
  };
  const foreignPath = `acbc512c-8c32-41ab-985c-9254eb2d7907/qr-evil.jpg`;
  const { error: qrErr } = await b
    .from("profiles")
    .update({ payment_qr_path: foreignPath })
    .eq("id", probeUserId);
  const storedForeign = await readQr();
  if (storedForeign === foreignPath) {
    fail("foreign QR path ACCEPTED", `err=${qrErr?.message ?? "none"}`);
  } else {
    pass("foreign QR path rejected", qrErr ? qrErr.message.slice(0, 100) : `stored=${storedForeign}`);
  }

  // ---------- 3. Own-folder QR path should be accepted ----------
  const ownPath = `${probeUserId}/qr-ok.jpg`;
  const { error: ownQrErr } = await b
    .from("profiles")
    .update({ payment_qr_path: ownPath })
    .eq("id", probeUserId);
  const storedOwn = await readQr();
  if (!ownQrErr && storedOwn === ownPath) {
    pass("own-folder QR path accepted");
  } else {
    fail("own-folder QR path rejected", ownQrErr?.message ?? `stored=${storedOwn}`);
  }

  // ---------- 4. wallet balance IDOR ----------
  const { data: bal, error: balErr } = await b.rpc("get_wallet_balance", {
    p_user_id: "acbc512c-8c32-41ab-985c-9254eb2d7907",
  });
  const { data: ownBal } = await b.rpc("get_wallet_balance");
  if (balErr) {
    pass("get_wallet_balance IDOR blocked (error)", balErr.message.slice(0, 100));
  } else if (Number(bal) === Number(ownBal)) {
    pass("get_wallet_balance ignores foreign user_id", `returns own=${bal}`);
  } else {
    fail("get_wallet_balance leaked foreign balance", `foreign=${bal} own=${ownBal}`);
  }

  // ---------- 5. platform_settings direct read blocked ----------
  const { data: ps, error: psErr } = await b.from("platform_settings").select("*").limit(5);
  if (psErr || !ps || ps.length === 0) {
    pass("platform_settings not readable by authenticated", psErr ? psErr.message.slice(0, 80) : "empty");
  } else {
    fail("platform_settings LEAKED", JSON.stringify(ps).slice(0, 200));
  }

  // ---------- 6. trial plan purchase should NOT auto-activate ----------
  const { data: plans } = await b
    .from("pricing_plans")
    .select("id, name, price_egp, is_active")
    .eq("is_active", true)
    .limit(20);
  const paidPlan = (plans ?? []).find((p) => Number(p.price_egp) > 0);
  if (paidPlan) {
    const { data: order, error: ordErr } = await b.rpc("purchase_plan", {
      p_plan_id: paidPlan.id,
      p_payment_method: "trial",
    });
    if (ordErr) {
      pass("purchase_plan(trial) rejected", ordErr.message.slice(0, 100));
    } else if (order?.status === "pending" || order?.status === "awaiting_payment") {
      pass("purchase_plan(trial) creates pending", `status=${order.status}`);
    } else if (order?.status === "active" || order?.status === "paid") {
      fail("purchase_plan(trial) AUTO-ACTIVATED", `status=${order.status}`);
    } else {
      pass("purchase_plan(trial) non-active result", JSON.stringify(order).slice(0, 150));
    }
  } else {
    console.log("SKIP trial auto-activation (no paid plan found)");
  }

  // ---------- 7. Admin RPCs rejected for non-admin ----------
  for (const [rpcName, args] of [
    ["admin_review_wallet_topup", { p_topup_id: "00000000-0000-0000-0000-000000000000", p_status: "approved", p_notes: "" }],
    ["admin_update_saas_settings", { p_key: "free_listings_per_cycle", p_value: "9999" }],
    ["admin_review_banner", { p_banner_id: "00000000-0000-0000-0000-000000000000", p_status: "approved", p_price: 0, p_notes: "" }],
    ["admin_review_subscription_order", { p_order_id: "00000000-0000-0000-0000-000000000000", p_status: "paid", p_notes: "" }],
  ]) {
    const { error: rpcErr } = await b.rpc(rpcName, args);
    if (rpcErr) {
      pass(`${rpcName} blocked for non-admin`, rpcErr.message.slice(0, 80));
    } else {
      fail(`${rpcName} ALLOWED for non-admin`);
    }
  }

  // ---------- 8. Top-up: create, then self-approve must fail ----------
  const { data: tu, error: tuErr } = await b.rpc("create_wallet_topup", {
    p_amount_egp: 10,
    p_payment_method: "wallet_qr",
  });
  if (tuErr) {
    pass("create_wallet_topup errors cleanly", tuErr.message.slice(0, 100));
  } else {
    pass("create_wallet_topup succeeded", `id=${tu?.topup_id}`);
    const { error: selfAppErr } = await b.rpc("admin_review_wallet_topup", {
      p_topup_id: tu.topup_id,
      p_status: "approved",
      p_notes: "self-approve hack",
    });
    if (selfAppErr) {
      pass("self-approval of topup blocked", selfAppErr.message.slice(0, 80));
    } else {
      fail("self-approval of topup ALLOWED");
    }
    const { error: directErr } = await b
      .from("wallet_topups")
      .update({ status: "approved" })
      .eq("id", tu.topup_id);
    const { data: after } = await b
      .from("wallet_topups")
      .select("status")
      .eq("id", tu.topup_id)
      .maybeSingle();
    if (directErr || after?.status !== "approved") {
      pass("direct wallet_topups update blocked", directErr ? directErr.message.slice(0, 80) : `status=${after?.status}`);
    } else {
      fail("direct wallet_topups update ALLOWED", "status=approved");
    }
  }

  // ---------- 9. Anon cannot read others' wallet_topups ----------
  const { data: anonTu, error: anonTuErr } = await anon
    .from("wallet_topups")
    .select("id")
    .limit(5);
  if (anonTuErr || !anonTu || anonTu.length === 0) {
    pass("anon wallet_topups blocked", anonTuErr ? anonTuErr.message.slice(0, 80) : "empty");
  } else {
    fail("anon wallet_topups LEAKED", JSON.stringify(anonTu).slice(0, 100));
  }
} finally {
  // ---------- Cleanup: delete the probe user ----------
  try {
    await adminFetch(`/auth/v1/admin/users/${probeUserId}`, { method: "DELETE" });
    console.log("Deleted probe user", probeUserId);
  } catch (e) {
    console.log("Could not delete probe user (clean up manually):", probeUserId, e.message);
  }
}

// ---------- 10. Anon blocks ----------
{
  for (const [rpcName, args] of [
    ["admin_review_wallet_topup", { p_topup_id: "00000000-0000-0000-0000-000000000000", p_status: "approved", p_notes: "" }],
    ["has_min_role", { p_min_role: "super_admin" }],
  ]) {
    const { error: rpcErr } = await anon.rpc(rpcName, args);
    if (rpcErr) {
      pass(`anon ${rpcName} blocked`, rpcErr.message.slice(0, 80));
    } else {
      fail(`anon ${rpcName} ALLOWED`);
    }
  }
  const { data: ps, error: psErr } = await anon.from("platform_settings").select("*").limit(1);
  if (psErr || !ps || ps.length === 0) {
    pass("anon platform_settings blocked", psErr ? psErr.message.slice(0, 80) : "empty");
  } else {
    fail("anon platform_settings LEAKED");
  }
  const { error: insErr } = await anon.from("profiles").insert({
    id: "00000000-0000-0000-0000-000000000099",
    display_name: "HACKER",
    role: "super_admin",
  });
  if (insErr) {
    pass("anon profiles insert blocked", insErr.message.slice(0, 80));
  } else {
    fail("anon profiles insert ALLOWED");
  }
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
process.exit(failCount > 0 ? 1 : 0);
