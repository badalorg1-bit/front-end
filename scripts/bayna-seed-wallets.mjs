import { Client } from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD env var is required.");
  process.exit(1);
}
const host = process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com";
const user = process.env.SUPABASE_DB_USER;
if (!user) {
  console.error("SUPABASE_DB_USER env var is required.");
  process.exit(1);
}
const client = new Client({
  host,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user,
  password,
  database: process.env.SUPABASE_DB_NAME || "postgres",
  ssl: { rejectUnauthorized: false },
});

const SARA = "95df5678-2d59-4c2c-84ea-adbbddd5095f";
const AHMED = "68835025-5214-4ca1-be53-574b5f21632d";

(async () => {
  await client.connect();
  // Reset to known demo balances
  for (const [uid, amt] of [[SARA, 5000], [AHMED, 3000]]) {
    await client.query(
      `INSERT INTO wallet_balances (user_id, balance) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = $2, updated_at = now()`,
      [uid, amt]
    );
  }
  const balances = await client.query(
    "SELECT wb.user_id, wb.balance, p.display_name FROM wallet_balances wb JOIN profiles p ON p.id = wb.user_id ORDER BY p.display_name"
  );
  console.log("Wallets:", JSON.stringify(balances.rows, null, 2));
  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'escrow_holds' ORDER BY ordinal_position"
  );
  console.log("escrow_holds columns:", cols.rows.map((r) => r.column_name).join(", "));
  const holds = await client.query("SELECT * FROM escrow_holds");
  console.log("Escrow holds:", JSON.stringify(holds.rows, null, 2));
  const fee = await client.query("SELECT * FROM platform_settings");
  console.log("Platform settings:", JSON.stringify(fee.rows, null, 2));
  await client.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
