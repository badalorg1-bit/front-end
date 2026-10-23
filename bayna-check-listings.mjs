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
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };
const r = await fetch(`${URL_}/rest/v1/listings?select=id,title,listing_type,city,status,listing_images(storage_path)&order=created_at`, { headers: H });
const rows = await r.json();
console.log("total:", rows.length);
for (const x of rows) {
  console.log(`- [${x.listing_type}] ${x.title} | ${x.city} | ${x.status} | imgs=${(x.listing_images || []).length}`);
}
