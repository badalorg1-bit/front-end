# BADAL / Bayna — WORKFLOW (طريقة الشغل المعتمدة)

> مرجع مستخلَص من جلسة `badal.json` (15→25 أكتوبر 2026، 3269 رسالة، 139 أمر، 72 compaction).
> أي جلسة جديدة تمشي على القواعد دي. هذه ليست وثيقة منتج — هذه وثيقة **عمل**.

---

## 0. القاعدة الذهبية

**وثائق ← استطلاع ← تعديل ← بناء محلي ← فحص تسريبات ← push ← deploy ← تحقق بالمتصفح.**
ممنوع القفز على أي مرحلة. ممنوع الرفع قبل إذن صريح من المستخدم.

---

## 1. المراحل بالترتيب

| # | المرحلة | المخرج | القاعدة |
|---|---|---|---|
| 1 | **Discovery / Audit** | `ARCHITECTURE_ASSESSMENT.md` | قراءة فقط، لا كود |
| 2 | **Spec & Capability Map** | `SPEC.md`, `CAPABILITY_MAP.md` | إنجليزي دقيق للمصطلحات، عربي للمستخدم |
| 3 | **UI/UX Prototype** | Vite + React + Tailwind RTL | `frontend-design` + `frontend-ui-engineering` قبل أي CSS |
| 4 | **Real MVP** | ربط Supabase | `spec-driven-development` قبل بناء أي feature |
| 5 | **Feature waves** | دفع / OTP / باقات / شات بوت | موجة واحدة في المرة، تسليم واحد |
| 6 | **Security pass** | إغلاق ثغرات | `security-and-hardening` إجباري |
| 7 | **Pre-Delivery Audit** | تقرير | 3 subagents بالتوازي (backend / frontend / architecture) |
| 8 | **Ship** | GitHub → Railway → Supabase | القسم 6 أدناه |

---

## 2. Skills (تحميل إجباري قبل الشغل)

الاستدعاء الأول في أي جلسة: **`using-agent-skills`**.

| قبل أي شغل في… | Skill |
|---|---|
| أي feature جديدة | `spec-driven-development`, `planning-and-task-breakdown` |
| أي واجهة / CSS / layout | `frontend-design`, `frontend-ui-engineering` |
| أي endpoint / interface | `api-and-interface-design` |
| أي تعديل auth أو input أو secret | `security-and-hardening` |
| كتابة/فحص test | `test-driven-development` |
| الاعتماد على توثيق خارجي | `source-driven-development` |
| قرار متردد | `doubt-driven-development` |
| مراجعة/تبسيط كود | `code-review-and-quality`, `code-simplification` |
| أي browser automation | `browser-automation-guard` (أوامر إذن قبل أي فعل خارجي) |
| git / commit / branch | `git-workflow-and-versioning` |
| فحص بناء/رفع نهائي | `shipping-and-launch` |

> كل استدعاء لازم يرجع `completed`. لو skill رجعت failed → وقّف وحلّها قبل ما تكمل.

---

## 3. أسلوب العمل بالأدوات

**الترتيب الافتراضي:**
`glob`/`grep` (لأين أنا) → `read` (إيه المحتوى) → `skill` (القاعدة) → `edit`/`write` → `bash` (verify).

**ممنوع:**
- كتابة كود قبل `read` للملف المتأثر.
- `edit` على مخرجات لم تُقرأ.
- افتراض وجود ملف/دالة بدون `grep`.

**الاستطلاع بالتوازي (subagents):**
- استخدم `task` لاستطلاع READ-ONLY فقط. لا تنفيذ في subagent.
- شغّل 2–3 بالتوازي لما تكون مجالات مستقلة (backend / frontend / architecture).
- لو تقرير اتقص → استرجعه بـ task جديدة طالبة "النتيجة الكاملة كرسالة واحدة".

**التخطيط:** `todowrite` عند بداية أي مهمة متعددة الخطوات، وحدّثها بعد كل خطوة.

---

## 4. التعديل (edit discipline)

- `oldString` لازم يكون **فريدًا**؛ لو مش فريد ضيف سياق بدل `replaceAll`.
- صف واحد تغيير في المرة لو ممكن.
- لا تترك dead code ولا تعليقات كود.
- الاحتفاظ بنمط المشروع: نفس الأسماء، نفس المسافات، نفس الحجم.

---

## 5. فحص الإيقاف المتكرر (Resume protocol)

بعد كل compaction أو كل استئناف، المستخدم بيبعت:
> **«اكمل من حيث توقفت دون مشاكل التكرار»**

الاستجابة الصحيحة:
1. اقرأ `todowrite` الحالية.
2. `git status` + `git diff --stat` لتشوف اللي اتعمل.
3. اذكر آخر إنجاز + الخطوة الجاية في سطرين.
4. كمّل من **نقطة** التوقف — لا تعيد خطوة خلصت، لا تضاعف تعديل.
5. لو هتعدّل ملف اتعدّل قبل كده → تأكد إنهانوسع منسوخ/ناقص مش مكرر.

---

## 6. مسار النشر (Ship path) — ⚠️ الأهم

```
[0] تأكد إن الشغل محلي خلص
      npm run build            # لازم ينجح من غير error
[1] فحص التسريبات (إجباري قبل أي commit)
      git grep -nE "(eyJ[A-Za-z0-9_-]{30,}|sbp_[A-Za-z0-9]{10,}|sb_publishable_|ghp_[A-Za-z0-9]{20,}|postgresql://postgres:)"
      # لازم يرجع صفر نتيجة. لو رجع حاجة → انضف قبل ما تكمل.
[2] commit برسالة وصفية
      git add <مسارات محددة>    # لا تستخدم `git add .` أعمى
      git commit -m "type(scope): وصف"
[3] push بدون force أبداً
      git fetch origin
      git merge origin/main     # أو rebase — لا تكرّر تاريخ
      git push origin main      # ❌ ممنوع --force في أي حال
[4] Railway
      railway up                # لينك GitHub مع Railway ممكن يكون منقطع
      # تحقق: railway status / افتح deployment ويقول SUCCESS
[5] Supabase migrations (لو فيه)
      curl Supabase Management API  →  HTTP 201 = APPLIED
      # r.verify كل migration بعد التطبيق
[6] تحقق بالمتصفح (Playwright)
      افتح الموقع → title + اللوجو + الـ header + تدفق أساسي
      لو حاجة مش ظاهرة → رجع لـ [1] مش تكمل.
```

### قواعد الرفع الصارمة
- ❌ **ممنوع force push** مهما حصل.
- ❌ **ممنوع رفع قبل إذن صريح** («ارفع» / «go» / «يلا»).
- ❌ **ممنوع رفع سر** أبدًا — `.env*` خارج الـ repo.
- ✅ الخلفية النظيفة تتسجّل قبل أي عملية كبيرة: `B:\badal-backup-*`.
- ✅ لو تاريخ محلي غير مترابط مع `origin/main` → ابنِ commits **فوق `origin/main`** في worktree مؤقت وارفعها fast-forward. لا تفرض المحلي.

---

## 7. بيئة التشغيل

| العنصر | القيمة |
|---|---|
| مجلد الشغل | `B:\badal` (الكود تحت `B:\badal\ui-prototype`) |
| Repo | `github.com/badalorg1-bit/front-end` |
| Railway | مشروع `badal-front` / خدمة `front-end` |
| Supabase | مشروع `havpresypsvxevwwkjis` (eu-west-1) |
| أوامر DB | Management API عبر `curl.exe` (**مش** `Invoke-RestMethod` — ده يرجّع 400) |
| أوراقيات محلية | `C:\Users\Twins-Store\AppData\Local\Temp\opencode\` |
| Backup نظيف | `B:\badal-backup-20261024\ui-prototype` |

**بدائل الجلب:** لو أداة webfetch فشلت → `exa_web_fetch_exa`.
**Playwright** للاختبار الحي فقط — لا يُستبدل به الفحص اليدوي لما يكون الهدف auth/flow حساس.

---

## 8. أوامر المستخدم الحقيقية (قاموس)

| العبارة | المعنى |
|---|---|
| «اكمل من حيث توقفت دون مشاكل التكرار» | استئناف من نقطة التوقف، لا تكرار |
| «ارفع» / «go» / «يلا» / «ابدأ» | إذن تنفيذ/نشر —在此之前 لا رفع |
| «ما ترفعش حاجة غير لما أقولك» | تجميد كامل للنشر حتى إذن جديد |
| «اعمل فحص واعمل push عشان ريلاوي» | مسار القسم 6 كاملًا |
| «فين محكاة…» / «كده اي الي ناقص» | تقرير حالة صريح + قائمة ما تبقّى |
| «بالعربي» | ارجع عربي كاملًا في الرد |
| «دون مشاكل التكرار» | لا تعدّل نفس الشيء مرتين — تحقق أولًا |

---

## 9. سجل القرارات (Architectural decisions مثبّتة)

- **الاسم:** BADAL → **Bayna (بينا)** — أزرق، خط Tajawal، اللوجو الرسمي في `public/`.
- **الstack:** React 19 + Vite 7 + TypeScript + Tailwind 4 + Supabase (RTL عربي أولًا).
- **الدفع:** لا بوابة تقليدية → QR محفظة/إنستا + نسبة خدمة تحددها الأدمن (افتراضي 5%).
- **الصلاحيات:** الدفع الحقيقي يمر بـ `postgres` + `service_role` فقط — `anon`/`authenticated` مرفوضون على `EXECUTE`.
- **الـ RPC القديمة:** تم تقاعدها بـ migration بدل حذفها (stub مرفوض).
- **العرض:** نسخة أوفلاين منفصلة (`OFFLINE-DEMO/`) لجهاز بلا نت.

---

## 10. قائمة تحقق قبل كل تسليم

- [ ] `npm run build` نجح
- [ ] `git grep` التسريبات = صفر
- [ ] لا ملفات `.env` مُضافة
- [ ] مفيش `force` في أي push
- [ ] لو فيه migration → اتأكد `APPLIED` في الإنتاج
- [ ] افتح الموقع بالمتصفح وتأكد: **اللوجو + الـ header + title + التدفق الأساسي**
- [ ] رجّعت الرد بالعربي لو المستخدم طلب
