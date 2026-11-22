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
console.log("Connected to production pooler");

const sql = readFileSync("B:/badal/supabase/migrations/0043_admin_rpc_hardening.sql", "utf8");
console.log("\n=== Applying 0043_admin_rpc_hardening.sql ===");
try {
  await client.query(sql);
  console.log("OK — migration applied");
} catch (e) {
  console.error("FAILED:", e.message);
  throw e;
}

await client.end();
console.log("Done.");