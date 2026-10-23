import { Client } from "pg";

const client = new Client({
  host: "aws-0-eu-west-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.havpresypsvxevwwkjis",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  const listings = await client.query(
    `select id,title,listing_type,status,rental_price,rental_unit,city,district,owner_id,created_at
     from public.listings order by created_at desc limit 10`,
  );
  console.log("listings:", JSON.stringify(listings.rows, null, 2));
  const imgs = await client.query(
    `select id, listing_id, storage_path, created_at from public.listing_images limit 10`,
  );
  console.log("listing_images:", JSON.stringify(imgs.rows, null, 2));
  const objs = await client.query(
    `select name, bucket_id, owner from storage.objects where bucket_id = 'listing-images' limit 10`,
  );
  console.log("storage.objects:", JSON.stringify(objs.rows, null, 2));
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
