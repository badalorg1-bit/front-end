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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const password = process.env.SUPABASE_DB_PASSWORD;

const SARA = "95df5678-2d59-4c2c-84ea-adbbddd5095f";
const AHMED = "68835025-5214-4ca1-be53-574b5f21632d";

async function uploadAvatar(userId, seedNum) {
  const url = `https://i.pravatar.cc/300?img=${seedNum}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pravatar ${seedNum}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `${userId}/seed-avatar-${seedNum}.jpg`;
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
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
    throw new Error(`upload ${path}: ${put.status} ${t}`);
  }
  return path;
}

(async () => {
  // 1) Upload avatars
  const saraPath = await uploadAvatar(SARA, 5);
  const ahmedPath = await uploadAvatar(AHMED, 12);
  console.log("Uploaded avatars:", saraPath, ahmedPath);

  // 2) Update profiles
  const client = new Client({
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.havpresypsvxevwwkjis",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("UPDATE profiles SET avatar_url = $1 WHERE id = $2", [saraPath, SARA]);
  await client.query("UPDATE profiles SET avatar_url = $1 WHERE id = $2", [ahmedPath, AHMED]);

  // 3) Insert reviews on accepted requests (sara↔ahmed)
  const accepted = await client.query(
    "SELECT id, requester_id, owner_id FROM listing_requests WHERE status = 'accepted' LIMIT 4"
  );
  let inserted = 0;
  for (const req of accepted.rows) {
    // requester reviews owner
    const existsA = await client.query(
      "SELECT 1 FROM reviews WHERE request_id = $1 AND reviewer_id = $2",
      [req.id, req.requester_id]
    );
    if (existsA.rowCount === 0) {
      await client.query(
        `INSERT INTO reviews (request_id, reviewer_id, reviewee_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [
          req.id,
          req.requester_id,
          req.owner_id,
          5,
          "تعامل ممتاز وسريع. أنصح بالتعامل معه.",
        ]
      );
      inserted++;
    }
    // owner reviews requester
    const existsB = await client.query(
      "SELECT 1 FROM reviews WHERE request_id = $1 AND reviewer_id = $2",
      [req.id, req.owner_id]
    );
    if (existsB.rowCount === 0) {
      await client.query(
        `INSERT INTO reviews (request_id, reviewer_id, reviewee_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [
          req.id,
          req.owner_id,
          req.requester_id,
          4,
          "مستأجر محترم والتسليم كان في الوقت المحدد.",
        ]
      );
      inserted++;
    }
  }
  console.log(`Inserted ${inserted} reviews on ${accepted.rows.length} accepted requests`);

  // 4) Verify
  const revs = await client.query(
    `SELECT r.rating, r.comment, p.display_name AS reviewer
     FROM reviews r JOIN profiles p ON p.id = r.reviewer_id LIMIT 10`
  );
  console.log("Reviews:", JSON.stringify(revs.rows, null, 2));
  const profs = await client.query(
    "SELECT id, display_name, avatar_url FROM profiles WHERE id IN ($1, $2)",
    [SARA, AHMED]
  );
  console.log("Profiles:", JSON.stringify(profs.rows, null, 2));
  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
