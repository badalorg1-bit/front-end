import { readFileSync } from "node:fs";
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

const password = process.env.SUPABASE_DB_PASSWORD;
const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  const listings = await client.query(
    `SELECT l.id, l.title, l.listing_type, l.status, li.storage_path
     FROM listings l
     LEFT JOIN listing_images li ON li.listing_id = l.id AND li.is_primary = true
     WHERE l.status = 'published'
     ORDER BY l.created_at`
  );
  console.log(JSON.stringify(listings.rows, null, 2));
  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
