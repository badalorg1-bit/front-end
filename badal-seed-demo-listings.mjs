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
loadEnv(".env.local");

const URL_ = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET;
if (!URL_ || !SECRET) throw new Error("SUPABASE_URL / SUPABASE_SECRET missing");

const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

async function token(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

const ownerAhmed = await token("ahmed.owner.badal@gmail.com", process.env.DEMO_PASSWORD_A || "BadalTest!2026#A");
const ownerSara = await token("sara.buyer.badal@gmail.com", process.env.DEMO_PASSWORD_B || "BadalTest!2026#B");
const ahmedId = JSON.parse(Buffer.from(ownerAhmed.split(".")[1], "base64").toString()).sub;
const saraId = JSON.parse(Buffer.from(ownerSara.split(".")[1], "base64").toString()).sub;
console.log("owners:", ahmedId, saraId);

const DEMO = [
  { owner: "ahmed", title: "كاميرا Sony A6400 مع عدسة 18-135", type: "rent", category: "إلكترونيات", city: "القاهرة", district: "مدينة نصر", condition: "ممتاز",
    rental_price: 350, rental_unit: "يوم", deposit: 2000, seed: "badal-camera",
    description: "كاميرا سوني A6400 بحالة ممتازة، مع عدسة 18-135 ملم وبطاريتين وحقيبة. مناسبة للتصوير والفيديو والفلوج. الاستلام والتسليم بالقاهرة — مدينة نصر أو مصر الجديدة." },
  { owner: "ahmed", title: "دراجة هوائية جبلية جيار موديل 2023", type: "rent", category: "رياضة ورحلات", city: "الجيزة", district: "الدقي", condition: "ممتاز",
    rental_price: 150, rental_unit: "يوم", deposit: 1500, seed: "badal-bike",
    description: "دراجة جيار 21 سرعة بحالة ممتازة، مناسبة لطرق الجيزة والكوم أند سيدار. تُسلَّم مضبوطة على طولك مع قفل وأكسجين." },
  { owner: "ahmed", title: "فستان سهرة سواريه — مقاس M", type: "rent", category: "مناسبات وفعاليات", city: "القاهرة", district: "مصر الجديدة", condition: "ممتاز",
    rental_price: 400, rental_unit: "يوم", deposit: 500, seed: "badal-dress",
    description: "فستان سهرة أسود طويل بقصّة سواريه، مقاس M، مناسب للمناسبات والخطوبة. يُنظَّف بالكامل بعد كل إيجار." },
  { owner: "ahmed", title: "طاولة و6 كراسي مضخّمة لمناسبات", type: "rent", category: "مناسبات وفعاليات", city: "القاهرة", district: "التجمع الخامس", condition: "جيد",
    rental_price: 250, rental_unit: "يوم", deposit: 1000, seed: "badal-party",
    description: "طاولة مستديرة مضخّمة 180سم مع 6 كراسي مضخّمة مناسبة لأعياد الميلاد والتجمعات. التوصيل متاح داخل القاهرة برسوم إضافية." },
  { owner: "ahmed", title: "مولد كهربائي محمول 3.5 كيلوواط", type: "rent", category: "أدوات ومستلزمات", city: "الجيزة", district: "أكتوبر", condition: "جيد",
    rental_price: 100, rental_unit: "ساعة", deposit: 3000, seed: "badal-generator",
    description: "مولد بنزين 3.5 كيلوواط يكفي تكييفين + إضاءة. مثالي لحفلات وأعمال البناء الطارئة. يتطلب وقود بنزين." },
  { owner: "sara", title: "ماك بوك برو M1 2020 — 16 جيجا رام", type: "sale", category: "إلكترونيات", city: "الإسكندرية", district: "سموحة", condition: "ممتاز",
    sale_price: 28000, deposit: 0, seed: "badal-mac",
    description: "ماك بوك برو 13 بوصة M1، رام 16 جيجا، تخزين 512، دورات البطارية 92% فقط. مع الشاحن الأصلي والكرتون. خالي من الخدوش." },
  { owner: "ahmed", title: "سرير مفرد خشب زان + مرتبة طبية", type: "sale", category: "أثاث ومفروشات", city: "القاهرة", district: "شبرا", condition: "جديد",
    sale_price: 4500, deposit: 0, seed: "badal-bed",
    description: "سرير مفرد خشب زان طبيعي 120×200 مع مرتبة طبية جديدة بضمان سنتين. جديد تمامًا في الكرتون — التوصيل والاستبدال متاح." },
  { owner: "sara", title: "مضارب تنس Wilson Pro Staff", type: "sale", category: "رياضة ورحلات", city: "القاهرة", district: "المعادي", condition: "ممتاز",
    sale_price: 800, deposit: 0, seed: "badal-tennis",
    description: "مضرب تنس Wilson Pro Staff بإطار أصلي وريشة جوديل 16×19. استُخدم في ملاعب نادي واحد فقط — بحالة ممتازة مع كيس حماية." },
  { owner: "ahmed", title: "ساعة يد كلاسيكية Seiko", type: "swap", category: "ملابس وإكسسوارات", city: "القاهرة", district: "الزمالك", condition: "ممتاز",
    deposit: 0, seed: "badal-watch",
    swap_preferences: "أفضّل مقايضتها بسماعات لاسلكية AirPods Pro أو ساعة ذكية بحالة ممتازة.",
    description: "ساعة Seiko أوتوماتيك كلاسيكية بحزام جلد طبيعي. تعمل بدقة ممتازة. أرغب في مقايضتها لأغراض إلكترونيات — العرض مفتوح." },
  { owner: "sara", title: "مجموعة كتب تطوير ذاتي (6 كتب)", type: "swap", category: "أدوات ومستلزمات", city: "الجيزة", district: "فيصل", condition: "جيد",
    deposit: 0, seed: "badal-books",
    swap_preferences: "أفضّل مقايضتها بكتب دراسية أو أدوات رسم أو كتاب آخر بقيمة مماثلة.",
    description: "ستة كتب عربي في تطوير الذات والعادات والإنتاجية، بحالة جيدة. رابعة من نشرات مميزة — مجموعة ممتازة لبداية السنة." },
];

async function fetchImage(seed) {
  try {
    const r = await fetch(`https://picsum.photos/seed/${encodeURIComponent(seed)}/900/700`, { redirect: "follow" });
    if (!r.ok) return null;
    return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "image/jpeg" };
  } catch { return null; }
}

let created = 0, skipped = 0;
for (const d of DEMO) {
  const ownerId = d.owner === "ahmed" ? ahmedId : saraId;
  const existing = await fetch(`${URL_}/rest/v1/listings?owner_id=eq.${ownerId}&title=eq.${encodeURIComponent(d.title)}&select=id`, { headers: H });
  const existingText = await existing.text();
  if (!existing.ok) { console.error("exists-check fail:", existing.status, existingText.slice(0, 200)); continue; }
  const found = existingText ? JSON.parse(existingText) : [];
  if (found.length) { console.log("skip (exists):", d.title); skipped++; continue; }

  const row = {
    owner_id: ownerId,
    title: d.title,
    description: d.description,
    listing_type: d.type,
    category: d.category,
    city: d.city,
    district: d.district ?? null,
    condition: d.condition,
    status: "published",
    rental_price: d.type === "rent" ? d.rental_price : null,
    rental_unit: d.type === "rent" ? d.rental_unit : null,
    sale_price: d.type === "sale" ? d.sale_price : null,
    swap_preferences: d.type === "swap" ? d.swap_preferences : null,
    deposit: d.deposit ?? 0,
  };
  const ins = await fetch(`${URL_}/rest/v1/listings?select=id`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
  const insText = await ins.text();
  if (!ins.ok) { console.error("insert fail:", d.title, ins.status, insText.slice(0, 300)); continue; }
  const listingId = JSON.parse(insText)[0].id;

  const img = await fetchImage(d.seed);
  if (img) {
    const path = `${ownerId}/${listingId}/demo-${d.seed}.jpg`;
    const up = await fetch(`${URL_}/storage/v1/object/listing-images/${path}`, {
      method: "POST",
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": img.type },
      body: img.buf,
    });
    if (up.ok) {
      await fetch(`${URL_}/rest/v1/listing_images`, {
        method: "POST", headers: H,
        body: JSON.stringify({ listing_id: listingId, storage_path: path, sort_order: 0, is_primary: true }),
      });
    } else {
      console.warn("image upload fail:", d.title, up.status, await up.text());
    }
  }
  console.log("created:", d.title, img ? "(+img)" : "(no img)");
  created++;
}
console.log(`Done. created=${created} skipped=${skipped}`);
