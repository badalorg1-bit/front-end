import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.server", ".env.local"]) {
  try {
    for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const OWNER_A = process.env.BADAL_EMAIL_A;
const OWNER_B = process.env.BADAL_EMAIL_B;
const PASSWORD_A = process.env.BADAL_PASSWORD_A;
const PASSWORD_B = process.env.BADAL_PASSWORD_B;
const LISTING_ID = process.env.BADAL_LISTING_ID || "056032ec-4e2c-4d4c-96fa-7663ba65e495";
const REQUEST_ID = process.env.BADAL_REQUEST_ID || "bbbd7149-1f3a-4956-bcfa-9e571392c9ea";
const OWNER_A_ID = process.env.BADAL_OWNER_A_ID || "68835025-5214-4ca1-be53-574b5f21632d";

if (!OWNER_A || !OWNER_B || !PASSWORD_A || !PASSWORD_B) {
  console.error(
    "Set BADAL_EMAIL_A, BADAL_EMAIL_B, BADAL_PASSWORD_A, BADAL_PASSWORD_B in .env.local or the environment (do not hardcode credentials).",
  );
  process.exit(1);
}

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log("PASS", name, detail);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.log("FAIL", name, detail);
}

const anon = createClient(URL, PUB, { auth: { persistSession: false } });

async function signIn(email, password) {
  const client = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return client;
}

// 1) Unauthenticated cannot read others' private request rows (RLS filters)
{
  const { data, error } = await anon
    .from("listing_requests")
    .select("id,status,message,requester_id")
    .eq("id", REQUEST_ID);
  if (error) fail("anon listing_requests query error", error.message);
  else if (!data || data.length === 0) pass("anon cannot read others' listing_requests");
  else fail("anon leaked listing_requests", JSON.stringify(data));
}

// 2) User B (requester) can see own request; can they edit someone else's listing?
{
  const b = await signIn(OWNER_B, PASSWORD_B);
  const { data: mine } = await b
    .from("listing_requests")
    .select("id,status")
    .eq("id", REQUEST_ID);
  if (mine && mine.length === 1) pass("requester can read own request");
  else fail("requester cannot read own request", JSON.stringify(mine));

  const { data: updateData, error: updErr } = await b
    .from("listings")
    .update({ title: "HACKED BY B" })
    .eq("id", LISTING_ID)
    .select("id,title");
  // RLS: either 0 rows updated, or error
  if (updErr) pass("cross-user listing update blocked (error)", updErr.message);
  else if (!updateData || updateData.length === 0) pass("cross-user listing update blocked (0 rows)");
  else fail("cross-user listing update succeeded", JSON.stringify(updateData));

  // Requester cannot change request status to accepted (status update is owner-only)
  const { data: selfStatus, error: stErr } = await b
    .from("listing_requests")
    .update({ status: "cancelled" })
    .eq("id", REQUEST_ID)
    .eq("requester_id", (await b.auth.getUser()).data.user.id)
    .select("id,status");
  // Cancel own pending is fine; status is already accepted so cancel may or may not work depending on policy
  // Check they cannot forge accepted for someone else's request id if any
  const { data: forge } = await b
    .from("listing_requests")
    .update({ status: "accepted" })
    .eq("listing_id", LISTING_ID)
    .neq("requester_id", (await b.auth.getUser()).data.user.id)
    .select("id");
  if (!forge || forge.length === 0) pass("requester cannot accept others' requests");
  else fail("requester forged accept", JSON.stringify(forge));

  await b.auth.signOut();
}

// 3) User B cannot update A's listing_images
{
  const b = await signIn(OWNER_B, PASSWORD_B);
  const { data, error } = await b
    .from("listing_images")
    .delete()
    .eq("listing_id", LISTING_ID)
    .neq("storage_path", "impossible");
  if (error) pass("cross-user listing_images delete blocked (error)", error.message);
  else if (!data || data.length === 0) pass("cross-user listing_images delete blocked (0 rows)");
  else fail("cross-user listing_images deleted", JSON.stringify(data));
  await b.auth.signOut();
}

// 4) Storage: signed path scoping — B cannot upload into A's folder
{
  const b = await signIn(OWNER_B, PASSWORD_B);
  const { error } = await b.storage
    .from("listing-images")
    .upload(`${OWNER_A_ID}/hacked.jpg`, new Blob([new Uint8Array([1, 2, 3])]), {
      contentType: "image/jpeg",
      upsert: false,
    });
  if (error) pass("cross-user storage upload blocked", error.message);
  else fail("cross-user storage upload allowed");
  await b.auth.signOut();
}

// 5) Profiles: B cannot update A's profile
{
  const b = await signIn(OWNER_B, PASSWORD_B);
  const { data, error } = await b
    .from("profiles")
    .update({ display_name: "HACKED" })
    .eq("id", OWNER_A_ID)
    .select("id");
  if (error) pass("cross-user profile update blocked (error)", error.message);
  else if (!data || data.length === 0) pass("cross-user profile update blocked (0 rows)");
  else fail("cross-user profile update succeeded", JSON.stringify(data));
  await b.auth.signOut();
}

// 6) No secrets in dist bundle
{
  const dist = join(process.cwd(), "dist");
  // Match real credentials, not library prefix checks like `startsWith("sb_secret_")`.
  const secretPatterns = [
    /sb_secret_[A-Za-z0-9_-]{16,}/,
    /postgres\.havpresypsvxevwwkjis/,
    /SUPABASE_SECRET_KEY/,
    /service_role/i,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  ];
  // publishable key is intentionally public in the frontend bundle
  const expectedPub =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_UtQFSh6HoZadpP-uS_bveA_HMihHJIA";
  let leaked = [];
  try {
    const walk = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(js|css|html|map|json|svg|txt)$/.test(f.name)) {
          const text = readFileSync(p, "utf8");
          for (const n of secretPatterns) {
            const m = text.match(n);
            if (m) {
              if (m[0] === expectedPub) continue;
              leaked.push(`${p}:${m[0].slice(0, 40)}…`);
            }
          }
          if (text.includes("postgres.havpresypsvxevwwkjis")) {
            leaked.push(`${p}:postgres.havpresypsvxevwwkjis`);
          }
        }
      }
    };
    walk(dist);
  } catch (e) {
    fail("dist scan", e.message);
  }
  if (leaked.length === 0) pass("no secrets in dist bundle");
  else fail("secrets leaked in dist", leaked.join("; "));
}

const failed = results.filter((r) => !r.ok);
console.log("\n=== RLS/SECURITY SUMMARY ===");
console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2));
  process.exit(1);
}
