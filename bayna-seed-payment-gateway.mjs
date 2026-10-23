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

(async () => {
  const client = new Client({
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.havpresypsvxevwwkjis",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Upload QR to the CORRECT bucket: payment-qr (hyphen)
  const qrData = encodeURIComponent("https://instagram.com/badal.egypt");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${qrData}`;
  const res = await fetch(qrUrl);
  if (!res.ok) throw new Error(`QR gen: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = "badal-platform/qr-instagram.jpg";
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/payment-qr/${path}`, {
    method: "PUT",
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "image/jpeg",
    },
    body: buf,
  });
  if (!put.ok) throw new Error(`upload QR: ${put.status} ${await put.text()}`);
  console.log(`QR uploaded to payment-qr: ${path} (${buf.length} bytes)`);

  // Update platform_settings to point at the correct path
  await client.query(
    `UPDATE platform_settings
     SET badal_qr_path = $1, updated_at = now()
     WHERE id = 1`,
    [path]
  );
  const row = await client.query(
    "SELECT badal_wallet_name, badal_qr_path, badal_instagram, escrow_fee_percent FROM platform_settings WHERE id = 1"
  );
  console.log("Platform settings:", JSON.stringify(row.rows[0], null, 2));

  // Drop the wrongly-named bucket
  await client.query("DELETE FROM storage.buckets WHERE id = 'payment_qr'");
  console.log("Dropped duplicate payment_qr bucket");

  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
