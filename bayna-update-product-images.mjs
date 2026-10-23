import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const password = process.env.SUPABASE_DB_PASSWORD;

// Free stock images (Unsplash CDN — direct file URLs, no key needed)
// Each listing id → a relevant, high-quality Unsplash photo
const IMAGES = {
  // Sony A7 IV camera
  "056032ec-4e2c-4d4c-96fa-7663ba65e495":
    "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=1200&q=80&auto=format&fit=crop",
  // Sony A6400 camera
  "fb42b880-b68b-423b-a0d9-e3e0e36b7ab1":
    "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=1200&q=80&auto=format&fit=crop",
  // Mountain bike
  "3f7b1c5f-cb74-48a6-afd2-5c78955b24a3":
    "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=1200&q=80&auto=format&fit=crop",
  // Party table & chairs
  "cc40abe6-ad82-4e22-9c27-31cd7a904ea0":
    "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1200&q=80&auto=format&fit=crop",
  // Portable generator
  "795ed2e2-9183-4288-b93e-0fbe2b38b1de":
    "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=1200&q=80&auto=format&fit=crop",
  // MacBook Pro
  "a4681824-75da-4157-a21a-896e3b1c3b89":
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=1200&q=80&auto=format&fit=crop",
  // Wooden bed
  "602581a2-4b02-4a75-a7eb-631880075e4f":
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80&auto=format&fit=crop",
  // Tennis rackets
  "e43a7f3e-3d16-4756-8ad2-cb98e09d4c81":
    "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1200&q=80&auto=format&fit=crop",
  // Classic watch
  "12087343-9d84-49ed-955e-e8640f1a11dd":
    "https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=1200&q=80&auto=format&fit=crop",
  // Self-development books
  "1e580c46-ce6a-4eea-97c4-63be94dfd5c4":
    "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1200&q=80&auto=format&fit=crop",
};

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.havpresypsvxevwwkjis",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

async function downloadAndUpload(listingId, ownerPath, url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download ${listingId}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`too small ${listingId}`);
  const path = `${ownerPath}/${listingId}/product-photo.jpg`;
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/listing-images/${path}`, {
    method: "PUT",
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "image/jpeg",
    },
    body: buf,
  });
  if (!put.ok) {
    const t = await put.text();
    throw new Error(`upload ${listingId}: ${put.status} ${t}`);
  }
  return { path, bytes: buf.length };
}

(async () => {
  await client.connect();
  let ok = 0;
  let fail = 0;
  for (const [listingId, url] of Object.entries(IMAGES)) {
    try {
      const row = await client.query(
        `SELECT l.owner_id, li.id AS img_id, li.storage_path
         FROM listings l
         LEFT JOIN listing_images li ON li.listing_id = l.id AND li.is_primary = true
         WHERE l.id = $1`,
        [listingId]
      );
      if (row.rowCount === 0) {
        console.log(`SKIP ${listingId}: listing not found`);
        fail++;
        continue;
      }
      const { owner_id, img_id, storage_path } = row.rows[0];
      const { path, bytes } = await downloadAndUpload(listingId, owner_id, url);
      if (img_id) {
        await client.query("UPDATE listing_images SET storage_path = $1 WHERE id = $2", [path, img_id]);
      } else {
        await client.query(
          `INSERT INTO listing_images (listing_id, storage_path, sort_order, is_primary)
           VALUES ($1, $2, 0, true) ON CONFLICT DO NOTHING`,
          [listingId, path]
        );
      }
      console.log(`OK ${listingId} (${bytes} bytes) → ${path}`);
      ok++;
      // best-effort delete old path
      if (storage_path && storage_path !== path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/listing-images/${storage_path}`, {
          method: "DELETE",
          headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`FAIL ${listingId}: ${e.message}`);
      fail++;
    }
  }
  // verify
  const check = await client.query(
    `SELECT l.title, li.storage_path
     FROM listings l JOIN listing_images li ON li.listing_id = l.id AND li.is_primary = true
     WHERE l.status = 'published' ORDER BY l.created_at`
  );
  console.log("\nCurrent primary images:");
  for (const r of check.rows) {
    console.log(` - ${r.title}: ${r.storage_path.split("/").pop()}`);
  }
  console.log(`\nDone: ${ok} updated, ${fail} failed`);
  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
