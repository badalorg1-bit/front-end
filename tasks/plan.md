# Implementation Plan: BADAL Gemini Chatbot (online)

## Overview
بناء شات بوت عربي بالذكاء الاصطناعي (Gemini) لمنصة بدّال: Edge Function على Supabase (`supabase/functions/chat`) تتولى نداء Gemini مع أدوات محدّدة والسلّم المتدرّج (مطابقة المدة → منتجات مرتبطة → تحويل خارج النطاق)، + ودجت عائم RTL في الواجهة متاح للكل (زائر مسجّل) مع كروت منتجات حقيقية من الـ DB. المرجع: `B:\badal\SPEC-chatbot.md` (معتمد).

## Architecture Decisions
- **A1 — مفتاح Gemini في Supabase secrets فقط**، الدالة وحدها تتصل بـ `generativelanguage.googleapis.com` (الواجهة لا ترى المفتاح أبدًا).
- **A2 — السلّم server-side**: دالة `search_products` تنفّذ tier1 (كل الفلاتر) → tier2 (بدون rental_unit) → tier3 (فارغ) داخل نفسها؛ النموذج يركّب النص فقط، ومصفوفة `products` تأتي من صفوف DB فعلية (LIMIT 8) لا من النموذج.
- **A3 — منع حقن التعليمات**: system prompt يعامل نصوص المستخدم/السجل كبيانات؛ allowlist للأدوات الثلاث + تحقق enums سيرفر-side؛ مفيش تعديل على الـ schema/RLS إطلاقًا.
- **A4 — بحث المفاتيح في-memory** بعد جلب فلاتر eq (LIMIT 200) لتفادي كسر صيغة PostgREST `or=` بأقواس/فواصل من المستخدم + تطبيع عربي بسيط (أ/إ/آ→ا، ة→ه، ى→ي، إزالة التشكيل).
- **A5 — مجلد العمل**: `B:\badal\ui-prototype` (المصدر المعتمد، الـ src فيه مطابق للـ clone)؛ الرفع لـ GitHub لاحقًا عبر `Temp\opencode\front-end` (يحتاج `gh auth login` من المستخدم).
- **A6 — بوابة الجودة**: لا يوجد test framework ولا Deno/CLI مثبت → `npm run build` + checklist curl بعد النشر + فحص `grep` للمفتاح في dist + معاينة Playwright للودجت.
- **A7 — الأدوات**: `search_products` / `list_categories` / `list_platform_info` — لا أدوات كتابة إطلاقًا (read-only).
- **A8 — rate limit** in-memory أفضل-م-than-nothing: 10 رسالة/دقيقة/IP.

## Task List

### Phase 1: الأساس (Edge Function)
- [ ] Task 1: `supabase/functions/chat/index.ts` — CORS، validation، rate-limit، Gemini tool-loop، الأدوات الثلاث، السلّم المتدرّج، شكل الاستجابة.
- [ ] Task 2: `.env.chat.local` (placeholders فقط، مغطى أصلًا بـ `.gitignore`) + تأكيد عدم وجود المفتاح في أي ملف بالمشروع.

### Checkpoint: Foundation
- [ ] الملفات مكتوبة، `git grep`/بحث محلي يؤكد 0 للمفتاح، جاهز للنشر.

### Phase 2: الواجهة
- [ ] Task 3: `src/lib/chat.ts` — types (`ChatResponse`/`ChatProduct`) + `postChat()` (Authorization: Bearer anon + apikey) + سجل sessionStorage ≤10.
- [ ] Task 4: `src/components/chat/ChatWidget.tsx` + `ChatPanel.tsx` — RTL floating، greeting، quick chips، كروت منتجات، حالات loading/empty/error/rate-limited، موبايل.
- [ ] Task 5: تركيب `ChatWidget` في `src/App.tsx`.

### Checkpoint: UI
- [ ] `npm run build` ينجح + الودجت يظهر في dev ويعرض error state بشكل سليم.

### Phase 3: النشر والتحقق
- [ ] Task 6: تثبيت Supabase CLI + `supabase login` (توكن من المستخدم) → set secrets (`GEMINI_API_KEY`, `ALLOWED_ORIGINS`) → deploy `chat`.
- [ ] Task 7: checklist curl (tier1/2/3 + حقن تعليمات + خارج النطاق) + تجربة حقيقية من الودجت في dev (رسالة فعلية + كروت).

### Checkpoint: Complete
- [ ] معايير نجاح SPEC-chatbot.md الخمسة مستوفاة؛ تقرير نهائي للمستخدم مع خطوة push (بانتظار GitHub auth).

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| تسريب مفتاح Gemini | High | secrets فقط + checklist grep في الملفات وdist |
| حقن تعليمات/خروج عن النطاق | High | system prompt "بيانات مش تعليمات" + ردّ تحويل ثابت + أدوات allowlist |
| كسر PostgREST برموز خاصة | Med | بحث in-memory بعد eq filters فقط |
| بدون CLI/Deno محليًا | Med | نشر عبر CLI بعد تثبيته أو fallback يدوي من Dashboard |
| رفض Gemini/404 endpoint | Med | التحقق من صيقة `generateContent` عند أول نداء + رسائل 502 واضحة |
| rate limit أفضل-من-لاشيء | Low | مقبول مؤقتًا (in-memory) |
| لا GitHub auth | Med | push في مهمة منفصلة يحتاج `gh auth login` |

## Open Questions
- طريقة الدخول لـ `supabase login` (توكن المستخدم) — يُحسم عند Task 6.
- سقف 10/دقيقة وكيفية تحديد الدومين في `ALLOWED_ORIGINS` (افتراضي: Railway + localhost) — افتراضات مؤقتة معتمدة ضمن "يلا".
