import { readFileSync } from "node:fs";
function loadEnv(name) {
  try {
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}
loadEnv(".env.server");
const URL_ = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const TARGETS = [
  { title: "كاميرا Sony A6400 مع عدسة 18-135", seed: "badal-camera" },
  { title: "دراجة هوائية جبلية جيار موديل 2023", seed: "badal-bike" },
];

for (const t of TARGETS) {
  const q = await fetch(`${URL_}/rest/v1/listings?title=eq.${encodeURIComponent(t.title)}&select=id,owner_id`, { headers: H });
  const rows = await q.json();
  if (!rows.length) { console.log("not found:", t.title); continue; }
  const { id, owner_id } = rows[0];
  const imgRes = await fetch(`https://picsum.photos/seed/${encodeURIComponent(t.seed)}/900/700`, { redirect: "follow" });
  if (!imgRes.ok) { console.log("picsum fail:", t.title); continue; }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const path = `${owner_id}/${id}/demo-${t.seed}.jpg`;
  const up = await fetch(`${URL_}/storage/v1/object/listing-images/${path}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "image/jpeg" },
    body: buf,
  });
  if (!up.ok) { console.log("upload fail:", t.title, up.status, (await up.text()).slice(0, 200)); continue; }
  const ir = await fetch(`${URL_}/rest/v1/listing_images`, {
    method: "POST", headers: H,
    body: JSON.stringify({ listing_id: id, storage_path: path, sort_order: 0, is_primary: true }),
  });
  console.log(ir.ok ? `backfilled: ${t.title}` : `row fail: ${t.title} ${await ir.text()}`);
}
