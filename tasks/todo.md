# TODO — BADAL Gemini Chatbot

## Phase 1: الأساس
- [x] Task 1: Edge Function `supabase/functions/chat/index.ts` (CORS, validation, rate-limit, Gemini loop, أدوات، سلّم)
  - AC: شكل `{reply, tier, products}` بالمواصفة؛ enums متحقق منها؛ products من DB بحد أقصى 8؛ rate 10/min؛ OPTIONS/POST؛ أخطاء 400/429/502.
  - Verify: مراجعة كود + لاحقًا curl checklist بعد النشر.
  - Files: `supabase/functions/chat/index.ts` (M)
- [x] Task 2: `.env.chat.local` + تنظيف أي أثر للمفتاح
  - AC: الملف يحتوي placeholders فقط؛ `Select-String` على المشروع = 0 للمفتاح.
  - Verify: grep.
  - Files: `.env.chat.local` (XS) — Dependencies: Task 1

### Checkpoint: Foundation ✅

## Phase 2: الواجهة
- [x] Task 3: `src/lib/chat.ts` (types + postChat + history sessionStorage ≤10)
  - AC: يرسل apikey+Authorization؛ يرمي أنواع أخطاء واضحة (rate-limited/other)؛ لا يخزّن مفتاحًا.
  - Verify: `npm run build`.
  - Dependencies: Task 1 — Files: `src/lib/chat.ts` (S)
- [x] Task 4: `ChatWidget.tsx` + `ChatPanel.tsx`
  - AC: زر عائم RTL + لوحة فيها greeting/quick chips/كروت منتجات بترتب على الإعلان + حالات loading/empty/error/429 + موبايل.
  - Verify: `npm run build` + معاينة dev.
  - Dependencies: Task 3 — Files: 2 (M)
- [x] Task 5: تركيب في `src/App.tsx`
  - AC: الودجت يظهر على كل الصفحات دون كسر الـ layout القائم.
  - Verify: `npm run build`.
  - Dependencies: Task 4 — Files: 1 (XS)

### Checkpoint: UI ✅

## Phase 3: النشر والتحقق
- [x] Task 6: تثبيت CLI + login + secrets + deploy
  - AC: الدالة منشورة وتردّ على POST.
  - Verify: curl واحدة ناجحة.
  - Dependencies: Tasks 1–5 — يحتاج توكن المستخدم (فاضل سؤال)
- [x] Task 7: checklist curl (tier1/2/3 + حقن + خارج النطاق) + تجربة الودجت فعليًا
  - AC: السيناريوهات الخمسة تردّ بالصيغة الصحيحة + screenshots.
  - Verify: قائمة SPEC-chatbot.md §Testing.
  - Dependencies: Task 6

### Checkpoint: Complete ✅

## Final Report — 2026-10-20
- All 7 tasks: ✅ complete
- Edge Function deployed: https://havpresypsvxevwwkjis.supabase.co/functions/v1/chat (v5, gemini fallback chain)
- curl suite: 6/6 pass (info, tier1, tier2, empty, off-topic, injection) — 2-5s each
- Browser E2E: ✅ open widget → send query → reply + product cards → click card → listing page loads (0 console errors)
- Remaining: `gh auth login` to push to GitHub → Railway auto-deploy to production
