import { Client } from "pg";

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

const qs = [
  "select * from auth.instances limit 5",
  `select column_name from information_schema.columns
   where table_schema='auth' and table_name='instances'`,
  `select table_schema, table_name from information_schema.tables
   where table_schema not in ('pg_catalog','information_schema')
     and (table_name ilike '%secret%' or table_name ilike '%key%' or table_name ilike '%jwt%')`,
  `select name from vault.decrypted_secrets limit 50`,
  `select id, name from storage.buckets`,
];

(async () => {
  await client.connect();
  for (const q of qs) {
    try {
      const r = await client.query(q);
      console.log("Q:", q.slice(0, 80).replace(/\s+/g, " "));
      console.log(JSON.stringify(r.rows, null, 2).slice(0, 3000));
      console.log("---");
    } catch (e) {
      console.log("fail", e.message.slice(0, 120));
      console.log("---");
    }
  }
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
