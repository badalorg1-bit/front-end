# SECURITY PASS — خطة ما قبل التسليم (2026-10-27)

## Goal
تسليم «بينا» للعميل بعد إغلاق: XSS، حقن (SQL / ملفات / PDF)، DoS، تزوير الدفع (لعب الـ front وتغيير QR)، IDOR، تصعيد صلاحيات — مع اختبار أمني لكل feature.

## قرار المستخدم (2026-10-27)
- بيئة الاختبار: **الإنتاج بحذر** (ممنوع فلود بيهز السيرفر، ممنوع حذف بيانات، مستخدمين مؤقتين فقط).
- المعالجة: **فحص + إصلاح فوري** — كل ثغرة تُعرض بخطورتها ودليلها ثم تُصلح بعد الموافقة.
- النطاق: **اختبار أمني لكل feature** (مش happy-path فقط).

## constraints / out of scope
- ممنوع force push · ممنوع تسريب أي مفتاح · رفع عبر `om-tree` فقط (WORKFLOW.md §6).
- خارج النطاق: `OFFLINE-DEMO/`، إعادة هيكلة `ui-prototype/*`.

## المراحل
| # | المرحلة | المخرج | التحقق |
|---|---|---|---|
| P1 | فحص ثابت موازي (3 مستكشفين): payments/RLS+storage/frontend+chat | قائمة ثغرات مبدئية بـ file:line | كل dossier فيه هجوم محدد ممكن |
| P2 | `npm audit` + فحص الأسرار + الهيدرز/CSP | تقرير اعتمادات | critical/high إما مصلَّحة أو مبرَّرة |
| P3 | اختبار استغلال فعلي على الإنتاج (مقيد) | أدلة PoC | payloads صغيرة، test users مؤقتين |
| P4 | إصلاحات مؤكدة من المستخدم + build | commits نظيفة | `npm run build` + leak scan = 0 |
| P5 | اختبار أمني لكل feature (矩阵 أدناه) | نتيجة لكل feature | **✅ مكتمل** — 31 فحصًا · 29 PASS / 0 FAIL / 2 OPEN |
| P6 | رفع + تحقق بالمتصفح + تقرير تسليم | `SECURITY_AUDIT.md` | **✅ التقرير مكتوب** · الرفع + التحقق بالمتصفح **بانتظار إذن منفصل** |

## Feature security matrix (P5)
**مصطلح النتيجة:** ✅ = نجح الاختبار الحيّ (أو أُغلق بالتصميم) · 🔧 = مُصلَّح ومختبَر عبر بروتوكول `0026` · ⚠️ = موثّق كـ risk مفتوح (بإذن المستخدم) · 📐 = مُتحقَّق بالفحص الثابت فقط (بلا استغلال حيّ) · ➖ = خارج النطاق.

**الأدلة:** الاختبار الحيّ = `scripts/bayna-security-probe.mjs` (**31 فحصًا** · آخر تشغيل **29 PASS / 0 FAIL / 2 OPEN**) · بروتوكول `0026` = `scripts/bayna-post-0026-protocol.mjs` (16/16) · تحقّق بنية = `scripts/bayna-apply-0026.mjs --post` (16/16).

| Feature | اختبارات | الحالة | الدليل |
|---|---|---|---|
| Auth (signup/login/reset) | إنشاء مستخدم مؤقت + دخول ناجح · تصعيد `role` → مرفوض · إدراج `profiles` كـanon → مرفوض · brute bound / reset token | ✅ (الدخول/التصعيد/anon) · 📐 (brute/reset) | probe #1 · #30 · reset token غير مُختبَر حيًّا |
| Listings | تزوير `status`/`created_at` من client (F7) · XSS في العنوان/الوصف · quota bypass | ⚠️ F7 مفتوح · 📐 XSS (صفر `dangerouslySetInnerHTML`/`eval`) · ⚠️ quota = #6 | findings F7 · #6 |
| Requests | **INSERT `status='accepted'` → يهبط `pending`** · INSERT بذكر `paid_at`/`id`/`created_at` → `42501` · IDOR على طلب الغير | 🔧 F1 مُصلَّح ومختبَر · 📐 IDOR (سياسات `select_own` موثّقة) | probe #15–16 · protocol 1–2 |
| Escrow / wallet | `wallet_escrow_pay` (مبلغ من الكلاينت) → **محذوفة** · `escrow_pay_external`/`wallet_escrow_release` ما زالا callable · `get_wallet_balance(p_user_id)` أجنبي → يتجاهل | 🔧 #2 · ✅ #2b · ✅ IDOR محجوب | probe #17–19 · #4 · protocol 3 |
| Direct payment (QR) | `.html` → 403 · `.jpg` → 200 · subshot لطلب الغير → 403 ولطلبي → 200 · path QR أجنبي → مرفوض · `direct_payment_history` مُنطَّق + anon محجوب | 🔧 F2/#1/F12 · ✅ #4 · 🔧 F4/#3 | probe #20–23 · protocol 5–6 |
| Wallet top-up | إنشاء → `pending` · self-approve RPC → `admin only` · تحديث مباشر → مرفوض · anon → محجوب | ✅ | probe #11–14 · #31 |
| Chat/messages | XSS · auth على وصول المحادثة · rate limit 429 · injection · هوية المتصل في edge function (X2) · `x-forwarded-for` (X3) | 📐 ( builders + صفر markdown ) · ⚠️ X2/X3 مفتوحة | findings X2/X3 — **بلا اختبار حيّ** |
| Reviews | review على غيره · XSS | 📐 (سياسات `insert_own` موثّقة) · ➖ لا استغلال حيّ | — |
| Search/filters | SQL injection عبر params | 📐 **صفر ديناميك SQL في 82 إجراء** + فلترة `.or()` مُنظَّمة | findings #14 |
| Admin | 4 admin RPCs كمستخدم عادي → كلها مرفوضة · anon → محجوب · `platform_settings` → محجوب | ✅ | probe #8–10 · #31–33 |
| SaaS (plans/promos/orders) | `purchase_plan(trial)` → `invalid_payment_method` · خطط الأسعار للمستخدم وanon → 4 صفوف · `purchase_promo` بمетод مجهول → **يُقبل** (#5a) | ✅ · 🔧 #13 · ⚠️ **#5a مفتوح ومكتشف** | probe #6 · #24–25 · #26 |
| Storage/upload | MIME/extension (`.html`/`.svg`) · تعداد `.list()` عبر المستخدمين · تجاوز مجلد الغير · cross-user overwrite | 🔧 F2/F3/F12/#1 · ✅ مجلدي + anon | probe #20–23 · protocol 4–6 |
| Platform | `npm audit` · rate limit (#7) · unbounded queries (DoS) · CSP/frame-ancestors/HSTS (HDR-1..4) · توكن `.env.server` (X8) | ✅ audit = 0 ثغرة · ⚠️ #7 · 📐 DoS (limits موجودة) · ⚠️ HDR/X8 يدوي | P2 · findings HDR/X8 |

**ما لم يُختبَر حيًّا (صريح في التسليم):** reset-token · brute bound · XSS مخزّن فعلي في العنوان/الوصف · rate limit 429 للمحادثات · سباق `#5b`/`#6b` التوقيتي (يحتاج ضغط تزامني — خارج قيد «بلا فلود») · TOCTOU على الكريدت.

## Definition of done
- [x] كل ثغرة: مُصلَّحة ومُختبَرة (F1/F2/F3/F4/F12/#1/#2/#3/#4/#13)، أو موثّقة كـ risk مفتوح بقرار مقبول (F5/F6/F7/F8/F10/F11/X2/X3/X8/HDR/#5/#6/#7–#12)
- [x] `npm run build` ناجح · leak scan = 0 · بدون force push
- [ ] رفع على Railway + Pages وتحقق بالمتصفح (لوجو/هيدر/تدفق أساسي) — **بانتظار إذن منفصل**
- [ ] `SECURITY_AUDIT.md` جاهز للتسليم

## تنظيم جذر `B:\badal` (2026-10-27 — بطلب المستخدم، «بدون كسر أي حاجة»)
**القاعدة اللي اتبنّت:** ما نلمسش `ui-prototype/` إطلاقًا (قرار المستخدم: إعادة هيكلته مؤجّلة) + الـ 3 فحوصات كانت شغّالة جوّاه.

| قبل | بعد |
|---|---|
| ~100 عنصر مبعثر في الجذر | **36 عنصر** (23 ملف + 13 مجلد) |
| 26 سكريبت `.mjs` في الجذر | `scripts/` (27 مع الموجود) عبر **`git mv`** → 26 rename محفوظ التاريخ |
| 36 صورة/PDF (4.44MB) في الجذر | `shots/` |

**التحقق بعد التنظيم:**
- `git status` = 26 rename مُ staged + `.gitignore` معدَّل + `?? tasks/security-pass.md` فقط.
- **عقد النشر سليم ولم يُمسّ:** `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig*`, `components.json`, `railway.json`, `.github/workflows/pages.yml` — كلها `tracked` و`clean`. `src/` و`public/` و`ui-prototype/` = صفر تغييرات.
- `node --check scripts/bayna-rls-check.mjs` = 0 (السكريبتات لسه صالحة).
- **`npm ci && npm run build` = 0** بعد التنظيم (محاكاة CI).

**تعديل `.gitignore` (ضروري — من غيره كان هيكسر النشر):**
- `/shots/` → القواعد المُرساة `/*.png` بتحمي ملفات الجذر بس؛ بعد النقل الملفات كانت هتبان `untracked` و**`railway up` كان هيرفع 4.44MB صور** (نفس عائلة حادثة اللوجو السابقة).
- `/OFFLINE-DEMO/` → جعل قاعدة «مرفوض من الرفع» دائمة بدل ما يفضل `??` ويتدخل `git add -A`.

**ملاحظات متبقّية (غير مُنفَّذة، بانتظار إذن):** رفع التغييرات يتم من `om-tree` فقط (الـ hook بيرفض `B:\badal` → origin ما دام `ui-prototype/` في الشجرة) · `tasks/security-pass.md` لسه untracked.

---

## Findings log
(يتم تعبئته أثناء P1–P3 — الجدول: ID | الخطورة | المنطقة | file:line | الهجوم | الحالة)

### P1 — فحص ثابت: RLS / storage / تصعيد صلاحيات (مكتمل — subagent #2)
| ID | الخطورة | المنطقة | file:line | الهجوم | الحالة |
|---|---|---|---|---|---|
| F1 | 🔴 High | `listing_requests` INSERT | `0001:307-318` / `0012:58-71` / `0022:189-190` | الـ WITH CHECK ما بيمنعش `status`/`paid_at` → المستخدم يدراج طلب **accepted** على أي listing منشور → يفتح `get_payment_instructions` ويسرق **واتساب/اسم المحفظة/الاينستا** المالك، ويدرس review 1★، ويفتح escrow. قفل `0022` كان على UPDATE بس (INSERT لسه بـ grant كامل) | ✅ **مصلَّح بـ0026 + مختبَر (بروتوكول 1–2)** |
| F2 | 🔴 High | storage `payment-qr` | `0022:206-216` (يستبدل `0017:436-444`) | سياسة جديدة **بلا mimetype** وبشرط `or folder='badal-platform'` → أي مستخدم مسجّل يرفع `.html`/`.svg` في بادئة الأدمن. السياسات permissive بتتـOR فيتجاهل فحص MIME كله. + كسر رفع سكرين شوت الاشتراك | ✅ **مصلَّح بـ0026 + مختبَر (بروتوكول 5)** |
| F3 | 🟠 Med-High | bucket `payment-qr` = public | `0004:47-49, 82-86` | `list()` بدون تسجيل دخول → تعداد كل مستخدم وتنزيل كل إيصالات الشحن وQR | ✅ **مصلَّح بـ0026 + مختبَر (بروتوكول 4)** — الـbucket بقي public عمديًا لروابط الـQR |
| F4 | 🟠 Med-High | view `direct_payment_history` | `0025:76-90` | بدون `security_invoker` → صاحب الـ view يتجاوز RLS → dump كامل لكل من اتأكدت مدفوعاته (المعلَّق «RLS still applies» غلط) | ✅ **مصلَّح بـ0026 + مختبَر** |
| F5 | 🟡 Med | `banner_campaigns` INSERT | `0017:320-324` + `saas.ts:261-263` | المستخدم يدرج `status:'active'` بنفسه → تجاوز موافقة الأدمن والدفع (بدون مُصرِّح بنرات عام اليوم) | 🔴 مفتوح |
| F6 | 🟡 Med | revokes ناقصة | `0023` (الملف كامل) | قُصِر على 4 جداول؛ `authenticated` لسه ماسك INSERT/UPDATE/DELETE على كل جداول المال → RLS هو الحاجز الوحيد | 🟡 دفاعي |
| F7 | 🟡 Med | أعمدة client-writable | `0001:113-122`, `0001:157-166` | `listings.created_at/status` قابلة للتزوير (تخبّية العدّاد من الـ quota)، `listing_images.storage_path` **غير مُتحقَّق** → الإشارة لأي object عام تبع غيرك | 🔴 مفتوح |
| F8 | 🟡 Med | `profiles` | `0012:8-9` + `0003:154-156` | أي مستخدم مسجّل يقرأ `role`/`is_banned` لكل الحسابات (كشف roster الأدمن) | 🟡 قراءة فقط |
| F9 | 🟢 Low | anon capabilities | متعدّد | anon يقدر يقرأ: listings منشور + reviews + 6 أعمدة profiles + الخبطة العامة. **ما يقدرش** يكتب أي جدول ولا ينادي أي money RPC | ✅ موثّق |
| F10 | 🟢 Low | `SECURITY DEFINER` مكشوف | `0001/0003/0006/0014` | مفيش `revoke ... from public` على trigger helpers + 4 messaging RPCs + 5 admin RPCs → كلها بتفشل بأمان بس `handle_new_user()` نمط خطير | 🟡 هيجين |
| F11 | 🟢 Low | messaging | `0014:86-137` | أي مستخدم يفتح DM مع أي حد (بلا شرط listing مشترك) + بلا rate limit → سبام | 🟡 |
| F12 | ⚠️ وظيفي | 3 أعطال | `0025_fix:8-17`, `0022:206` | (1) المستخدم غير الأدمن ي拿到 "permission denied" في صفحة الأسعار، (2) رفع سكرين شوت الاشتراك **متوقف**، (3) خطر FK في `enforce_listing_quota` + `SUPABASE_RESULTS.md:82` بتشير لسياسة موجودة في الإنتاج مش في الـ migrations → **لازم ندوق `pg_policies` الحي مقابل الملفات** | ✅ (1)+(2) **مصلَّحان بـ0026 ومختبَران (بروتوكول 6,8)** · (3) **تحققت**: كل سياسات `storage.objects` الحيّة مطابقة للملفات (نُوقعت 2026-10-27) |

**قائمة المقفل بالتصميم (تُذكر في تقرير التسليم):** `platform_settings` (grant مسحوب)، `wallet_balances`/`wallet_transactions`/`escrow_holds` (صفر سياسات كتابة → RPC بس)، كل جداول المال (SELECT ملكي بس)، `conversations`/`messages` (RPC بس)، `pricing_plans` (كل الكتابة مسحوبة)، `profiles` privilege columns (قفل بـ 3 طبقات + trigger)، و **17 admin RPC كلها بتفتش `has_min_role` و`admin_set_user_role` مقيّدة بـ rank ceiling → مفيش self-grant path**.

---

### P1 — فحص ثابت: frontend XSS / chat / uploads (مكتمل — subagent #3)
| ID | الخطورة | المنطقة | file:line | الهجوم | الحالة |
|---|---|---|---|---|---|
| X1 | 🔴 High | سلسلة رفع → XSS مخزّن | `api.ts:935-944`, `saas.ts:170-175`, `api.ts:865` + `0022:206-216` | نفس جذر F2: الامتداد من `file.name` والفحص client-only → رفع `proof.html` ثم الأدمن يضغط «عرض» (`admin.tsx:1389-1395, 1499-1503`) → تنفيذ HTML **على أصل `*.supabase.co`** (اللي بيستضيف `/rest/v1` و`/auth/v1`) | 🔴 = F2 |
| X2 | 🟡 Med | chat edge function | `index.ts:624-628` | **مفيش تحقق من هوية المتصل أصلًا** — الـ anon key كافي → أي حد يحرق كوota Gemini. الطلب الواحد بيوصل لـ `3 rounds × 6 models × 2 modes` | 🔴 مفتوح |
| X3 | 🟡 Med | rate limiter | `index.ts:635-643` | يثق بـ `x-forwarded-for` (هيدر Netlify مش مضمون) → تدوير القيمة يتجاوز الحد 10/دقيقة. ولو مفيش الهيدر → **الكل بيتحط في bucket واحد "unknown"** → widget بيموت بنفسه | 🔴 مفتوح |
| X4 | 🟡 Med | رفع client-only | `supabase.ts:118-130` | `topup.tsx` وحده بيعمل فحص؛ `saas.ts` مش بيبعت `contentType` أصلًا | 🟡 |
| X5 | 🟡 Med | clickjacking | `index.html:9-14` | **`frame-ancestors` بيتجاهل داخل `<meta>`** + Railway `serve` بلا هيدرز + Pages **ما بترفعش headers أصلًا** → `/topup` و`/requests` و`/auth` تقدر تتـiframe | 🔴 = HDR-1/2 |
| X6 | 🟡→🟢 | DoS بسيط | `index.ts:628-631`, `545-549` | chunked body بيتخطى حد الـ 50KB (القراءة بتحصل قبل الـ caps)، و`INFO_TOPICS[topic]` قراءة prototype chain (بدون تنفيذ) | 🟡 |
| X7 | 🟢 Low | avatar raw | `api.ts:879-883`, `messages.tsx:126-131` | `avatar_url` بيتحط في `<img src>` مباشرة → النهارده **الـ CSP هو المانع الوحيد** (`img-src 'self' data: blob: https://*.supabase.co`) | 🟡 |
| X8 | 🔵 Info | سرّية | `.env.server` (untracked) | **ملف على الدسك فيه `sb_secret_` + باسورد قاعدة البيانات + باسورد أدمن حقيقي** — مش داخل الـ bundle ولا الـ git، بس ده أغلى ملف على الجهاز → تدوير + secret store | 🟠 إجراء |
| X9 | 🟢 Low | جلسة localStorage | `supabase.ts:17-24` | أي XSS مستقبلي = سرقة جلسة كاملة (بما فيها أدمن) — النهارده theoretical | 🟡 |

**نظيف وموثّق (يبان في تقرير التسليم):** صفر `dangerouslySetInnerHTML`/`eval`/`new Function`/`document.write` · صفر مكتبة markdown · صفر `<iframe>`/`window.open`/`postMessage`/`document.cookie` · `target="_blank"` مرتين **وكلهم `rel="noreferrer"`** · صفر open redirect (كل `URLSearchParams` بيتبني من حالة محلية) · صفر SSRF (الـ fetch الوحيد لعنوان ثابت من allowlist) · **صفر CSRF** (الجلسة بـ Authorization header مش كوكيز) · SQL عبر builders بس + فلترة `.or()` مُنظَّمة · CORS allowlist مش `*` · صفر سرّ في الـ bundle · إرجاع الأخطاء بنصوص عربية ثابتة.

---

### P1 — فحص ثابت: طبقة المال / RPCs / escrow (مكتمل — subagent #4)
| ID | الخطورة | المنطقة | file:line | الهجوم | الحالة |
|---|---|---|---|---|---|
| #1 | 🔴 High | `payment_qr_subshot_insert` | `0022:206-216` | **نفس جذر F2/X1** (يوريد الفحص) + يكسر رفع سكرين شوت الاشتراك | ✅ **مصلَّح بـ0026 + مختبَر (بروتوكول 6)** |
| #2 | 🔴 High | `wallet_escrow_pay(uuid,numeric)` | `0021:29-93` (grant `:96`) | **البائع/المشتري يبعت المبلغ من الكلاينت** — مفيش مقارنة بـ `listings.sale_price` → المشتري ينادي `p_amount=1` على إعلان 10,000 → حجز 1 جنيه، وواجهة البائع تعرض **سعر الإعلان** (9,500) فيضغط release فيستلم 0.95. النسخة المُصلَّحة `escrow_pay_external` (`0022:60-89`) بتعيد احتساب السعر من السيرفر ✅ — يعني `wallet_escrow_pay` المفروض **تتشال** | ✅ **حُذفت بـ0026 + مختبَر (بروتوكول 3)** — وأُزيلت الدالة الميتة `escrowPay()` من `api.ts` |
| #3 | 🔴 High | view `direct_payment_history` | `0025:76-90` | **نفس F4** — مؤكد حيًّا بـ HTTP 200 + سجلات حقيقية | ✅ **مصلَّح بـ0026** |
| #4 | 🟠 Med-High | bucket `payment-qr` public | `0004:47-49, 82-86` | **نفس F3** — مؤكد حيًّا بالتعداد | ✅ **مصلَّح بـ0026** (الـSELECT مُنطَّق · الـbucket بقي public لروابط الـQR) |
| #5 | 🟡 Med | `purchase_promo` | `0017:101-165` | (أ) مفيش whitelist لـ `p_payment_method` → يقبل `'trial'` · (ب) **TOCTOU** على الكريدت: قراءة بلا `FOR UPDATE` → 10 طلبات متوازية على باقة 3 كريدت → `promo_credits_remaining = -7` و**10 بانرات active مجانًا** | 🔴 مفتوح |
| #6 | 🟡 Med | `consume_listing_quota` | `0017:465-540` | (أ) **IDOR**: فرع الـ idempotent `exists ... where listing_id = p_listing_id` **بلا `user_id`** (`:489`) → حساب B ينادي بوحة حساب A فيتقاّص عدّاد A ويُصدر إعلان B مجانًا · (ب) سباق count→insert → تجاوز الـ quota | 🔴 مفتوح |
| #7 | 🟡 Med (إساءة) | `create_wallet_topup` | `0018:38-70` + `0020:7-38` | مفيش rate limit ولا dedup → سكربت ينادي بلا نهاية → صف لكل طلب **+ إشعار لكل أدمن** → طغيان طابور المراجعة | 🔴 مفتوح |
| #8 | 🟡→🟢 | اعتماد الشحن بلا ledger | `0018:195-201` | `balance += amount` **بلا صف `wallet_transactions`** (عكس `admin_fund_wallet` `0007:402`) → محفظة ≠ تاريخ → يُشبه العبث ولا يُصلَّح للتدقيق | 🟡 |
| #9 | 🟢 Low | `wallet_escrow_release` | `0021:118-130` | الرصيد `+net` بس الدفتر يكتب `+net` **و`-fee`** → الدفتر يقلّ 5 جنيهات عن الرصيد في كل release (نفس الشي في `0007:270-282`) | 🟡 |
| #10 | 🟢 Low | `admin_review_subscription_order` | `0017:263-289` | **بلا `FOR UPDATE`** (الاستثناء عن كل الإجراءات التانية) → نقرة مزدوجة = اشتراكين + كريدتين لدفعة واحدة | 🟡 |
| #11 | 🟢 Low | `admin_confirm_external_payment` | `0022:128` | `has_min_role('moderator')` كافي → مُشرِف واحد مخترق يحوّل ادّعاء غير مدفوع إلى `held` ثم release → **سبك رصيد من العدم**. مفيش حقل دليل ولا موافق ثانٍ | 🟡 |
| #12 | 🟢 Low | `get_my_payment_profile` | `0012:32` | مفيش `revoke ... from public` → anon يناديه (يرجع 0 صفوف). **وكل الـ 5 admin RPCs في `0003:460-464` + الـ 6 في `0017` بنفس الشكل** — آمنة اليوم لأن جسم كل واحدة بيبدأ `has_min_role(...)`، بس **ناقصة revoke واحدة عن تكون حرجة** | 🟡 |
| #13 | ⚠️ وظيفي | `pricing_plans` | `0025_fix:5-17` | نفس F12: المستخدم المسجّل غير الأدمن ياخد 0 صفوف في صفحة الأسعار (fail-closed) | ✅ **مصلَّح بـ0026 + مختبَر (بروتوكول 8)** |

**قائمة #14 — المُصلَّح بالتصميم (تُذكر في التسليم):** كل جداول المال بـ SELECT-own فقط · صفر ديناميك SQL في الـ 82 إجراء · **كل `SECURITY DEFINER` فيها `set search_path` (0 استثناء)** · `get_wallet_balance` بيتجاهل `p_user_id` (لا IDOR) · release/refund/confirm كلها `FOR UPDATE` + حارس `status` (لا double-release) · `escrow_holds.request_id` unique · تصعيد الدور مسدود بـ 3 طبقات · `escrow_pay_external` بيعيد احتساب السعر من السيرفر · `confirm_direct_payment` ميت فعليًا (revoked من الثلاث + الجسم raise) · المشتري **ما يقدرش** يطلب refund بنفسه · `deposit` عرض كلاينت فقط (لا يُرسَل لأي RPC).

**تغطية الاختبارات:** ✅ **مُنفَّذ (P5)** — `scripts/bayna-security-probe.mjs` أُعيدت كتابتها لتغطي **#2 · #2b · #5a · #6a · #13 · F1 · F2 · F3 · F4** إضافة للفحوصات القديمة. آخر تشغيل: **29 PASS / 0 FAIL / 2 OPEN** (`#5a` و`#6a` = الثغرتان المفتوحتان الموثّقتان، تظهران `OPEN` عمدًا لا `FAIL`). التنظيف مُتحقَّق منه: صفر صفوف أو ملفات متبقّية من التشغيل.

---

### P2 — npm audit (مكتمل 2026-10-27)
| ID | الخطورة | المنطقة | الدليل | الهجوم | الحالة |
|---|---|---|---|---|---|
| DEP-1 | high | تبعيات dev | `body-parser@2.3.0` عبر `shadcn@4.21.5` | DoS عبر trailing bytes بعد compressed body (GHSA-27r3-jxmh-p828) — يلزم تشغيل express خلف التطبيق | ✅ **مصلَّحة** |
| DEP-2 | high | تبعيات dev | `zod@3.25.76` عبر `shadcn@4.21.5` | عبر `shadcn` CLI فقط | ✅ **مصلَّحة** |
| DEP-3 | moderate ×3 | تبعيات dev | `fast-uri@3.1.8` عبر `shadcn → @modelcontextprotocol/sdk → ajv` | URI scheme/host spoofing | ✅ **مصلَّحة** |

### P2 — هيدرز الإنتاج الحي (فحص 2026-10-27)
| ID | الخطورة | المنطقة | الدليل | الهجوم | الحالة |
|---|---|---|---|---|---|
| HDR-1 | Medium | `front-end-production-d6a1.up.railway.app` | مفيش `Content-Security-Policy` على مستوى HTTP — موجود فقط `<meta http-equiv>` | meta-CSP تُطبَّق متأخر و**تجاهل `frame-ancestors` تمامًا** حسب المواصفات | 🔴 مفتوح |
| HDR-2 | Medium |同上 | مفيش `X-Frame-Options` ولا `frame-ancestors` | clickjacking: تطبيقات تانية تقدر تحمّل الموقع داخل iframe وتخدش النقر | 🔴 مفتوح |
| HDR-3 | Low |同上 | مفيش `Strict-Transport-Security` | downgrade/SSL-stripping على أول اتصال | 🟡 مفتوح |
| HDR-4 | Low |同上 | مفيش `Permissions-Policy` | الكاميرا/الميكروفون/Geolocation متاحة افتراضيًا | 🟡 مفتوح |
| HDR-5 | ✅ |同上 | `x-content-type-options: nosniff` موجود من السيرفر | — | 🟢 سليم |
| HDR-6 | ✅ | Supabase REST | `HSTS max-age=31536000; includeSubDomains; preload` + `nosniff` | — | 🟢 سليم |

> **تم التأكيد ثابتًا (subagent#3 = X5):** `index.html:9-14` بيعلن CSP/XCTO/Referrer بس في `<meta>`؛ `railway.json:8` بيشغّل `npx serve@18 dist -s` **بلا أي إعداد هيدرز** (مفيش `serve.json` في الريبو)؛ وGitHub Pages **ما بترفعش هيدرز أصلًا**. ⇒ مفيش `frame-ancestors` فعلي → الـ clickjacking مفتوح على `/topup` و`/requests` و`/auth`.
> خطة الإصلاح: ضيف `serve.json` بـ headers لـ Railway، واقبل إن Pages هيفضل بلا هيدرز (أو حوّل التوزيع لـ Railway فقط) + ضيف `Permissions-Policy` و`COOP`.

**خلاصة P2 — الاعتمادات:** `npm audit --omit=dev` = **0 ثغرات قبل الإصلاح وبعده** → الإنتاج نظيف.
الثلاثي كله تحت `shadcn@4.21.5` (devDependency = CLI توليد كومبوننتس، لا يدخل الـ bundle إطلاقًا). فرق العدّاد («3 حزم» مقابل «5 إعلانات») = `npm` بيعدّ الـ advisories مش الحزم.

**تطبيق الإصلاح والتحقق (2026-10-27):**
- نفّذت `npm audit fix` **بدون `--force`** → `package.json` **لم يتغيّر** (hash `f0265f9…` مطابق)، `package-lock.json` وحده اتحدّث (`6d068b5…` → `882c08d…`، 6 حزم).
- التحقق: `npm audit` = **0** · `npm audit --omit=dev` = **0** · `npm ls --depth=0` exit=0 · `npm run build` = **0** (`✓ built in 7.84s`).
- تحقّق نهائي **تم في الخلفية ونجح**: محاكاة CI الحقيقية `npm ci && npm run build` من الـ lock الجديد → `npm ci` = **0** (يعني الـ lock متزامن مع `package.json`، غير كده `npm ci` بيفشل) · build = **0** (`✓ built in 6.52s`) · `npm audit --omit=dev` = **0**.

**Leak scan على الـ bundle المبني (`dist/`) — النتيجة: نظيف ✅**
| النمط | العدد في `dist/` |
|---|---|
| `service_role` / `SUPABASE_DB_PASSWORD` / `BOOTSTRAP_ADMIN` / `eyJhbGciOi` | **0 / 0 / 0 / 0** |
| نصوص JWT بشكل `hdr.payload.sig` | **0** |
| `sb_secret_` | 1 → داخل `fj=r=>r.startsWith("sb_publishable_")\|\|r.startsWith("sb_secret_")` = **الـ SDK بيرفض المفتاح السري في المتصفح** (دالة تحقّق، مش قيمة) |
| **القيم الحقيقية التسعة من `.env.server`** (مطابقة حرفية بـ `-SimpleMatch`) | **0 تسريب** |

> ملاحظة: `sb_publishable_`/`VITE_SUPABASE_ANON_KEY` موجودين في الـ bundle **بالتصميم** (مفتاح عام) — ده مش تسريب. التسريب الحقيقي = `sb_secret_` + JWT + باسورد القاعدة + باسورد الأدمن → كلها صفر.

---

### P4 — تطبيق `0026_batch1_security_fixes.sql` على الإنتاج (مكتمل 2026-10-27)

**الأمر:** «اكمل كل ما لم يطبق» = إذن بتطبيق `0026` (الكتابة كانت معتمدة مسبقًا، التفعيل كان المؤجَّل).

**الأداة:** `scripts/bayna-apply-0026.mjs` (جديدة — سبب وجودها أن `bayna-apply-migrations.mjs` تعيد 0001–0023 ولا تعرف 0024/0025/0026). الأنماط: `--check` (قراءة فقط) · بدون أعلام (تطبيق) · `--post` (تحقق فقط). تستورد `pg` من `ui-prototype/node_modules` (الجذر بلا `pg`) وتحمّل البيئة من `ui-prototype/.env.server`.

**الفحص المسبق أكد أن كل ثغرة كانت حيّة فعلًا:**
| ما قبل | الدليل |
|---|---|
| F1 مفتوح | أعمدة INSERT الممنوحة لـ`authenticated` = **14 عمودًا** تشمل `paid_at`, `payer_confirmed_at`, `payee_confirmed_at`, `id`, `created_at` |
| #2 مفتوح | `wallet_escrow_pay(uuid,numeric)` موجودة |
| F2/#1/F12 مفتوحة | `payment_qr_subshot_insert` بلا شرط ملكية الطلب وبلا MIME |
| F3 مفتوح | `payment_qr_public_read` غير مُنطَّقة |
| F4/#3 مفتوح | `direct_payment_history` = `(no options)` (بلا `security_invoker`) |
| F12/#13 مفتوح | `pricing_plans_select_active_auth` = **0 صفوف** |
| 0024 + 0025 مطبَّقان | `payout_status` موجود · `confirm_direct_payment` = الـ stub المُعتزل |

**النتيجة: 16/16 بعد التطبيق** (`node scripts/bayna-apply-0026.mjs --post` → exit 0):
- أعمدة INSERT = **9 أعمدة بالضبط** (قائمة `createRequest`) · `paid_at`/`id`/`created_at` → `42501 permission denied`
- `lock_request_insert` = trigger + function تفرض `status='pending'` و`paid_at=null` و`created_at=now()`
- `wallet_escrow_pay` = **0 صفوف** (حُذفت) · `escrow_pay_external` + `wallet_escrow_release` = callable
- `payment_qr_subshot_insert` = ملكية الطلب + MIME صور · `payment_qr_public_read` = `authenticated` + (مجلدي أو admin)
- `direct_payment_history` = `security_invoker=true` + SELECT لـ`authenticated` ومحجوب عن `anon`
- `pricing_plans_select_active_auth` = `is_active = true`
- الـbucket لسه `public` (روابط الـQR العمومية تشتغل)

**بروتوكول ما بعد التفعيل — 16/16** (`scripts/bayna-post-0026-protocol.mjs`):
| # | البند | النتيجة |
|---|---|---|
| 1 | INSERT بـ`status='accepted'` يهبط `pending` + `paid_at=null` | ✅ |
| 2 | INSERT بذكر `paid_at`/`id`/`created_at` → permission denied | ✅ (3/3 بـ42501) |
| 3 | `escrow_pay_external` + `wallet_escrow_release` ما زالا يُناديان | ✅ (يرفعان خطأ عمله الخاص لا خطأ صلاحيات) |
| 4 | `.list()` على `payment-qr` لا يعداد الغير | ✅ (مجلدي فقط · anon = 0) |
| 5 | رفع `.html` → 403 · `.jpg` → 200 | ✅ |
| 6 | subshot لطلب الغير → 403 · لطلبي → 200 | ✅ |
| 7 | روابط الـQR/الأفاتار العمومية تعمل | ✅ (HTTP 200 ×2) |
| 8 | مستخدم مسجّل غير أدمن يقرأ خطط الأسعار | ✅ (4 صفوف) |

**سلامة الإنتاج بعد الاختبار:** اختبارات 1–3 نُفِّذت داخل معاملة تُلغى دائمًا (صفر صفوف مُثبتة) · ملفات الرفع الأربعة حُذفت · طلب الاشتراك التجريبي حُذف · عدّاد `listing_requests` كما كان (6 accepted / 6 cancelled / 1 pending).

**نتيجة جانبية أُصلحت:** `escrowPay()` في `src/lib/api.ts` كانت تستدعي `wallet_escrow_pay` المحذوفة (كود ميت لم يستدعه أحد) → حُذفت من الشجرتين معًا (الشجرتان تبقيان متطابقتين حرفيًا) · `npm run build` = 0.
