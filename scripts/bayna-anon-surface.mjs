// Read-only: enumerate every public function executable by anon (launch-gap scan).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "ui-prototype", "package.json"));
const { Client } = require("pg");

const env = {};
for (const line of readFileSync(join(root, "ui-prototype", ".env.server"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

try {
  await client.connect();
  const r = await client.query(
    `select p.proname,
            pg_get_function_identity_arguments(p.oid) as ident,
            p.prosecdef as definer,
            has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
            has_function_privilege('public', p.oid, 'execute') as pub_ok
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('anon', p.oid, 'execute')
      order by p.proname`,
  );
  console.log("ANON-EXECUTABLE COUNT:", r.rows.length);
  for (const row of r.rows) {
    console.log(
      `${row.definer ? "DEFINER" : "      "} ${row.pub_ok ? "PUBLIC " : "direct "} ${row.auth_ok ? "auth+" : "      "} ${row.proname}(${row.ident})`,
    );
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
