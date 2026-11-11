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
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function jwt(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
const uh = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json", Prefer: "return=representation" });

const saraT = await jwt("sara.buyer.badal@gmail.com", "BadalTest!2026#B");
const ahmedT = await jwt("ahmed.owner.badal@gmail.com", "BadalTest!2026#A");
const saraId = JSON.parse(Buffer.from(saraT.split(".")[1], "base64").toString()).sub;
const ahmedId = JSON.parse(Buffer.from(ahmedT.split(".")[1], "base64").toString()).sub;
console.log("sara:", saraId, "| ahmed:", ahmedId);

// ---- 1) owner payment profile + real QR image ----
const qrData = encodeURIComponent("BADAL wallet: Vodafone Cash 01001234567 (Ahmed K.)");
const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${qrData}`;
const qrRes = await fetch(qrUrl);
let qrPath = null;
if (qrRes.ok) {
  const buf = Buffer.from(await qrRes.arrayBuffer());
  qrPath = `${ahmedId}/qr-demo-${Date.now()}.png`;
  const up = await fetch(`${URL_}/storage/v1/object/payment-qr/${qrPath}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "image/png" },
    body: buf,
  });
  console.log("qr upload:", up.ok ? "OK" : `FAIL ${up.status} ${await up.text()}`);
  if (!up.ok) qrPath = null;
} else {
  console.log("qrserver fail:", qrRes.status);
}
const profUpdate = {
  wallet_name: "فودافون كاش — أحمد",
  whatsapp_phone: "01001234567",
  instagram_handle: "ahmed.badal",
  payment_note: "التحويل بعد الاتفاق على الميعاد — يُفضّل صورة الإيصال داخل الشات.",
  payment_qr_path: qrPath,
};
const pr = await fetch(`${URL_}/rest/v1/profiles?id=eq.${ahmedId}`, {
  method: "PATCH", headers: H, body: JSON.stringify(profUpdate),
});
console.log("profile save:", pr.ok ? "OK" : await pr.text());

// ---- 2) rent request: sara -> ahmed's camera, then accept as owner ----
const camQ = await fetch(`${URL_}/rest/v1/listings?title=eq.${encodeURIComponent("كاميرا Sony A6400 مع عدسة 18-135")}&select=id,owner_id`, { headers: H });
const cam = (await camQ.json())[0];
if (!cam) throw new Error("camera listing missing");

const dateQ = await fetch(`${URL_}/rest/v1/listing_requests?requester_id=eq.${saraId}&listing_id=eq.${cam.id}&select=id,status`, { headers: H });
const prior = await dateQ.json();
let reqId;
if (prior.length) {
  reqId = prior[0].id;
  console.log("request exists:", reqId, prior[0].status);
} else {
  const ins = await fetch(`${URL_}/rest/v1/listing_requests`, {
    method: "POST", headers: uh(saraT),
    body: JSON.stringify({
      listing_id: cam.id,
      requester_id: saraId,
      owner_id: cam.owner_id,
      request_type: "rent",
      status: "pending",
      rent_start: "2026-10-22",
      rent_end: "2026-10-24",
      message: "محتاجة الكاميرا 3 أيام لتصوير مناسبة — هستلم من مدينة نصر.",
    }),
  });
  const insText = await ins.text();
  if (!ins.ok) throw new Error(`request insert: ${ins.status} ${insText}`);
  reqId = JSON.parse(insText)[0].id;
  console.log("request created:", reqId);
}
const cur = await (await fetch(`${URL_}/rest/v1/listing_requests?id=eq.${reqId}&select=status`, { headers: H })).json();
if (cur[0]?.status === "pending") {
  const acc = await fetch(`${URL_}/rest/v1/listing_requests?id=eq.${reqId}`, {
    method: "PATCH", headers: uh(ahmedT), body: JSON.stringify({ status: "accepted" }),
  });
  console.log("accept:", acc.ok ? "OK" : await acc.text());
} else {
  console.log("already:", cur[0]?.status);
}

// ---- 3) verify instructions visible to payer (no confirms yet) ----
const gi = await fetch(`${URL_}/rest/v1/rpc/get_payment_instructions`, {
  method: "POST", headers: uh(saraT), body: JSON.stringify({ p_request_id: reqId }),
});
const rows = await gi.json();
console.log("instructions ->", gi.status, JSON.stringify(rows, null, 1).slice(0, 500));
console.log("REQUEST_ID=" + reqId);
