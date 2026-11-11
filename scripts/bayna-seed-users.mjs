import { Client } from "pg";

const secret = process.env.SUPABASE_SECRET_KEY;
const ref = "havpresypsvxevwwkjis";
const base = `https://${ref}.supabase.co`;

async function adminFetch(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "badal-mvp-cli/1.0",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function sql(query, params = []) {
  const client = new Client({
    host: "aws-0-eu-west-1.pooler.supabase.com",
    port: 6543,
    user: `postgres.${ref}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const r = await client.query(query, params);
    return r;
  } finally {
    await client.end();
  }
}

const bPassword = process.env.BADAL_PASSWORD_B;
if (!bPassword) {
  console.error("BADAL_PASSWORD_B required");
  process.exit(1);
}

async function main() {
  // Confirm User A via SQL (admin API may reject secret from this network path)
  const confirm = await sql(
    `update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now())
     where email = $1
     returning id, email, email_confirmed_at`,
    ["ahmed.owner.badal@gmail.com"],
  );
  console.log("Confirmed A:", JSON.stringify(confirm.rows));

  // Ensure display_name on profile
  const prof = await sql(
    `update public.profiles set display_name = 'أحمد المالك', updated_at = now()
     where id = (select id from auth.users where email = $1)
     returning id, display_name`,
    ["ahmed.owner.badal@gmail.com"],
  );
  console.log("Profile A:", JSON.stringify(prof.rows));

  // Try create B via admin API
  try {
    const b = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: "sara.buyer.badal@gmail.com",
        password: bPassword,
        email_confirm: true,
        user_metadata: { display_name: "سارة المشترية" },
      }),
    });
    console.log("Created B via admin:", b?.id || b);
  } catch (e) {
    console.log("Admin create B failed:", e.message);
    // Fallback: try SQL insert into auth.users is too fragile; try signup with publishable and confirm immediately
    try {
      const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
      const signup = await fetch(`${base}/auth/v1/signup`, {
        method: "POST",
        headers: {
          apikey: pub,
          "Content-Type": "application/json",
          "User-Agent": "badal-mvp-cli/1.0",
        },
        body: JSON.stringify({
          email: "sara.buyer.badal@gmail.com",
          password: bPassword,
          data: { display_name: "سارة المشترية" },
        }),
      });
      const signupText = await signup.text();
      console.log("Signup B:", signup.status, signupText.slice(0, 200));
    } catch (e2) {
      console.log("Signup B failed:", e2.message);
    }
    // Confirm B if signup created them
    const confirmB = await sql(
      `update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now())
       where email = $1
       returning id, email, email_confirmed_at`,
      ["sara.buyer.badal@gmail.com"],
    );
    console.log("Confirmed B:", JSON.stringify(confirmB.rows));
  }

  const all = await sql(
    `select u.id, u.email, u.email_confirmed_at, p.display_name
     from auth.users u
     left join public.profiles p on p.id = u.id
     order by u.created_at`,
  );
  console.log("All users:", JSON.stringify(all.rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
