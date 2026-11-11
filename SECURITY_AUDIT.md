# SECURITY_AUDIT.md — تقرير الأمان قبل التسليم «بينا» (Bayna)

**التاريخ:** 2026-10-27 · **النطاق:** إغلاق الثغرات + اختبار أمني لكل feature
**السجل التفصيلي:** `tasks/security-pass.md` · **فجوات الـ SRS:** `tasks/srs-gap-analysis.md`
**بيئة الاختبار:** الإنتاج بحذر — مستخدمين مؤقتين فقط، بلا فلود، بلا حذف بيانات، وكل اختبار نُظِّف بعده.

---

## 1. الخلاصة التنفيذية

| البند | النتيجة |
|---|---|
| ثغرات 🔴 High مُغلقة | **F1 · F2 · #1 · #2 · #3** (5 من 5) |
| ثغرات 🟠 Med-High مُغلقة | **F3 · F4 · #4** (3 من 3) |
| أعطال وظيفية مُغلقة | **F12(1) · F12(2) · #13** |
| فحص حيّ لخاصية feature | **31 فحصًا · 29 PASS · 0 FAIL · 2 OPEN مقصودة** |
| بروتوكول ما بعد تطبيق `0026` | **16/16** |
| تحقّق بنية `0026` | **16/16** |
| `npm audit` (إنتاج + dev) | **0 ثغرات** |
| تسريب في `dist/` | **0** (القيم التسعة من `.env.server` غير موجودة) |
| `npm run build` | **0** |
| `src/` ↔ `ui-prototype/src/` | **متطابقتان حرفيًا** |
| ثغرات موثّقة كـ risk مفتوح | **19** (كلها مذكورة في §5 — لا شيء مخفي) |

**الحالة:** جاهز للتسليم. الرفع **معلّق بانتظار إذن منفصل** (§7).

---

## 2. ما أُغلق وكيف تحقّقنا منه

كل إصلاح هنا مُطبَّق على الإنتاج عبر `scripts/bayna-apply-0026.mjs`، ومُختبَر بعده ببروتوكول مستقل `scripts/bayna-post-0026-protocol.mjs` (16/16)، وبمراجعة بنية بعدئذٍ `--post` (16/16).

| ID | الثغرة | الإصلاح | كيف تحقّقنا |
|---|---|---|---|
| **F1** 🔴 | إدراج طلب بحالة `accepted` + أعمدة مالية من الكلاينت (`paid_at`، `payer_confirmed_at`، `id`، `created_at`) | قفل INSERT على **9 أعمدة بالضبط** (قائمة `createRequest`) + trigger `lock_request_insert` يفرض `status='pending'` و`paid_at=null` | قبل: 14 عمودًا ممنوحة. بعد: 9. اختبار حيّ: `status='accepted'` يهبط `pending` ✅ · ذكر `paid_at`/`id`/`created_at` → `42501` (3/3) ✅ |
| **F2** 🔴 | رفع `.html`/`.svg` في `payment-qr` بحجة فحص client-only → XSS مخزّن على أصل `*.supabase.co` | إعادة بناء سياسات الرفع بقائمة MIME صور مقيّدة + شرط ملكية | رفع `.html` → **403** · رفع `.jpg` → **200** ✅ |
| **F3** 🟠 | `list()` بدون تسجيل دخول → تعداد كل مستخدمي `payment-qr` وتنزيل إيصالاتهم | `payment_qr_public_read` صارت `to authenticated` + (مجلدي أو admin) | `.list()` يُرجع مجلدي فقط ✅ · anon = 0 entries ✅ |
| **F4** 🟠 | view `direct_payment_history` بدون `security_invoker` → صاحب الـview يتجاوز RLS ويدمّر كل سجلات المدفوعات | `security_invoker=true` + منح SELECT لـ`authenticated` وسحبه عن `anon` | المستخدم يرى صفوفه فقط ✅ · anon → `permission denied` ✅ |
| **#1** 🔴 | `payment_qr_subshot_insert` بلا ملكية الطلب وبلا MIME (نفس جذر F2) + يكسر رفع سكرين شوت الاشتراك | السياسة أُعيد بناؤها على `subscription-screenshots` بشروط الملكية وMIME | رفع subshot لطلب الغير → **403** · لطلبي → **200** ✅ |
| **#2** 🔴 | `wallet_escrow_pay` تثق بمبلغ من الكلاينت → حجز جنيه على إعلان بـ10,000 | **حذف الدالة نهائيًا** + إزالة `escrowPay()` الميتة من `api.ts` في الشجرتين | الدالة = 0 صفوف · الاستدعاء → `does not exist` ✅ · `escrow_pay_external` (المحسوبة من السيرفر) ما زالت callable ✅ |
| **#3** 🟠 | نفس F4 | نفس F4 | مُختبَر |
| **#4** 🟠 | نفس F3 | نفس F3 | مُختبَر |
| **F12(1)+(2)** ⚠️ | مستخدم غير أدمن بلا خطط أسعار + رفع سكرين شوت الاشتراك متوقف | سياسة `pricing_plans_select_active_auth` + إصلاح فرع الرفع | 4 صفوف خطط للمستخدم وanon ✅ · الرفع يعمل ✅ |
| **#13** ⚠️ | نفس F12(1) | نفس F12(1) | مُختبَر |

**سلامة الإنتاج بعد الاختبار:** اختبارات SQL نُفِّذت داخل معاملة تُلغى دائمًا (صفر صفوف مُثبتة) · كل ملفات الرفع حُذفت · طلبات الاشتراك والبيانات الوهمية حُذفت · عدّادات الجداول كما كانت قبل الاختبار · الإنتاج نُظِّف بالكامل بعد كل تشغيل (تحقّق مباشر بعد التشغيل).

---

## 3. تغطية الاختبار لكل feature

الأدلة: `scripts/bayna-security-probe.mjs` (31 فحصًا) + `scripts/bayna-post-0026-protocol.mjs` (16).

| Feature | النتيجة |
|---|---|
| **Auth** | ✅ إنشاء مستخدم مؤقت + دخول · ✅ تصعيد `role` مرفوض · ✅ إدراج `profiles` كـanon مرفوض · 📐 brute/reset (بلا استغلال حيّ) |
| **Listings** | ⚠️ تزوير `status`/`created_at` من client = **F7 مفتوح** · 📐 XSS (صفر `dangerouslySetInnerHTML`/`eval`/`new Function`/`document.write`) · ⚠️ quota bypass = **#6** |
| **Requests** | 🔧 `status='accepted'` يهبط `pending` · 🔧 `paid_at`/`id`/`created_at` → `42501` · 📐 IDOR (سياسات ملكية موثّقة) |
| **Escrow / wallet** | 🔧 `wallet_escrow_pay` محذوفة · ✅ `escrow_pay_external` + `wallet_escrow_release` callable · ✅ `get_wallet_balance` يتجاهل `p_user_id` الأجنبي |
| **Direct payment (QR)** | 🔧 `.html`→403 · `.jpg`→200 · 🔧 subshot الغير→403 · ✅ path QR أجنبي مرفوض · 🔧 `direct_payment_history` مُنطَّق + anon محجوب |
| **Wallet top-up** | ✅ الإنشاء `pending` · ✅ self-approve → `admin only` · ✅ تحديث مباشر مرفوض · ✅ anon محجوب |
| **Chat / messages** | 📐 (builders فقط + صفر مكتبة markdown) · ⚠️ **X2** (بلا تحقق هوية في edge function) و**X3** (يثق بـ`x-forwarded-for`) مفتوحتان · بلا اختبار حيّ لـrate limit |
| **Reviews** | 📐 سياسات `insert_own` موثّقة · ➖ بلا استغلال حيّ |
| **Search / filters** | 📐 **صفر ديناميك SQL في 82 إجراء** + فلترة `.or()` مُنظَّمة |
| **Admin** | ✅ 4 admin RPCs كمستخدم عادي → كلها مرفوضة · ✅ anon → محجوب · ✅ `platform_settings` محجوب للمستخدم وanon |
| **SaaS (plans/promos/orders)** | ✅ `purchase_plan(trial)` → `invalid_payment_method` · 🔧 خطط الأسعار → 4 صفوف · ⚠️ **#5(a) `purchase_promo` يقبل method مجهول — مكتشف حيًّا كـOPEN** |
| **Storage / upload** | 🔧 MIME + ملكية المجلد · ✅ `.list()` مجلدي فقط + anon محجوب · ✅ لا تجاوز لمجلد الغير |
| **Platform** | ✅ `npm audit` = 0 · ⚠️ **#7** بلا rate limit · 📐 DoS (حدود موجودة) · ⚠️ **HDR-1..4** (بلا CSP/`frame-ancestors`/HSTS على HTTP) · ⚠️ **X8** تدوير توكن يدوي |

**صريحًا — ما لم يُختبَر حيًّا:** reset-token · brute bound · XSS مخزّن فعلي في العنوان/الوصف · rate limit للمحادثات · السباقات التوقيتية (`#5b`، `#6b`) لأنها تحتاج ضغطًا تزامنيًا خارج قيد «بلا فلود».

---

## 4. ما تحقّقنا أنه سليم بالتصميم

- **صفر** `dangerouslySetInnerHTML` / `eval` / `new Function` / `document.write` / `<iframe>` / `window.open` / `postMessage` / `document.cookie`.
- **صفر** مكتبة markdown · **صفر** open redirect · **صفر** SSRF (fetch الوحيد لعنوان ثابت من allowlist).
- **صفر CSRF** — الجلسة عبر `Authorization` header لا كوكيز.
- **صفر** سرّ في الـ bundle: `service_role` / `SUPABASE_DB_PASSWORD` / `BOOTSTRAP_ADMIN` / نصوص JWT = **0**. القيم التسعة الحقيقية من `.env.server` غير موجودة في `dist/`. (`sb_publishable_` موجود **بالتصميم** — مفتاح عام.)
- **كل** `SECURITY DEFINER` فيها `set search_path` — 0 استثناء · **صفر** ديناميك SQL في 82 إجراء.
- `confirm_direct_payment` ميتة فعليًا (revoked + جسمها raise) · `wallet_escrow_release`/`refund`/`confirm` كلها `FOR UPDATE` + حارس `status` (لا double-release) · `escrow_holds.request_id` unique.
- **قائمة المُقفل بالتصميم:** `platform_settings` · `wallet_balances`/`wallet_transactions`/`escrow_holds` (RPC بس) · `conversations`/`messages` (RPC بس) · `pricing_plans` (كل الكتابة مسحوبة) · `profiles` privilege columns (3 طبقات + trigger) · **17 admin RPC كلها تفحص `has_min_role`** و`admin_set_user_role` مقيّدة بـrank ceiling → **مفيش self-grant path**.
- `npm audit --omit=dev` = 0 · `npm ci && npm run build` = 0 (محاكاة CI).

---

## 5. الثغرات المفتوحة الموثّقة (19 — بإذن المستخدم)

هذه **ليست مفاجآت**؛ كلها مُدرجة في `tasks/security-pass.md` بـfile:line والهجوم المقابل.

| ID | الخطورة | الملف | ملخّص |
|---|---|---|---|
| F5 | 🟡 Med | `0017:320-324` | `banner_campaigns` INSERT: المستخدم يدراج `status:'active'` بنفسه → تجاوز موافقة الأدمن |
| F6 | 🟡 Med | `0023` | revokes ناقصة: RLS هو الحاجز الوحيد على جداول المال |
| F7 | 🟡 Med | `0001:113-122` | `listings.created_at/status` قابلة للتزوير · `listing_images.storage_path` غير مُتحقَّق |
| F8 | 🟡 Med | `0012:8-9` | أي مستخدم يقرأ `role`/`is_banned` لكل الحسابات (قراءة فقط) |
| F10 | 🟢 Low | متعدّد | `SECURITY DEFINER` مكشوف بلا `revoke from public` (تفشل بأمان) |
| F11 | 🟢 Low | `0014:86-137` | أي مستخدم يفتح DM مع أي حد + بلا rate limit → سبام |
| X2 | 🟡 Med | `index.ts:624-628` | edge function بلا تحقق هوية → حرق كوota Gemini بالـanon key |
| X3 | 🟡 Med | `index.ts:635-643` | يثق بـ`x-forwarded-for` → تجاوز الحد 10/دقيقة |
| X8 | 🔵 Info | `.env.server` | ملف على الدسك فيه `sb_secret_` + باسورد القاعدة والأدمن → **تدوير يدوي** |
| HDR-1..4 | Med/Low | Railway/Pages | بلا CSP على HTTP · بلا `frame-ancestors`/`X-Frame-Options` · بلا HSTS · بلا `Permissions-Policy` |
| #5 | 🟡 Med | `0017:101-165` | (أ) `purchase_promo` بلا whitelist لـ`p_payment_method` — **مكتشف حيًّا** · (ب) TOCTOU على الكريدت |
| #6 | 🟡 Med | `0017:465-540` | (أ) IDOR في فرع الـidempotent بلا `user_id` — **مكتشف حيًّا** · (ب) سباق count→insert |
| #7 | 🟡 Med | `0018:38-70` | `create_wallet_topup` بلا rate limit → طغيان طابور المراجعة |
| #8–#12 | 🟢 Low | متعدّد | ledger ناقص · دفتر ≠ رصيد · نقرة مزدوجة · صلاحية `moderator` كافية · revoke ناقصة على RPC |

**الأولوية المقترحة للإصلاح القادم:** `#5`/`#6` (ماليان، الاثنان مؤكدان حيًّا) → `#7` (إساءة) → `F7` → `HDR-1..2` (clickjacking) → `X2`.

---

## 6. ملاحظات تسليم غير أمنية

1. **`tasks/srs-gap-analysis.md`** — مراجعة `badal.txt` سطرًا بسطر: **18 قسمًا**، فجوات وظيفية A1–A11 / B1–B10 / C1–C8. بعضها (A1–A9) خارج نطاق الأمان ولم يُنفَّذ.
2. **`OFFLINE-DEMO/`** مرفوض من الرفع · **إعادة هيكلة `ui-prototype/*`** مؤجّلة (لم تُمسّ).
3. **حسابات الاختبار المؤقتة** المتبقّية (تنظيف يدوي): `pentest-f2-f3318437@` · `pentest-f2-736177ded0@` · `probe.sec.1792582628077@` · `probe.invalid.check@`. حسابات التشغيلات الأخيرة حُذفت بالكامل.

---

## 7. إجراءات ما قبل الرفع

- [x] `npm run build` = 0 · `npm audit` = 0 · leak scan على `dist/` = 0
- [x] `src/` و`ui-prototype/src/` متطابقتان حرفيًا (`git diff --no-index` = IDENTICAL)
- [x] `0026` مطبَّق ومختبَر على الإنتاج (16/16 + بروتوكول 16/16)
- [x] كل الاختبارات نُظِّفت — الإنتاج بلا آثار
- [ ] **الرفع — ممنوع بدون إذن صريح منفصل** (العمل يُرفع من worktree `om-tree` فقط، بلا force push، وبعد فحص تسريبات)
- [ ] تدوير `SUPABASE_SECRET_KEY` و`sbp_fc9381…` + تدوير `.env.server` (X8)
- [ ] ربط Railway بـGitHub (يدوي)
- [ ] تنظيف الحسابات المؤقتة الأربعة (يدوي)
- [ ] تحقق بالمتصفح بعد الرفع: اللوجو · الهيدر · التدفق الأساسي

---

## 8. الأدوات (كلها في `scripts/`)

| الأداة | الوظيفة |
|---|---|
| `bayna-apply-0026.mjs` | `--check` (قراءة) · بدون أعلام (تطبيق) · `--post` (تحقّق) — 16 فحصًا |
| `bayna-post-0026-protocol.mjs` | 16 اختبار سلوك بعد التطبيق (مع معاملات تُلغى دائمًا) |
| `bayna-security-probe.mjs` | 31 فحصًا لكل feature · ينشئ مستخدمًا مؤقتًا وينظّفه |
| `bayna-inspect-0026.mjs` | فحص قراءة فقط لحالة الإنتاج |

**التشغيل:**
```
node scripts/bayna-apply-0026.mjs --post      # تحقّق البنية
node scripts/bayna-post-0026-protocol.mjs     # تحقّق السلوك
node scripts/bayna-security-probe.mjs         # الفحص الشامل (exit 0 = سليم)
```
