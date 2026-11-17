// Read-only launch-readiness check for production (no writes).
// Prints: data presence, platform settings (no secrets), and admin UI surface.
// Usage: node scripts/bayna-launch-check.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require("pg");

function readEnv() {
  const out = {};
  for (const line of readFileSync(join(root, "ui-prototype", ".env.server"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const password = readEnv().SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD missing");
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

// Live site = GitHub Pages (auto-deployed by .github/workflows/pages.yml on push to main).
// Railway trial expired (2026-11); its URL stays dead until a paid plan exists.
const SITE = "https://badalorg1-bit.github.io/front-end";

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

async function dataPresence() {
  console.log("\n== DATA (read-only counts) ==");
  const q = async (label, sql) => {
    const r = await one(sql);
    console.log(`  ${label}: ${r.n}`);
    return Number(r.n);
  };
  const counts = {};
  counts.listings = await q("listings", "select count(*)::int n from public.listings");
  counts.users = await q("profiles (users)", "select count(*)::int n from public.profiles");
  counts.requests = await q("listing_requests", "select count(*)::int n from public.listing_requests");
  counts.reviews = await q("reviews", "select count(*)::int n from public.reviews");
  counts.pricing_plans = await q("pricing_plans", "select count(*)::int n from public.pricing_plans");
  counts.promo_services = await q("promo_services", "select count(*)::int n from public.promo_services");
  counts.banner_campaigns = await q("banner_campaigns", "select count(*)::int n from public.banner_campaigns");
  counts.wallet_topups = await q("wallet_topups", "select count(*)::int n from public.wallet_topups");
  counts.escrow_holds = await q("escrow_holds", "select count(*)::int n from public.escrow_holds");
  counts.admin_audit_log = await q("admin_audit_log", "select count(*)::int n from public.admin_audit_log");
  return counts;
}

async function platformSettings() {
  console.log("\n== PLATFORM SETTINGS (business config, no secrets) ==");
  const p = await one(
    `select badal_wallet_name,
            (badal_wallet_qr_path is not null) as has_wallet_qr,
            badal_instagram,
            escrow_fee_percent,
            point_value_egp,
            free_listings_per_cycle,
            free_cycle_days,
            per_listing_price_egp,
            per_listing_days
       from public.platform_settings where id = 1`,
  );
  console.log(`  wallet name:      ${p.badal_wallet_name ?? "(not set)"}`);
  console.log(`  wallet QR image:  ${p.has_wallet_qr ? "uploaded" : "MISSING (admin should upload)"}`);
  console.log(`  instagram:        ${p.badal_instagram ?? "(not set)"}`);
  console.log(`  escrow fee %:     ${p.escrow_fee_percent}`);
  console.log(`  point value EGP:  ${p.point_value_egp}`);
  console.log(`  free listings:    ${p.free_listings_per_cycle} per ${p.free_cycle_days}d`);
  console.log(`  per-listing:      ${p.per_listing_price_egp} EGP / ${p.per_listing_days}d`);
  return p;
}

async function adminSurface() {
  console.log("\n== ADMIN RPC SURFACE ==");
  // same approach as bayna-apply-0036-0038's fnPriv (signature as text)
  const check = async (fnSig) => {
    const r = await one("select has_function_privilege($1, $2, 'execute') as b", ["authenticated", `public.${fnSig}`]);
    const a = await one("select has_function_privilege($1, $2, 'execute') as b", ["anon", `public.${fnSig}`]);
    return { ok: r?.b === true, anonLeak: a?.b === true };
  };
  const fns = [
    ["admin_get_financial_stats(timestamptz, timestamptz)", 2],
    ["wallet_escrow_refund(uuid)", 1],
    ["admin_review_subscription_order(uuid, text, text)", 3],
    ["admin_review_banner(uuid, text, numeric, text)", 4],
    ["admin_update_plan(text,text,text,numeric,int,int,boolean)", 7],
    ["admin_update_promo_service(text,text,text,numeric,int,int,boolean)", 7],
    ["admin_update_saas_settings(int,int,numeric,int)", 4],
  ];
  for (const [sig, nargs] of fns) {
    const { ok, anonLeak } = await check(sig).catch(() => ({ ok: false, anonLeak: false }));
    if (!ok) console.log(`  ✗ not granted to authenticated: ${sig}`);
    else if (anonLeak) console.log(`  ✗ leaked to anon: ${sig}`);
    else console.log(`  ✓ ${sig} (${nargs} args) — granted, anon denied`);
  }
}

async function httpChecks() {
  console.log("\n== SITE HTTP (live) ==");
  const paths = ["/", "/pricing", "/subscribe/basic", "/admin", "/search"];
  for (const p of paths) {
    try {
      const res = await fetch(SITE + p, { redirect: "manual" });
      const body = await res.text();
      const isSpa = body.includes('<div id="root">') || body.includes("بينا");
      // GitHub Pages answers deep links with the custom 404.html (SPA shell) + HTTP 404
      const ok = res.status === 200 || (res.status === 404 && isSpa);
      console.log(`  ${ok ? "✓" : "✗"} ${res.status} ${p} ${isSpa ? "(SPA shell)" : "(?)"}`);
    } catch (e) {
      console.log(`  ERR ${p}: ${e.message}`);
    }
  }
  // served bundle must exist and load
  try {
    const res = await fetch(SITE + "/");
    const html = await res.text();
    const m = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html);
    const served = m ? m[0] : "?";
    console.log(`  served bundle: ${served}`);
    const asset = await fetch(`${SITE}/${served}`, { method: "HEAD" });
    console.log(`  bundle asset:   ${asset.status} ${asset.ok ? "✓" : "✗"}`);
  } catch {
    /* ignore */
  }
  // freshness: last successful Pages deploy vs current main on GitHub (read-only API).
  // (Comparing against a local dist build would be meaningless: CI builds with
  // VITE_BASE_PATH=/front-end/ and repo vars, local dist uses base /.)
  try {
    const headers = { accept: "application/vnd.github+json", "user-agent": "bayna-launch-check" };
    const runs = await (
      await fetch("https://api.github.com/repos/badalorg1-bit/front-end/actions/workflows/pages.yml/runs?status=success&per_page=1", { headers })
    ).json();
    const main = await (await fetch("https://api.github.com/repos/badalorg1-bit/front-end/commits/main", { headers })).json();
    const deployed = runs?.workflow_runs?.[0]?.head_sha;
    const pushed = main?.sha;
    if (deployed && pushed) {
      console.log(`  deployed commit: ${deployed.slice(0, 7)} (latest successful Pages run)`);
      console.log(`  main on GitHub:   ${pushed.slice(0, 7)}`);
      console.log(`  ${deployed === pushed ? "✓ live site == latest pushed main" : "✗ deploy behind main (Pages run pending/failed)"}`);
    }
  } catch {
    /* ignore */
  }
}

try {
  await client.connect();
  await dataPresence();
  await platformSettings();
  await adminSurface();
  await httpChecks();
  console.log("\nDONE (read-only).");
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
