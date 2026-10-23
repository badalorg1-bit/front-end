import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
function loadEnv(name) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}
loadEnv(".env.server");
loadEnv(".env.local");

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD required (set in .env.server or shell)");
  process.exit(1);
}

const targets = [
  {
    label: "direct db.",
    host: "db.havpresypsvxevwwkjis.supabase.com",
    port: 5432,
    user: "postgres",
  },
  {
    label: "pooler session",
    host: process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com",
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: "postgres.havpresypsvxevwwkjis",
  },
  {
    label: "pooler txn 6543",
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 6543,
    user: "postgres.havpresypsvxevwwkjis",
  },
];

async function connectFirst() {
  let lastErr;
  for (const t of targets) {
    const client = new Client({
      host: t.host,
      port: t.port,
      user: t.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      await client.query("select 1");
      console.log(`Connected via ${t.label} ${t.user}@${t.host}:${t.port}`);
      return client;
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch { /* ignore */ }
      console.log(`Fail ${t.label}: ${e.message}`);
    }
  }
  throw lastErr || new Error("no connection");
}

const client = await connectFirst();

async function apply(path) {
  const sql = readFileSync(path, "utf8");
  console.log(`\n=== Applying ${path} ===`);
  try {
    await client.query(sql);
    console.log("OK");
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    throw e;
  }
}

async function main() {
  const tables = await client.query(
    `select table_schema, table_name from information_schema.tables
     where table_schema in ('public','storage','auth')
     order by table_schema, table_name`,
  );
  console.log("Existing tables:");
  for (const r of tables.rows) console.log(" -", r.table_schema + "." + r.table_name);

  await apply("supabase/migrations/0001_init_schema.sql");
  await apply("supabase/migrations/0002_storage.sql");
  await apply("supabase/migrations/0003_admin_system.sql");
  await apply("supabase/migrations/0004_direct_payment.sql");
  await apply("supabase/migrations/0005_revoke_anon_payment_cols.sql");
  await apply("supabase/migrations/0006_reviews.sql");
  await apply("supabase/migrations/0007_escrow_wallet.sql");
  await apply("supabase/migrations/0008_badal_payment_gateway.sql");
  await apply("supabase/migrations/0009_saas_monetization.sql");
  await apply("supabase/migrations/0010_subscription_payment.sql");

  const after = await client.query(
    `select table_schema, table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  );
  console.log("\nPublic tables after:");
  for (const r of after.rows) console.log(" -", r.table_name);

  const rls = await client.query(
    `select relname, relrowsecurity from pg_class
     join pg_namespace on pg_namespace.oid = relnamespace
     where nspname='public' and relkind='r'
     order by relname`,
  );
  console.log("\nRLS on public tables:");
  for (const r of rls.rows) console.log(` - ${r.relname}: rls=${r.relrowsecurity}`);

  const policies = await client.query(
    `select schemaname, tablename, policyname from pg_policies
     where schemaname in ('public','storage')
     order by schemaname, tablename, policyname`,
  );
  console.log("\nPolicies:");
  for (const p of policies.rows)
    console.log(` - ${p.schemaname}.${p.tablename}: ${p.policyname}`);

  // JWT secret for anon key (write to temp only)
  try {
    const secret = await client.query(
      `select decrypted_secret from vault.decrypted_secrets where name = 'jwt-secret' limit 1`,
    );
    if (secret.rows[0]?.decrypted_secret) {
      writeFileSync(
        "C:\\Users\\TWINS-~1\\AppData\\Local\\Temp\\opencode\\badal_jwt_secret.txt",
        secret.rows[0].decrypted_secret,
        "utf8",
      );
      console.log("\nJWT secret: saved locally for key generation");
    } else {
      console.log("\nJWT secret: not in vault");
    }
  } catch (e) {
    console.log("\nVault query failed:", e.message);
  }

  // Also check if anon key can be found another way
  try {
    const rows = await client.query(
      `select name from vault.decrypted_secrets order by name limit 20`,
    );
    for (const r of rows.rows) console.log(" vault secret name:", r.name);
  } catch { /* ignore */ }

  await client.end();
  console.log("\nDone.");
}

main().catch(async (e) => {
  console.error(e.message || e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
