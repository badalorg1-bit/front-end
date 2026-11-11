import { Client } from "pg";

const c = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await c.connect();
  const cols = await c.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='listing_requests' order by ordinal_position",
  );
  console.log("cols", cols.rows.map((r) => r.column_name));
  const r = await c.query(
    "select * from public.listing_requests order by created_at desc limit 5",
  );
  console.log("requests", JSON.stringify(r.rows, null, 2));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
