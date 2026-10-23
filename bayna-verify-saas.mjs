import { Client } from "pg";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.server", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const c = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 12000,
});
await c.connect();

const t = await c.query(`
  select table_name from information_schema.tables
  where table_schema='public' and table_name in
  ('pricing_plans','subscriptions','subscription_orders','promo_services',
   'listing_promos','promo_credits_ledger','banner_campaigns','listing_quota_log')
  order by table_name`);
console.log("New tables:", t.rows.map((r) => r.table_name).join(", "));

const p = await c.query("select id,name,price_egp,listing_quota,promo_credits from pricing_plans order by sort_order");
console.log("Plans:", JSON.stringify(p.rows, null, 1));

const s = await c.query("select id,name,price_egp,promo_credits_cost,duration_days from promo_services order by price_egp");
console.log("Promo services:", JSON.stringify(s.rows, null, 1));

const fns = await c.query(`
  select proname from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname in
  ('consume_listing_quota','get_merchant_account','purchase_plan','purchase_promo',
   'admin_update_plan','admin_update_promo_service','admin_update_saas_settings','admin_review_banner')
  order by proname`);
console.log("RPCs:", fns.rows.map((r) => r.proname).join(", "));

await c.end();
