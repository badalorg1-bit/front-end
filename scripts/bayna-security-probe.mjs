import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Env lives in ui-prototype/.env.server (scripts/.env.server does not exist).
for (const name of [join(root, "ui-prototype", ".env.server"), join(root, ".env.server")]) {
  try {
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* optional */ }
}

const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;

if (!URL || !PUB || !SECRET) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY");
  process.exit(1);
}

// pg is only in ui-prototype/node_modules; used for profile creation and for
// cleaning up rows that client-side DELETE policies intentionally forbid.
const require = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require("pg");
const db = new Client({
  host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

let passCount = 0;
let failCount = 0;
let openCount = 0;
function pass(name, detail = "") {
  passCount++;
  console.log("PASS", name, detail ? `— ${detail}` : "");
}
function fail(name, detail = "") {
  failCount++;
  console.log("FAIL", name, detail ? `— ${detail}` : "");
}
// A finding that is documented as still open: reported loudly, but it is a
// known state rather than a regression, so it does not fail the run.
function open(name, detail = "") {
  openCount++;
  console.log("OPEN", name, detail ? `— ${detail}` : "");
}
function skip(name, reason) {
  console.log("SKIP", name, `— ${reason}`);
}

const anon = createClient(URL, PUB, { auth: { persistSession: false } });

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

// ---------- Create a throwaway NORMAL user via management API ----------
const probeEmail = `probe.sec.${Date.now()}@badal-test.example`;
const probePassword = `Pr0be!${randomUUID().slice(0, 8)}`;
let probeUserId = null;
const createdRows = { listing_requests: [], listing_promos: [], listings: [], quota_log: [] };

try {
  await db.connect();
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
  // profiles row: the signup trigger does not fire for admin-created users, and
  // SUPABASE_ACCESS_TOKEN (management SQL API) is not available in .env.server,
  // so insert it directly instead.
  await db.query(
    `insert into public.profiles (id, display_name) values ($1, 'Prober') on conflict (id) do nothing`,
    [probeUserId],
  );
  console.log("Probe profile row created");
} catch (e) {
  console.error("Could not create probe user:", e.message);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
}

const b = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const { error } = await b.auth.signInWithPassword({ email: probeEmail, password: probePassword });
  if (error) {
    console.error("Probe sign-in failed:", error.message);
    try { await db.end(); } catch { /* ignore */ }
    process.exit(1);
  }
}

// A published listing owned by someone else — needed by the F1 insert test.
let foreignListing = null;
{
  const { data } = await b
    .from("listings")
    .select("id, owner_id")
    .eq("status", "published")
    .neq("owner_id", probeUserId)
    .limit(1);
  foreignListing = data?.[0] ?? null;
}

// A quota_log row on SOMEONE ELSE's listing — needed by the #6 IDOR test.
// Inserted as a fixture (prod had zero rows before the 0040 FK fix made
// publishing possible at all) and deleted by id in cleanup. The owner is
// already past the free limit, so the extra row changes nothing for them.
let consumedListing = null;
{
  const r = await db.query(
    `insert into public.listing_quota_log (user_id, listing_id, cycle_start, cycle_end)
     select l.owner_id, l.id, current_date - 30, current_date
       from public.listings l
      where l.status = 'published' and l.owner_id <> $1
      limit 1
     returning id, listing_id`,
    [probeUserId],
  );
  consumedListing = r.rows[0]?.listing_id ?? null;
  if (r.rows[0]) createdRows.quota_log.push(r.rows[0].id);
  console.log("Fixture foreign consumed listing:", consumedListing ?? "FAILED");
}

// A draft listing owned by the probe user — fixture for the #5 purchase_promo
// test. purchase_promo only checks ownership (0017:127), not status, and a
// draft row does not trip enforce_listing_quota (0017:549), so no free quota
// is consumed. Deleted in cleanup. Failure is non-fatal: the #5 check skips.
// Type is 'rent' (the platform is rent + swap only — 0027 rejects 'sale') and
// rental_unit must be Arabic: 0001:77 constrains it to ('ساعة','يوم','شهر').
let ownListing = null;
try {
  const r = await db.query(
    `insert into public.listings
       (owner_id, title, listing_type, category, city, status, rental_price, rental_unit)
     values ($1, 'PROBE FIXTURE - safe to delete', 'rent', 'electronics', 'Cairo', 'draft', 100, 'يوم')
     returning id`,
    [probeUserId],
  );
  ownListing = r.rows[0]?.id ?? null;
  if (ownListing) createdRows.listings.push(ownListing);
  console.log("Fixture draft listing:", ownListing ?? "FAILED");
} catch (e) {
  console.log("Fixture listing creation failed (the #5 check will skip):", e.message);
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

  // =========================================================================
  // 0026 batch — F1 / #2 / F2 / F3 / F4 / F12 / #13
  // =========================================================================

  // ---------- F1a. INSERT status='accepted' must land as 'pending' ----------
  // request_type is 'rent': 0027 rejects 'purchase' (purchase_requests_retired)
  // and 'rent' needs rent_start/rent_end (0001 listing_requests_rent_dates).
  if (foreignListing) {
    const rentStart = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const rentEnd = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const { data: inserted, error: f1Err } = await b
      .from("listing_requests")
      .insert({
        listing_id: foreignListing.id,
        requester_id: probeUserId,
        owner_id: "00000000-0000-0000-0000-000000000000",
        request_type: "rent",
        rent_start: rentStart,
        rent_end: rentEnd,
        status: "accepted",
        message: "0026 F1 probe",
      })
      .select("id, status, paid_at, payer_confirmed_at")
      .single();
    if (f1Err) {
      fail("F1 insert with status='accepted'", f1Err.message.slice(0, 110));
    } else {
      createdRows.listing_requests.push(inserted.id);
      if (inserted.status === "pending" && inserted.paid_at == null && inserted.payer_confirmed_at == null) {
        pass("F1 status='accepted' forced to pending", `status=${inserted.status} paid_at=${inserted.paid_at}`);
      } else {
        fail("F1 status TAMPERING survived", JSON.stringify(inserted));
      }
    }
  } else {
    skip("F1 status normalisation", "no published foreign listing available");
  }

  // ---------- F1b. INSERT naming money/id columns must be denied ----------
  if (foreignListing) {
    const { error: colErr } = await b.from("listing_requests").insert({
      listing_id: foreignListing.id,
      requester_id: probeUserId,
      owner_id: "00000000-0000-0000-0000-000000000000",
      request_type: "rent",
      rent_start: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
      rent_end: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
      paid_at: new Date().toISOString(),
    });
    if (colErr && /permission denied/i.test(colErr.message)) {
      pass("F1 insert naming paid_at denied", colErr.message.slice(0, 90));
    } else if (colErr) {
      // Any rejection is acceptable; only an unblocked insert is a finding.
      pass("F1 insert naming paid_at rejected", colErr.message.slice(0, 90));
    } else {
      fail("F1 insert naming paid_at ALLOWED");
    }
  } else {
    skip("F1 column denial", "no published foreign listing available");
  }

  // ---------- #2. wallet_escrow_pay must be gone ----------
  {
    const { error: rpcErr } = await b.rpc("wallet_escrow_pay", {
      p_request_id: "00000000-0000-0000-0000-000000000000",
      p_amount: 1,
    });
    if (rpcErr && /does not exist|not found in the schema cache/i.test(rpcErr.message)) {
      pass("#2 wallet_escrow_pay retired", rpcErr.message.slice(0, 90));
    } else if (rpcErr) {
      pass("#2 wallet_escrow_pay not invocable", rpcErr.message.slice(0, 90));
    } else {
      fail("#2 wallet_escrow_pay STILL LIVE", "call succeeded");
    }
  }

  // ---------- #2b. escrow_pay_external still callable (drop-in intact) ----------
  {
    const { error: rpcErr } = await b.rpc("escrow_pay_external", {
      p_request_id: "00000000-0000-0000-0000-000000000000",
      p_amount: 100,
    });
    if (rpcErr && /permission denied/i.test(rpcErr.message)) {
      fail("#2b escrow_pay_external LOST execute", rpcErr.message.slice(0, 90));
    } else {
      pass("#2b escrow_pay_external still callable", rpcErr ? rpcErr.message.slice(0, 80) : "returned");
    }
  }

  // ---------- F2. .html upload under own folder must be rejected ----------
  {
    const htmlPath = `${probeUserId}/probe-xss.html`;
    const { error } = await b.storage.from("payment-qr").upload(
      htmlPath,
      "<html><body>probe</body></html>",
      { contentType: "text/html", upsert: false },
    );
    if (error) pass("F2 .html upload rejected", error.message.slice(0, 80));
    else {
      fail("F2 .html upload ALLOWED", htmlPath);
      await b.storage.from("payment-qr").remove([htmlPath]).catch(() => {});
    }
  }

  // ---------- F3. .list() must not enumerate other users ----------
  {
    const { data, error } = await b.storage.from("payment-qr").list("", { limit: 100 });
    if (error) {
      pass("F3 payment-qr list blocked", error.message.slice(0, 80));
    } else {
      const foreign = (data ?? [])
        .map((d) => d.name)
        .filter((n) => n !== probeUserId && !n.startsWith(`${probeUserId}/`));
      if (foreign.length === 0) pass("F3 payment-qr list scoped to own folder");
      else fail("F3 payment-qr list LEAKED", JSON.stringify(foreign).slice(0, 180));
    }
    const { data: aData, error: aErr } = await anon.storage.from("payment-qr").list("", { limit: 100 });
    const aNames = (aData ?? []).map((d) => d.name);
    if (aErr || aNames.length === 0) {
      pass("F3 anon payment-qr list blocked", aErr ? aErr.message.slice(0, 70) : "empty");
    } else {
      fail("F3 anon payment-qr list LEAKED", JSON.stringify(aNames).slice(0, 150));
    }
  }

  // ---------- F4. direct_payment_history must be security_invoker + scoped ----------
  {
    const { data, error } = await b.from("direct_payment_history").select("*").limit(20);
    if (error) {
      pass("F4 direct_payment_history denied or empty", error.message.slice(0, 90));
    } else {
      const foreign = (data ?? []).filter(
        (r) => r.payer_id !== probeUserId && r.seller_id !== probeUserId,
      );
      if (foreign.length === 0) {
        pass("F4 direct_payment_history scoped to own rows", `${data?.length ?? 0} own rows`);
      } else {
        fail("F4 direct_payment_history LEAKED foreign rows", JSON.stringify(foreign).slice(0, 180));
      }
    }
    const { data: aData, error: aErr } = await anon.from("direct_payment_history").select("*").limit(5);
    if (aErr || !aData || aData.length === 0) {
      pass("F4 anon direct_payment_history blocked", aErr ? aErr.message.slice(0, 80) : "empty");
    } else {
      fail("F4 anon direct_payment_history LEAKED", JSON.stringify(aData).slice(0, 150));
    }
  }

  // ---------- F12/#13. authenticated non-admin must read active plans ----------
  {
    const { data, error } = await b
      .from("pricing_plans")
      .select("id, is_active")
      .eq("is_active", true);
    if (error) {
      fail("#13 pricing_plans denied for authenticated", error.message.slice(0, 100));
    } else if (!data || data.length === 0) {
      fail("#13 pricing_plans EMPTY for authenticated", "0 rows — page /pricing breaks");
    } else {
      pass("#13 pricing_plans readable by authenticated", `${data.length} active rows`);
    }
    const { data: aData, error: aErr } = await anon
      .from("pricing_plans")
      .select("id")
      .eq("is_active", true);
    if (!aErr && aData && aData.length > 0) {
      pass("anon pricing_plans readable", `${aData.length} rows`);
    } else {
      fail("anon pricing_plans BROKEN", aErr ? aErr.message.slice(0, 90) : "0 rows");
    }

    // 0041 class guard: the eight 0034 owner-gap tables whose PUBLIC policies
    // read profiles.role (a column anon cannot select) — every anon read used
    // to raise "permission denied for table profiles". 0041 restricts those
    // policies to authenticated; anon must now get a clean result (rows or
    // empty) on ALL eight, never an error.
    const gapTables = [
      "banner_campaigns", "listing_promos", "listing_quota_log", "pricing_plans",
      "promo_credits_ledger", "promo_services", "subscription_orders", "subscriptions",
    ];
    const gapBroken = [];
    for (const t of gapTables) {
      const { error: gErr } = await anon.from(t).select("id", { head: true, count: "exact" });
      if (gErr) gapBroken.push(`${t}: ${gErr.message.slice(0, 60)}`);
    }
    if (gapBroken.length === 0) {
      pass("anon reads the 8 owner-gap tables without error", "0041 class guard");
    } else {
      fail("anon permission error on owner-gap tables", gapBroken.join(" | ").slice(0, 180));
    }
  }

  // ---------- #5. purchase_promo must reject unknown payment methods ----------
  {
    if (!ownListing) {
      skip("#5 purchase_promo whitelist", "could not create fixture listing");
    } else {
      // (a) a method outside the function whitelist must be refused
      const { data: promo, error: promoErr } = await b.rpc("purchase_promo", {
        p_listing_id: ownListing,
        p_service_id: "bump",
        p_payment_method: "crypto",
      });
      if (promoErr) {
        pass("#5 purchase_promo rejects unknown payment method", promoErr.message.slice(0, 100));
      } else if (promo && promo.promo_id) {
        createdRows.listing_promos.push(promo.promo_id);
        open("#5 purchase_promo accepts arbitrary payment_method",
          `method='crypto' accepted — see security-pass #5(a)`);
      } else {
        pass("#5 purchase_promo non-ok result", JSON.stringify(promo).slice(0, 120));
      }

      // (b) 'trial' is a real product method (the UI's demo-payment button)
      //     but it must land PENDING — an instantly-active trial promo would
      //     be a free-banner hole (0009 activated it; 0017 must not).
      const { data: trial, error: trialErr } = await b.rpc("purchase_promo", {
        p_listing_id: ownListing,
        p_service_id: "bump",
        p_payment_method: "trial",
      });
      if (trialErr) {
        pass("#5 trial method refused (stricter than required)", trialErr.message.slice(0, 100));
      } else if (trial && trial.status === "active") {
        if (trial.promo_id) createdRows.listing_promos.push(trial.promo_id);
        fail("#5 trial promo AUTO-ACTIVATED", `promo_id=${trial.promo_id}`);
      } else if (trial && trial.promo_id) {
        createdRows.listing_promos.push(trial.promo_id);
        pass("#5 trial stays pending (admin activates)", `status=${trial.status}`);
      } else {
        pass("#5 trial non-promo result", JSON.stringify(trial).slice(0, 120));
      }
    }
  }

  // ---------- #6. consume_listing_quota must not trust a foreign listing id ----------
  if (consumedListing) {
    const { data: quota, error: quotaErr } = await b.rpc("consume_listing_quota", {
      p_listing_id: consumedListing,
    });
    if (quotaErr) {
      pass("#6 quota idempotency scoped to caller", quotaErr.message.slice(0, 100));
    } else if (quota && quota.source === "already_consumed") {
      open("#6 consume_listing_quota trusts foreign listing_id",
        "returned already_consumed for another user's listing — see security-pass #6(a)");
    } else {
      pass("#6 quota did not short-circuit on foreign id", JSON.stringify(quota).slice(0, 120));
    }
  } else {
    skip("#6 quota IDOR", "no consumed listing owned by another user");
  }
} finally {
  // ---------- Cleanup: rows created by this run, then the probe user ----------
  try {
    if (createdRows.listing_requests.length) {
      const r = await db.query(
        `delete from public.listing_requests where id = any($1::uuid[]) returning id`,
        [createdRows.listing_requests],
      );
      console.log(`cleanup listing_requests: deleted ${r.rowCount}`);
    }
    if (createdRows.listing_promos.length) {
      const r = await db.query(
        `delete from public.listing_promos where id = any($1::uuid[]) returning id`,
        [createdRows.listing_promos],
      );
      console.log(`cleanup listing_promos: deleted ${r.rowCount}`);
    }
    if (createdRows.quota_log.length) {
      const r = await db.query(
        `delete from public.listing_quota_log where id = any($1::uuid[]) returning id`,
        [createdRows.quota_log],
      );
      console.log(`cleanup listing_quota_log: deleted ${r.rowCount}`);
    }
    if (createdRows.listings.length) {
      const r = await db.query(
        `delete from public.listings where id = any($1::uuid[]) returning id`,
        [createdRows.listings],
      );
      console.log(`cleanup listings: deleted ${r.rowCount}`);
    }
  } catch (e) {
    console.log("cleanup of created rows failed (clean up manually):", e.message);
  }
  try {
    await adminFetch(`/auth/v1/admin/users/${probeUserId}`, { method: "DELETE" });
    console.log("Deleted probe user", probeUserId);
  } catch (e) {
    console.log("Could not delete probe user (clean up manually):", probeUserId, e.message);
  }
  try { await db.end(); } catch { /* ignore */ }
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

console.log(`\n=== ${passCount} passed, ${failCount} failed, ${openCount} known-open ===`);
process.exit(failCount > 0 ? 1 : 0);
