# BADAL (بدّال) — Software Specification (Phase 1)

**Document type:** Normative specification (SRS companion to `badal.txt`)
**Status:** Stack **Approved** (owner directive — Laravel + React + TypeScript + Inertia.js + Tailwind CSS + shadcn/ui + PostgreSQL, ADR-013/ADR-014); document approval ≠ coding permission — Phase 2 / M0 still requires explicit owner go-ahead.
**Author:** OpenCode agent
**Date:** 2026-10-16
**Companion artifacts:** `ARCHITECTURE_ASSESSMENT.md` (evidence + verdict), `tasks/capability-map.md` (execution slices)

---

## 0. Source of truth, terminology, and document conventions

### 0.1 Requirements source

- The authoritative requirements source is **`B:\badal\badal.txt`** — Arabic Project Brief & SRS, 1,349 lines, owner-verified complete, owner-approved as source of truth.
- **Path discrepancy note:** the brief was originally expected at `docs/BADAL_PROJECT_BRIEF.txt`; that path **does not exist**. The complete document lives at the workspace root as `badal.txt`. If a `docs/` copy is later created, `badal.txt` remains canonical unless the owner re-points it.
- Brief section references in this document use the brief's own headings: Arabic ordinals (الثاني عشر … الثالث والعشرون) and numeric subsections (e.g., §7.3), with line numbers given where ambiguity is possible.

### 0.2 Language and terminology

Documents are English (owner decision D-f) with Arabic domain terms preserved. Core terms:

| Arabic | English term used here |
|---|---|
| حجز | booking |
| مؤجر | owner (lessor) — individual owner / تاجر merchant / شركة company |
| مستأجر | renter (tenant) |
| عمولة | platform commission |
| تأمين | refundable deposit |
| تسليم / إرجاع | handoff (delivery/pickup) / return |
| كود الاستلام | handoff code |
| نزاع | dispute |
| شكاوى | complaint |
| إعلان | listing (ad) |
| قسم / تصنيف | category / subcategory |
| وحدة الإيجار | rental unit (hour / day / month …) |
| مستحقات المؤجر | owner payout dues |

### 0.3 Status vocabulary (per brief §22 p.1303)

- **Approved** — decided by the owner in this engagement or unambiguously fixed by the brief.
- **Proposed** — recommended by the agent, awaiting owner sign-off.
- **Pending** — open decision (from brief §22 or discovered); **must not be hard-coded as final behavior**.
- **Simulated (dev)** — real mechanism, stubbed external edge, clearly labeled; allowed only where the owner approved simulation (payments) or the brief permits manual operation (delivery).

### 0.4 Non-assumption rule

No commercial rate, legal claim, provider capability, or scope choice is invented anywhere in this document. Every unapproved item appears in §10 (Open decisions register). The brief *suggests* React/Next "or equivalent" (p.864) and mandates nothing (p.871); the chosen stack (React inside Laravel via Inertia — ADR-013) and the DB change (ADR-014) are explicitly documented with the superseded ADR-001/ADR-003 retained as history, never silent.

---

## 1. Requirements inventory with brief traceability

### 1.1 Scope of the MVP (Phase 2 build target)

Per brief §16 (lines 1026–1061) + **Approved** decision D-d (settled for MVP by the owner's stack directive: customer product = polished Arabic RTL **website** + **admin dashboard**; register §10.2 #11 now **Approved**): **responsive Arabic RTL web app (renter + owner) + admin dashboard.** Native Android/iOS deferred for MVP (register #14 remains moot/Pending while no native target exists).

**In scope (MVP core functions, brief §16 lines 1032–1048):** phone registration+OTP verification, category browsing, search, product details, listing creation, price/availability management, booking request, owner approve/reject, booking confirmation, payment recording per approved mechanism, handoff/return management, basic notifications, reviews, complaints, admin panel, commission/fee management, basic operational+financial reports.

**Explicitly deferred (brief §16 lines 1052–1059):** AI pricing, internal wallet, advanced loyalty, advanced recommendations, multi-carrier delivery integration, international expansion, enterprise management, non-essential social features.

**Never deferrable (brief §16 line 1061):** anything needed for security, rights protection, or financial record-keeping. This is a hard constraint on slice cuts (see capability map §Cut rules).

### 1.2 Functional requirements (FR) — cross-referenced

| FR | Requirement | Brief ref(s) |
|---|---|---|
| FR-1 | Register with phone + OTP; 7 account types (زائر، مستأجر، مؤجر فرد، تاجر/شركة، موظف خدمة عملاء، موظف عمليات، مدير النظام); renter+owner in one account with gated owner activation | §5.1–5.2 (l.356–383) |
| FR-2 | Account verification states (لم يبدأ/قيد المراجعة/تم التحقق/مرفوض/يحتاج استكمال); phone verification ≠ identity verification; ID documents restricted by need-to-know | §5.4 (l.402–416) |
| FR-3 | Admin-editable category tree + per-category custom fields + allowed rental units; new categories reviewed before activation | §3.6 (l.168–183) |
| FR-4 | Search: name/category/location/price/duration/condition filters, sort, empty-state guidance, Arabic-aware matching, category-specific filters | §4.5 (l.249–266) |
| FR-5 | Product detail page: 19 required info groups (incl. availability calendar, deposit, delivery cost, cancellation policy, reviews) varying by category | §4.8 (l.291–317) |
| FR-6 | Rental duration selection with server-authoritative availability check, min/max duration, conflict check; **availability managed centrally on the server** | §4.9 (l.319–332) |
| FR-7 | Booking summary screen itemizing rental value, service fees, delivery, refundable deposit, total due now, refundable amounts + conditions, cancellation policy — *before* confirm/pay | §4.10 (l.334–350) |
| FR-8 | Listing lifecycle: مسودة→قيد المراجعة→منشور→مرفوض→موقوف مؤقتًا→منتهي→محذوف/مؤرشف, with recorded reason for admin actions | §6.3 (l.459–473) |
| FR-9 | Listing form: title, category, subcategory, description, images, condition, price, rental unit, min/max duration, location, availability, deposit, delivery method, cancellation policy, special terms | §6.1 (l.422–443) |
| FR-10 | Images: multi-upload, primary selection, reorder, delete/replace, compression, type/size validation, secure storage | §6.2 (l.445–455) |
| FR-11 | Merchant multi-product dashboard (list/search/sort, edit price/availability, pause, bookings, add product, performance) | §6.5 (l.490–504) |
| FR-12 | Booking flow (18 steps) + **15 booking states** with defined transitions | §7.1–7.2 (l.510–551) |
| FR-13 | Booking rules: no conflicting confirmation; no payment confirmation from app message alone; single-unit exclusivity; multi-unit stock; documented approvals/cancellations; **no post-confirmation tampering of return date or rental value; price/policy snapshot at booking; real timestamps on every event** | §7.3 (l.553–564) |
| FR-14 | Handoff codes: unique per booking, time-limited, single-use, server-verified, logged in booking record; separate return code/confirmation; condition recording with optional photos | §7.4 (l.566–580) |
| FR-15 | Payments: payment record per operation, provider reference, status tracking, failure recording, refunds support, **duplicate-prevention**, settlement reports, owner/platform separation, change documentation | §8.5 (l.632–644) |
| FR-16 | Deposit: not platform revenue if refundable; collection/holding/return mechanism approved before charging; provider hold capability verified, never assumed | §8.6 (l.646–652) |
| FR-17 | Delivery: pickup at merchant, agreed location, contracted carrier, direct P2P (per policy configured at launch — mechanism **Pending** #8); address, fees, carrier order number, status updates, proof of delivery, delay/failure states, delivery-linked complaints; carrier integration only after official API verified — else manual admin entry | §9 (l.656–687) |
| FR-18 | Reviews: numeric + optional comment, only after completed booking, no duplicates, report + admin moderation | §10.1 (l.693–704) |
| FR-19 | Complaints: 11 types, attachment support, reference number, status tracking, notifications | §10.2–10.3 (l.706–731) |
| FR-20 | Disputes: admin reviews booking details/messages/handoff log; decisions + reasons recorded; **no deposit deduction or penalty on uncorroborated one-sided claims** | §10.4 (l.732–736) |
| FR-21 | Admin dashboard KPIs (12 groups) — all computed from the real DB, time-range filterable | §11.1 (l.742–759) |
| FR-22 | Admin: user management, listing review, booking management (search by number, event log), financial management (payments/commissions/fees/subscriptions/refunds/payouts/settlements/export) | §11.2–11.5 (l.761–801) |
| FR-23 | RBAC: role-based least privilege (staff roles incl. موظف خدمة عملاء / مراجعة الإعلانات / مالي / مدير العمليات / مدير النظام / مالك المشروع); sensitive operations in audit log (who/when/what changed) | §11.6 (l.803–816) |
| FR-24 | Notifications: in-app + push + SMS-as-needed across 14 events; delivery state recorded; **duplicate suppression per event** | §12 (l.820–841) |
| FR-25 | Platform settings entity: all fees/rates/limits configurable from admin, never hard-coded | §6.4 (l.475–488), §14 item 22 (l.937) |
| FR-26 | KPI reporting: 17 indicators with defined calculation + data source; no numeric targets invented pre-market-test | §19 (l.1123–1147) |
| FR-27 | Performance: page load speed, image compression, pagination, no bulk loading, offline handling, clear errors, **request de-duplication**, horizontal scale readiness; measurable targets agreed before ship | §13.3 (l.873–886) |

### 1.3 Non-functional requirements (NFR)

| NFR | Requirement | Brief ref(s) |
|---|---|---|
| NFR-1 | Arabic-first RTL UI, responsive across screen sizes, English addable later, visual identity consistent; usability priority = clarity of price/duration/deposit/location over aesthetics | §4.1 (l.189–204) |
| NFR-2 | HTTPS; password protection; account permission scoping; API protection; login attempt throttling; sensitive document protection; **no card data stored on platform servers**; payment verified via provider; security event log; periodic backup **with restore testing**; dependency updates; vulnerability reporting channel | §13.4 (l.888–902) |
| NFR-3 | Data minimization; access scoping; retention/deletion/modification policy; alignment with Egyptian personal-data, e-contracting, and payments law (legal review = Pending §22.15, no legal claims made here) | §13.5 (l.904–908) |
| NFR-4 | 22 entity groups with clear relations + constraints preventing duplicate operations/conflicting bookings; each booking stores financial details and policies agreed at creation time | §14 (l.912–941) |
| NFR-5 | Deliverables package: design files, full source, build files, DB + schema, API docs, run/deploy instructions, hosting/store accounts, integration settings, test results, admin guide, training, warranty, OSS license inventory; no vendor lock-in of the owner | §18 (l.1096–1119) |
| NFR-6 | Six risk themes designed against: fraud, damage/non-return, booking conflicts, payment failure, trust weakness, privacy | §21 (l.1213–1277) |
| NFR-7 | Error states + exception handling are first-class (acceptance test #20) | §17.20 (l.1090) |

---

## 2. Architecture

> **Stack status: Approved** (owner decision D-i). Evidence and supersession history in `ARCHITECTURE_ASSESSMENT.md` (its §5 Django recommendation is **Superseded**; its §4 matrix is retained as history only). Document sign-off still required before Phase 2.

### 2.1 Stack (per ADR-013 / ADR-014 — official docs E10–E17)

| Layer | Choice | Note |
|---|---|---|
| Runtime | PHP 8.5 (via official `php.new`/Laravel install path, E10) — **absent on this machine today; M0 environment gate** | No silent fallback to any other stack on setup failure (Assessment R-2) |
| Web framework | **Laravel 13.x** — single application (no separate API service) | ADR-013 |
| Frontend | **React 19 + TypeScript + Inertia.js 3** via the official Laravel React starter kit (E11); Vite build; Wayfinder typed routes | ADR-013 — no Next.js, no independent SPA |
| UI | **Tailwind CSS 4 + shadcn/ui** (E14, `--rtl` relevant) + custom BADAL design system | Design contract = §6.4 (D-l) |
| Admin | **Custom React/Inertia admin interface** built on the Laravel backend's §11 capabilities — Laravel ships **no** Django-style admin panel (E17: official starter kits are register/authenticate only; no admin feature in official docs navigation); **no third-party/paid admin package without explicit owner approval** | §6.4 contract; maps to §11.1–§11.6 |
| Auth | Fortify (starter kit): sessions, hashing, throttling, optional 2FA (E11) | §6.1 |
| DB (all envs) | **PostgreSQL 18** for local dev, tests, **and** deployment (E13) — **no SQLite anywhere** | ADR-014; concurrency mechanism §4.2 |
| Media | Local filesystem store under the app storage disk | Replaceable with object storage (brief §13.2 p.867) without touching business logic |
| Payments | In-process simulator behind a provider interface | ADR-002 (Approved D-b) |
| Tests | PHPUnit / Pest via `php artisan test` (E15); PG integration tests with **independent connections** | §8; E15 parallel per-process DBs |
| OTP | Simulated only for authorized demo/dev — never real SMS (ADR-007, D-k) | §10.2 |

### 2.2 Layering rules (normative)

1. UI → handlers → services → repositories/DB. **No client-side authority** over availability, price, or state (brief p.332).
2. All حجز state transitions pass through **one guarded state-machine module** (§5.1 of this spec).
3. All money moves through the **payment/ledger module** only; ledger append-only (§7).
4. Every route/action performs an **RBAC check server-side**; UI hiding is never the control.
5. Timestamps stored UTC; rendered Africa/Cairo (Africa/Cairo is Egypt's zone; DST historically not observed — boundary tests still required, risk R-9). Every state change/money event persists `occurred_at`.
6. Error responses are structured and user-clear (brief §13.3 p.882); internal details never leak to users.

### 2.3 Architecture diagram

See `ARCHITECTURE_ASSESSMENT.md` §6 (mermaid). Identical topology; this spec defines the contracts crossing each arrow.

---

## 3. ADR table (decision log)

| ADR | Decision | Status | Evidence/owner ref |
|---|---|---|---|
| ADR-001 | Framework: Django server-rendered RTL (C2) over Next.js (C1) | **Superseded by ADR-013** (retained as history) | Assessment §5 (marked Superseded); brief p.864 *suggests* React/Next "or equivalent", p.871 says none mandatory |
| ADR-002 | Payment = simulated gateway + real ledger/state machine/audit/idempotency | **Approved** | Owner D-b; brief §8.5 |
| ADR-003 | DB = SQLite (MVP), schema Postgres-portable | **Superseded by ADR-014** (retained as history) | Assessment §4 header note; R-1/R-4 rewritten for PG |
| ADR-004 | MVP platforms: responsive web + admin; native deferred | **Approved** (settled by D-i: website + admin; native stays deferred) | Owner decision D-d now Approved; brief §22.11 |
| ADR-005 | Requirements source = `badal.txt` (path discrepancy noted §0.1) | **Approved** | Owner D-a |
| ADR-006 | Docs English + Arabic domain terms | **Approved** | Owner D-f |
| ADR-007 | Dev/demo OTP simulated (SMS provider Pending §10) | **Approved** — simulation for authorized demo/dev **only**, never real SMS in MVP | Owner D-k; brief p.358 requires phone verification; provider undecided §22 |
| ADR-008 | Media = local filesystem, object-storage swappable | **Proposed** | Brief §6.2 p.455 "خدمة مناسبة وآمنة" — provider Pending |
| ADR-009 | Delivery in MVP = manual admin entry + direct-pickup flows | **Proposed** | Brief p.687 explicitly permits manual entry when no integration |
| ADR-010 | Arabic search = normalized server-side matching first; PostgreSQL full-text / `pg_trgm` evaluated at M2 (no external service) | **Proposed** (wording updated from SQLite FTS5 → PG options per ADR-014) | Brief p.264; Assessment R-8 |
| ADR-011 | ≤48h = optimization objective, never at the cost of authz/booking/finance integrity | **Approved** | Owner D-e; brief p.1061 |
| ADR-012 | C7 BaaS excluded for MVP | **Proposed** (exclusion evidence documented) | Assessment §3.1; owner rule = exclusions only with evidence |
| ADR-013 | **Stack = Laravel 13 + React 19 + TypeScript + Inertia.js 3 + Tailwind CSS 4 + shadcn/ui + custom BADAL design system**; one application (no separate Next.js app, no independent API service); admin = **custom React/Inertia interface on the Laravel backend** (no bundled Django-style admin; no admin package without owner approval); official React starter kit (Fortify, Wayfinder) | **Approved** | Owner D-i (D-l for UI bar); official docs E10/E11/E12/E14/E17; Assessment §1.2, §6 |
| ADR-014 | **PostgreSQL everywhere** (local dev, tests, deployment — no SQLite in any environment); anti-double-booking = range types + GiST exclusion constraint on live-occupancy rows + transactional status-aware re-check + unique backstops, proven by independent-connection PG tests | **Approved** (mechanism detail Proposed in §4.2, test-gated at M1) | Owner D-i; E13 (PG range docs), E15; Assessment §4.1; brief §14 p.928 |
| ADR-015 | **Deployment: public demo URL + local fallback** both approved; hosting provider + hosting/DB cost stay **Pending** | **Approved** (provider Pending) | Owner D-j; SPEC §9, register §10.2 `—` row |
| ADR-016 | **UI design contract** (D-l): polished responsive Arabic RTL; accessible contrast/focus/hierarchy; shared design tokens + reusable components; **banned defaults** — AI-style blue/purple gradients, gratuitous glassmorphism, generic template with swapped logo; demo/synthetic data clearly labeled; no invented counts/reviews/ratings/revenue | **Approved** | Owner D-l; brief NFR-1; SPEC §6.4 |

---

## 4. Database design (22 entity groups, brief §14)

Conventions: `snake_case` tables; `id` PK; `created_at`/`updated_at` UTC; soft delete only where brief requires (listings مؤرشف state); money stored as **integer piastres (قرش)** to avoid float error; all FKs explicit.

### 4.1 Entity groups → tables

| # | Brief §14 entity | Tables (MVP) | Key columns / constraints |
|---|---|---|---|
| 1 | المستخدمون Users | `users`, `user_profiles`, `auth_otps`, `login_attempts` | phone unique; password hash (or OTP-only per ADR-007); status; `login_attempts` for throttle (NFR-2) |
| 2 | ملفات المؤجرين Owner profiles | `owner_profiles`, `verifications` | user 1–1; verification state enum (5 states, §5.4); risk level |
| 3 | الشركات والتجار Companies | `organizations`, `org_members`, `staff_roles` | org type (individual/merchant/company); membership with role; delegated employees (brief p.81) |
| 4 | الأقسام والتصنيفات Categories | `categories`, `category_fields`, `category_rental_units` | self-referencing parent; active flag; sort order; **custom field defs (JSON schema-lite rows)** → FR-3; no category names in code |
| 5 | المنتجات Products | `products`, `product_units` | FK category; owner FK; condition; min/max duration; deposit fields; status enum (7 listing states FR-8); multi-unit stock (unit count, brief p.558) |
| 6 | صور المنتجات Product images | `product_images` | product FK; position; is_primary; mime + size validated (FR-10) |
| 7 | الأسعار ووحدات الإيجار Prices | `price_rules` | product FK; rental unit enum (hour/day/week/month/…); amount piastres; valid_from |
| 8 | تقويم التوافر Availability | `availability_windows`, `availability_blocks` | recurring windows + explicit blocks; **authoritative server-side** (FR-6) |
| 9 | الحجوزات Bookings | `bookings`, `booking_events`, `booking_occupancies` | 15-state enum (§5.1); renter+product+unit FKs; **`client_token`** creation-idempotency column (`UNIQUE (renter_id, client_token)`, §4.2 #6); **price_snapshot JSON (immutable)** + policy_snapshot JSON (FR-13, NFR-4); date range stored as PG range type; `occurred_at` event log in `booking_events`; derived `booking_occupancies (unit_id, during tstzrange)` maintained transactionally with state transitions — this table owns **both** the exclusion constraint and the exact-duplicate `UNIQUE (unit_id, during)` backstop (§4.2 #2/#4); the `bookings` table itself carries **no** date-range uniqueness (cancelled/rejected history must never block rebooking) |
| 10 | تفاصيل الأسعار والرسوم Fee details | `booking_fees` | booking FK; fee type (rental/service/delivery/deposit/commission); amount; **snapshot semantics — rows frozen at confirm** |
| 11 | المدفوعات Payments | `payment_intents`, `payment_attempts`, `ledger_entries` | intent idempotency_key **UNIQUE** (FR-15 anti-duplicate); provider ref; status; **append-only ledger** (§7.2); owner dues vs platform revenue split entries |
| 12 | الاستردادات Refunds | `refunds` | booking+intent FK; amount; reason; state; links to ledger legs — never mutates original entries |
| 13 | التأمينات Deposits | `deposits` | booking FK; amount; status (held/released/deducted/pending policy); deductions require dispute decision ref (FR-20) |
| 14 | التسليم والإرجاع Handoff/return | `handoffs`, `handoff_codes`, `return_records` | code: hash, expiry, used_at, purpose (pickup/return) → **single-use, server-verified (FR-14)**; condition + photos |
| 15 | طلبات التوصيل Delivery | `deliveries` | booking FK; address; carrier name; carrier order no.; status incl. delay/failure; manual-entry flag (ADR-009) |
| 16 | التقييمات Reviews | `reviews` | booking FK **UNIQUE** (one review per completed booking, FR-18); score 1–5; comment; hidden flag |
| 17 | الشكاوى والنزاعات Complaints | `complaints`, `complaint_messages`, `dispute_decisions` | 11 complaint types enum (FR-19); reference number; attachments; decision + reason recorded (FR-20) |
| 18 | الاشتراكات Subscriptions | `subscription_plans`, `subscriptions` | plans data-driven (Premium = Pending §22, nothing hard-coded) |
| 19 | الإعلانات المميزة Featured ads | `featured_listings` | product FK; period; fee ref — all rates from settings until §22 approved |
| 20 | الإشعارات Notifications | `notifications` | event type (14, FR-24); recipient; **dedupe key UNIQUE per (event, recipient, subject)** (p.841) |
| 21 | سجلات الإجراءات الإدارية Audit | `audit_log` | actor, action, entity, before/after diff JSON, at; written for every sensitive op (FR-23); **permanent — never stamped for, and never deleted by, demo-batch cleanup (§6.5)** |
| 22 | إعدادات المنصة Settings | `platform_settings` | key/value with type; **the only home for rates/fees/limits** (FR-25) |

**Operational tables outside the brief's 22 groups:** `demo_batches` (the §6.5 lifecycle registry) plus nullable **`demo_batch_id`** provenance columns (FK → `demo_batches`) on every table the demo seeder populates (inventory in §6.5). Configuration tables (`platform_settings`, `categories`, `category_fields`, `category_rental_units`, `subscription_plans`, `staff_roles`) are seeded as configuration only — they are **not** demo-batch rows and the clear operation never touches them.

### 4.2 Integrity mechanisms (anti-double-booking, anti-duplication) — PostgreSQL (ADR-014)

Per Assessment §4.1 (design; official basis E13; proof = §8 concurrency row, acceptance #7):

1. **Range representation.** Booking periods are stored as PG range types (`tstzrange`; `daterange` where date-only granularity is chosen at M0 design) with **GiST indexes** on them; the `btree_gist` extension supplies the scalar-equality arm of composite rules (E13).
2. **Exclusion constraint (hard backstop).** `EXCLUDE USING gist (unit_id WITH =, during WITH &&)` makes a conflicting overlap impossible at the storage layer. An exclusion constraint applies to *every row of its table*, so occupancy is scoped by a derived **`booking_occupancies (unit_id, during)`** table: a row is written **inside the same transaction** that performs the booking's state transition — inserted when the booking enters an occupying state (any live lifecycle state) and deleted on transitions that release the range (cancelled, rejected, and any other non-occupying terminal/release transition). A dead booking therefore never blocks rebooking (spec guard: state-machine tests assert cancel/reject frees the range **and that a new booking for the same unit and the exact same period succeeds afterwards — §8 concurrency row**). The exact-duplicate backstop (§4.2 #4) lives on this same occupancy table, so **both** constraints cover only currently-occupying records. Multi-unit products hold one occupancy row per physical unit (brief p.558); single-unit exclusivity is then structural.
3. **Transactional app-level re-check (status-aware, first for legibility).** The booking write path is one DB transaction: `overlap SELECT` restricted to live states → on hit, clean Arabic conflict error (never a raw SQL error) → `INSERT` booking + fee/snapshot rows + occupancy row. The app check carries status semantics and friendly errors; the constraint catches the race that slips past any check. **Client-side guards (disabled double-click etc.) are UX only and are never counted as a correctness control.**
4. **Exact-duplicate backstop — owned by `booking_occupancies`, scoped to currently-occupying records.** The exact-duplicate requirement ("no more than one booking for the same unit in the same period", brief l.557) is enforced by `UNIQUE (unit_id, during)` **on `booking_occupancies`** — the same table that owns the exclusion constraint (#2). Both constraints therefore apply **only while a booking actually holds the range**, because an occupancy row exists only for a range-holding booking and is deleted in the same transaction as any release transition (cancel/reject/other release). The `bookings` table carries **no** `(unit_id, start_at, end_at)` uniqueness: historical cancelled/rejected/completed bookings keep their `bookings` row for audit history but hold no occupancy row, so they can **never** block a later booking of the same unit and exact period. Redundancy with the exclusion constraint is intentional: the exclusion constraint blocks *any overlap* (`23P01`), while this named unique constraint catches *exact-equality duplicates* (`23505`) with a cheap btree check and a distinct constraint name for error classification (#5). Row-local partial-unique patterns on `bookings` are not used for this purpose (never needed — occupancy is the single source of truth). **Required test (§8 concurrency row):** create a booking → cancel it (and, in a second case, reject it) → create another booking for the same unit and the exact same time range → **succeeds**.
5. **Error classification & retry discipline (SQLSTATE-aware — official basis E16).** Each failure class has exactly one permitted response; **blind retry is forbidden:**
   - **Genuine overlap conflict** — hit on the status-aware re-check *or* `23P01 exclusion_violation` on `booking_occupancies` (class 23) → **clean Arabic conflict response** (never a raw SQL error) and **never retried** — re-running a true conflict cannot succeed.
   - **`40001 serialization_failure` / `40P01 deadlock_detected`** (class 40 — transaction rollback) → retryable, but **only when the entire operation can safely rerun from its start**: the whole unit of work is re-executed with bounded attempts + backoff while its idempotency key/fingerprint and transaction boundary are preserved. If the operation is not safely re-runnable as a whole (side effects outside the transaction, non-idempotent request handling), surface the error instead of retrying.
   - **`23505 unique_violation`** (class 23; PostgreSQL reports the constraint name) → classified by **constraint context + operation**, never retried blindly: `payment_intents.idempotency_key` → §7.1 payment replay/409 rules (unchanged); `bookings (renter_id, client_token)` → §4.2 #6 booking replay / `409 BOOKING_TOKEN_REUSE`; `booking_occupancies (unit_id, during)` exact-duplicate → conflict response (never retried); any other constraint failure → application error, not a retry. Classification keys on the **actual constraint name reported by the driver**, not on which endpoint received the request.
   - **Invariants across every retry:** a retry never partially commits, never re-executes only part of the write, and never mints a new idempotency scope; the one-transaction boundary holds on every attempt. Partial retry of a half-committed write is forbidden (§8 rules).
   - **Proof gate:** this classification is **design, not implementation proof** — it becomes proven only when §8's integration rows exercise both real conflicting reservations (asserted as conflict responses, no retry) and forced `40001`/`40P01` failures (asserted as successful whole-operation retries).
6. **Booking-creation idempotency (`client_token`) — separate contract from payment idempotency.** Preventing the same booking request from being submitted multiple times is a brief requirement (l.883 / §13.3, FR-27). Its mechanism is **`bookings.client_token`**, an opaque client-generated token required on `POST /bookings`, with `UNIQUE (renter_id, client_token)`. Contract:
   - **Key scope:** `(renter_id, client_token)`; the request **fingerprint** is `(product_id, unit_id, start_at, end_at, payload_digest)` stored on the booking row.
   - **Replay:** same token + identical fingerprint → return the **original booking** (in its current state — replay never re-runs creation), with **zero new rows** of any kind (no booking, no `booking_events`, no `booking_fees`, no `booking_occupancies`).
   - **Mismatch:** same token + different fingerprint → **`409 BOOKING_TOKEN_REUSE`**, zero rows, `audit_log` entry.
   - **Transaction boundary:** token lookup + fingerprint comparison happen inside the same create transaction as #3; a `23505` on `bookings_renter_id_client_token_key` → re-read + apply replay/mismatch rules (classified by constraint name per #5).
   - **Retry interplay:** the whole-operation retry of #5 preserves the token (it is part of the request), so a `40001`/`40P01` re-run can never mint a second booking.
   - **Separation from payment (preserves §7.1 unchanged):** distinct key namespaces — the payment endpoints accept only `idempotency_key` (payment scope), the booking endpoint accepts only `client_token` (creation scope); neither key is accepted by the other endpoint, and booking replay rules never touch `payment_intents`. Booking-creation tests are **independent** of payment-idempotency tests (§8).
   - Basis: brief l.883 (prevent duplicate submission), l.941 (constraints against duplicate/conflicting operations); replay behavior follows the approved payment-precedent contract (FR-15/D-b). Proof-gated at M1 (§8 booking-idempotency row).
7. **Payment idempotency:** `payment_intents.idempotency_key UNIQUE` bound to the request fingerprint (§7.1); replayed identical requests return the original intent (FR-15, acceptance #10). **Unchanged by #6** — see the namespace separation above.
8. **Booking snapshot fields** (`price_snapshot`, `policy_snapshot`) are write-once; guarded by state machine (no update route accepts changes to them after `confirmed`).
9. **No SQLite carry-over.** SQLite-only mechanisms (`BEGIN IMMEDIATE`, `busy_timeout`, `SQLITE_BUSY` retry, partial-index tricks) are **not** part of this spec — they belonged to the superseded ADR-003 path and are recorded only as history in the Assessment. PostgreSQL is the database in **every** environment; there is no SQLite fallback (ADR-014).

---

## 5. API & interface contracts

Contract language: **Inertia page props** for all screens (React/TS via Inertia — ADR-013) + JSON endpoints only where interactivity requires it (fetch from React components). All endpoints enforce §6 authz. Errors: `{code, message_ar, message_en, correlation_id}`; never leak stack traces (NFR-7).

### 5.1 Booking state machine (FR-12; brief §7.2, 15 states)

```
مسودة draft
  → pending_owner_approval        (renter submits)
pending_owner_approval
  → rejected                      (owner rejects — terminal)
  → awaiting_payment              (owner approves)
awaiting_payment
  → payment_processing            (payment initiated)
payment_processing
  → confirmed                    (payment intent succeeded — §7.1)
  → awaiting_payment             (payment intent failed — retry permitted)
  → cancelled                    (only per configured policy §22.4 — Pending)
  → disputed                     (payment anomaly raised)
confirmed
  → ready_for_pickup              (handoff code issued)
ready_for_pickup
  → handed_over                   (pickup code verified)
handed_over
  → active                        (optional explicit start)
active
  → awaiting_return               (rental period elapsed / early return started)
awaiting_return
  → returned                      (return code verified)
returned
  → settling                      (deposit/commission reconciliation)
settling
  → completed                     (no open refund/dispute)
Any pre-completed state
  → cancelled                     (mechanism mandatory; terms only from configured policy §22.4 — **Pending**, see rules below)
  → disputed                      (complaint escalated, FR-20)
disputed
  → settling | cancelled          (decision recorded)
```

Arabic ↔ code names (all 15 from brief p.535–549): مسودة=draft, في انتظار موافقة المؤجر=pending_owner_approval, مرفوض=rejected, في انتظار الدفع=awaiting_payment, الدفع قيد المعالجة=payment_processing, مؤكد=confirmed, جاهز للاستلام=ready_for_pickup, تم التسليم=handed_over, نشط=active, في انتظار الإرجاع=awaiting_return, تم الإرجاع=returned, قيد التسوية المالية=settling, مكتمل=completed, ملغي=cancelled, قيد النزاع=disputed.

**Rules:** transitions are a closed table (from_state, to_state, actor_role, guard) — unknown transitions are rejected server-side; every transition writes `booking_events (booking_id, from, to, actor, occurred_at, reason)`; not every product type needs all states (brief p.551) but *any* used state obeys the table.

**`failed` is not a booking state.** It exists only on the payment intent (`payment_intents.status`: `succeeded|failed|pending`, §7.1). A failed intent *causes* a booking transition (`payment_processing → awaiting_payment` or `→ cancelled`); it never becomes a 16th booking state — the booking machine has exactly the brief's 15 states (p.535–549).

**The same separation holds for refunds.** Refund lifecycle is tracked on `refunds` rows (own `state` column, §4.1 entity 12) plus reversing ledger legs (§7.2); a refund being processed or completed never moves a booking into `refunding`/`refunded` — those strings are not booking states. Booking outcomes related to money are only the explicit transitions above (`settling`, `cancelled`, per the closed table in §5.1).

**Cancellation rules (brief l.560–561, l.1290; §22.4 Pending):** the cancellation *mechanism* is mandatory (acceptance #13), but its terms (deadlines, fees, refund ratios) render only from `platform_settings` values (FR-25). No default policy may be hard-coded; until §22.4 is approved, automated refund calculation stays blocked — each cancellation records an explicit decision + reason in `booking_events` (audit-logged), and refund outcomes require a recorded explicit decision rather than an assumed default.

### 5.2 Page/endpoint map (MVP)

| Area | Route (representative) | Notes |
|---|---|---|
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` | throttle per `login_attempts` (NFR-2) |
| Browse | `GET /`, `GET /search?q&cat&city&price_min&price_max&unit&duration`, `GET /c/<slug>`, `GET /p/<id>` | pagination mandatory (FR-27); detail page renders 19 groups (FR-5) |
| Availability | `GET /p/<id>/availability?from&to` | read-only projection of §4.1 table |
| Booking | `POST /bookings` (create → pending_owner_approval, overlap re-check inside txn), `GET /bookings/<id>`, `POST /bookings/<id>/cancel` (policy Pending) | create is idempotent per `(renter_id, client_token)` — replay/mismatch contract in §4.2 #6 (separate namespace from payment `idempotency_key`) |
| Owner | `POST /owner/bookings/<id>/approve|reject`, listing CRUD `POST/PUT /owner/listings…`, image upload `POST /owner/listings/<id>/images` | owner = verified account only (FR-1 owner activation gate) |
| Payment | `POST /bookings/<id>/pay {idempotency_key}` → simulator; `GET /bookings/<id>/payments` | never accepts card data (NFR-2) — simulator contract only |
| Handoff | `POST /handoff/pickup {code}`, `POST /handoff/return {code}`, `GET /bookings/<id>/codes` | codes single-use/expiry server-verified (FR-14) |
| Reviews | `POST /bookings/<id>/review` (completed only, unique) | FR-18 |
| Complaints | `POST /complaints`, `GET /complaints/<ref>` | FR-19 |
| Notifications | `GET /notifications`, `POST /notifications/<id>/read` | dedupe at write (FR-24) |
| Admin | `/admin/…` (custom React/Inertia admin pages + KPI views `/admin/reports/…`) | RBAC per §6; audit log entries for mutations (FR-23) |

### 5.3 Handoff code contract (FR-14)

`code` = high-entropy token; server stores **hash only**; fields: booking_id, purpose(pickup|return), expires_at, used_at (NULL until used), issued_by. Verification: match + not expired + not used → atomically set `used_at` + append booking event + notify both parties. Reuse after `used_at` set → hard reject (acceptance #11).

---

## 6. Security, privacy, RBAC (brief §13.4–13.5, §11.6)

### 6.1 Baseline controls → implementation obligations

| Brief §13.4 item | Obligation in Phase 2 |
|---|---|
| HTTPS | Terminated at deploy layer; local dev exempt but documented (R-8 ops note) |
| Password protection | Laravel framework default hashing (bcrypt/argon2 via Fortify — no custom crypto) |
| Account permission scoping | §6.3 RBAC matrix below |
| API protection | Auth required on all non-public routes; CSRF on all state-changing HTML posts; same-origin |
| Login attempt throttling | `login_attempts` table + per-phone/IP backoff; OTP request rate limit |
| Sensitive document protection | Verification docs served only through authorized admin route with audit entry (brief p.416) |
| No card data storage | Payment module has **no card fields at all** — contract-level impossibility (ADR-002) |
| Provider-verified payments | Simulator only in MVP; real provider = §10 Pending |
| Security event log | `audit_log` + auth events |
| Backup + restore test | Capability-map M3 + acceptance #18 with documented proof |
| Dependency updates / vuln channel | Documented in ops runbook (deliverable NFR-5) |

### 6.2 Privacy (NFR-3)

Data minimization at each form (brief p.369: no unnecessary fields; p.906: collect only what operation needs); retention/deletion policy documented (Pending legal sign-off §22.15 — the *mechanism* exists: account delete request flow per brief p.400, final policy Pending); access scope = need-to-know enforced by RBAC.

### 6.3 RBAC matrix (normative)

Roles (merged §5.2 + §11.6): `renter`, `owner`, `merchant_owner`, `cs_staff`, `listing_reviewer`, `finance_staff`, `ops_manager`, `system_admin`, `project_owner`. Staff-vs-customer is a hard boundary.

Account-type mapping (brief §5.2's 7 types → roles): زائر = unauthenticated browse (no row in the matrix); مستأجر → `renter`; مؤجر فرد → `owner`; تاجر/شركة → `merchant_owner`; موظف خدمة عملاء → `cs_staff`; موظف عمليات → `ops_manager` (the §11.6 employee/manager distinction is a Phase-2 role-*configuration* split, not a schema change — roles are data); مدير النظام → `system_admin`. §11.6's موظف مراجعة الإعلانات → `listing_reviewer`, موظف مالي → `finance_staff`, مالك المشروع → `project_owner` are permission roles layered above account types.

| Capability | renter | owner | merchant_owner | cs_staff | listing_reviewer | finance_staff | ops_manager | system_admin | project_owner |
|---|---|---|---|---|---|---|---|---|---|
| Browse/search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Own bookings create/pay/cancel | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Booking request approve/reject (requests on **own** listings — §5.1 `pending_owner_approval` transition) | — | own | own | — | — | — | — | — | — |
| Listings create/edit/pause (own listings only) | — | own | own | — | — | — | — | — | — |
| Listing approve/reject/suspend (moderation — any listing) | — | — | — | — | ✓ | — | — | ✓ | ✓ |
| Booking view (any) | own | own | own | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Booking state override | — | own transitions | own transitions | — | — | — | ✓ | ✓ | ✓ |
| Payments/refunds view | own | own | own | — | — | ✓ | ✓ | ✓ | ✓ |
| Commission/fee settings edit | — | — | — | — | — | — | — | ✓ | ✓ |
| Complaints handling | own | own | own | ✓ | — | — | ✓ | ✓ | ✓ |
| Dispute decision | — | — | — | propose | — | — | ✓ | ✓ | ✓ |
| Users suspend/restore | — | — | — | — | — | — | — | ✓ | ✓ |
| Verification docs view | — | — | — | assigned only | assigned only | — | — | ✓ | ✓ |
| Audit log view | — | — | — | — | — | — | ✓ | ✓ | ✓ |
| RBAC/roles admin | — | — | — | — | — | — | — | ✓ | ✓ |
| Demo data add/clear (§6.5) | — | — | — | — | — | — | — | ✓ | ✓ |

*Legend: ✓ = allowed; own = scoped to own rows; — = denied. Every mutation also writes `audit_log` (FR-23). This matrix is the source for acceptance test #16.*

*Separation rule (abuse case, test #16 must assert the denied cell):* `owner` and `merchant_owner` manage their own listings (create/edit/pause) but **can never approve, reject, or suspend listings** — moderation is staff-only (`listing_reviewer`, `system_admin`, `project_owner`), so no one can self-approve their own listing. `merchant_owner` mirrors `owner` on customer-side rows (both are seller account types per §5.2); this moderation row is the one deliberate divergence.

### 6.4 UI/UX design contract (ADR-016 — owner decision D-l; principles only, no UI code in Phase 1)

**Target user & job:** an Arabic-speaking renter comparing price/duration/deposit/location on a product before booking, an owner/merchant managing listings and approvals, and staff (CS/finance/ops/admin) working the §11 back office. The interface's job is *clarity of the rental transaction*, not decoration (brief NFR-1: usability priority = price/duration/deposit/location over aesthetics).

**Design system:** Tailwind CSS 4 tokens + shadcn/ui primitives (E14) wrapped by a custom **BADAL design system** — shared color/spacing/typography tokens and reusable components, so renter screens, merchant dashboard, and admin stay visually coherent; Arabic RTL first (`dir=rtl`, `lang=ar`), responsive across breakpoints, readable typography and hierarchy, accessible color contrast, visible keyboard focus.

**Banned defaults (never ship):** AI-style blue/purple gradients; gratuitous glassmorphism; generic template with the logo swapped; placeholder text in production UI; color-only meaning (pair color with text/icon); unstyled default browser controls; modals where inline belongs; invented metrics (counts, reviews, ratings, revenue) — demo/synthetic data must be clearly labeled as such.

**Required states (every screen/flow):** loading, empty, error, success — each designed, none left to browser defaults. Key rental surfaces must show, before confirm: price, rental duration, availability, deposit status, delivery fees, total due.

**Admin note:** Laravel does **not** ship a complete Django-style admin interface — the official starter kits provide only "the routes, controllers, and views you need to register and authenticate" (E17), and the official docs contain no admin-panel feature. The §11 admin is therefore a **custom React/Inertia interface** built on the same backend capabilities as the public app, styled to this contract (KPI views, finance, moderation). **No additional admin package — free or paid — may be added without explicit owner approval.** Scaffold ≠ acceptance (Assessment R-12; acceptance sweep C-37).

**Status:** these are documented principles binding Phase 2 UI work; verification is part of acceptance test #19 / capability C-37. This phase produces **no UI code**.

### 6.5 Demo-data lifecycle («Add demo data» / «Clear demo data» — approved temporary controls; capability C-41)

**Purpose & scope.** A privileged operator may generate a clearly labeled synthetic dataset for demos/training/acceptance runs and remove **exactly** that dataset afterward. Both operations are temporary, environment-gated controls — never a normal data path, never available where they could reach unmarked or unrelated data.

1. **Idempotent creation + cleared-token rule.** Add-demo-data is idempotent per request: the same request token + configuration returns the existing batch (same `demo_batch_id`, **zero new rows**) instead of duplicating the dataset; only a new, distinct request may create a new batch. The registry row is **never deleted**: after Clear it persists as a **tombstone** with `status='cleared'`, and the **same token re-submitted after Clear returns that cleared batch** (status `cleared`, zero new rows) — a cleared token can **never** silently resurrect or duplicate the dataset. Creating demo data after a clear therefore requires a **new request token** (the token-to-batch history stays enforceable, §4.1 operational note).
2. **Provenance.** Every generated row is stamped with a unique **`demo_batch_id`** (UUID) at write time, and each batch is registered in a **`demo_batches`** table (batch id, request-token digest, `created_at`, actor, per-table row counts at create **and** at clear, `status active|cleared`, `cleared_at`, `cleared_by`). Relationships among generated records (demo users → listings → bookings → intents → ledger legs → handoffs/reviews/notifications) are preserved within the batch so cleanup scope is exact. `audit_log` rows are **never** stamped for cleanup (they are permanent records — point 5).
3. **Batch-scoped, dependency-safe cleanup — complete inventory.** Clear-demo-data deletes **only** rows whose `demo_batch_id` matches the target batch, in one transaction, in exactly this children-before-parents order (FK-safe; every seeder-populated table appears exactly once):
   1. `return_records` → 2. `handoff_codes` → 3. `handoffs` → 4. `deliveries` → 5. `dispute_decisions` → 6. `complaint_messages` → 7. `complaints` → 8. `reviews` → 9. `notifications` → 10. `refunds` → 11. `deposits` → 12. **`ledger_entries` (guarded — point 4)** → 13. `payment_attempts` → 14. `payment_intents` → 15. `booking_fees` → 16. `booking_occupancies` → 17. `booking_events` → 18. `bookings` → 19. `subscriptions` → 20. `featured_listings` → 21. `price_rules` → 22. `availability_blocks` → 23. `availability_windows` → 24. `product_images` → 25. `product_units` → 26. `products` → 27. `verifications` → 28. `owner_profiles` → 29. `org_members` → 30. `organizations` → 31. `user_profiles` → 32. `login_attempts` → 33. `auth_otps` → 34. `users` → 35. `demo_batches` — **not deleted**: updated in place to `status='cleared'` (tombstone, point 1).
   **Never touched by Clear:** `audit_log` (all rows permanent), configuration tables (`platform_settings`, `categories`, `category_fields`, `category_rental_units`, `subscription_plans`, `staff_roles`), and every row with a `NULL`/foreign `demo_batch_id` (unreachable by predicate).
   **Transaction & rollback:** the whole clear is one transaction; any failure at any step **rolls back everything** — the batch ends with **all** its rows intact and `status` still `active`, no partial deletion, no orphan half-state. **Post-cleanup verification** (inside or immediately after commit): a per-table `COUNT(*) WHERE demo_batch_id = target` returns **0** for all 34 business tables, and the registry row exists with `status='cleared'`; any non-zero count fails the operation's own test (test b).
4. **Financial reconciliation (append-only ledger, §7.2) — data-layer enforcement.** The ledger's UPDATE/DELETE prohibition has exactly one scoped exception: demo-batch rows of the target batch, and it is enforced **at the data layer**, not by convention: a `BEFORE UPDATE/DELETE` guard on `ledger_entries` raises an exception unless a session-local demo-clear flag equals the row's own `demo_batch_id`; a row with `NULL` `demo_batch_id` is **always** blocked, even with the flag set. The flag is set only by the clear path, inside the single clear transaction — normal runtime code has **no path** that sets it, so runtime keeps no general ability to delete or amend ledger entries (the application-layer prohibition of §7.2 remains the first line; the guard is the data-layer backstop). Demo intents/ledger legs additionally carry `simulated=true`. Clear removes all demo financial rows for the batch **together** — no orphaned demo intent, ledger, fee, deposit, or occupancy row may survive its booking — while **preserving every non-demo financial record**: settlement projections, per-owner dues, and platform totals for real data are computed before/after the clear and asserted unchanged (test g). **This mechanism is design, not proof** — it becomes proven only when integration tests exercise both the batch-flagged delete (allowed) and a non-batch/NULL-batch delete (rejected) (tests c, h); before that it is claimed nowhere as verified.
5. **Privileged controls on every request.** Both operations require **all** of: privileged authorization (`system_admin` / `project_owner` only — §6.3 row), CSRF protection on the state-changing request, an explicit typed confirmation, an **affected-record preview** (per-table counts for the target batch shown *before* execution), and an `audit_log` entry recording actor, batch id, operation, and row counts. The Clear operation writes its own `audit_log` entry describing what it deleted — **and that entry, like every other `audit_log` row, survives the clear** because `audit_log` is outside the cleanup inventory entirely (point 3); demo-cleanup deletes audit history never.
6. **Environment gate + production removal.** The controls exist only when an explicit feature flag is on **and** the environment is local/demo (config-gated, disabled by default, unreachable in production config). Before final production deployment the flag/config is removed or hard-disabled, **and** tests verify the demo-data routes/commands are absent or denied (403/404) in production mode; a documented checklist item confirms removal/disablement.
7. **Proof (tests).** Required tests — the evidence rule for capability-map C-41:
   (a) Clear leaves every unrelated record untouched — pre-seeded **non-demo and unmarked** (`demo_batch_id IS NULL`) users/listings/bookings/ledger entries intact;
   (b) complete dependency-safe cleanup: every table in the point-3 inventory ends with zero rows for the batch and **no orphaned demo financial rows** (intent/ledger/fee/deposit/occupancy) survive their booking;
   (c) non-demo **and unmarked** ledger rows cannot be deleted via the clear path (fails closed at the data layer);
   (d) Add idempotency tested **both before and after a clear**: same token before Clear → one batch; same token after Clear → cleared tombstone, zero new rows; a new token after Clear → a fresh batch;
   (e) production-mode gate denies both operations (routes/commands absent or 403/404);
   (f) `audit_log` preservation: pre-existing audit rows survive Clear, **and the Clear operation's own audit entry exists after the transaction**;
   (g) non-demo ledger/settlement totals asserted identical before and after Clear;
   (h) ledger guard rejects a non-batch/NULL-batch delete at the data layer (proof for point 4 — until this runs, point 4 stays design);
   (i) full-suite regression: `php artisan test` green with the suite running against PostgreSQL (ADR-014).

---

## 7. Payment simulation contract (ADR-002, approved D-b)

### 7.1 Interface

```
PaymentProvider (interface)
  create_intent(booking_id, amount_piastres, idempotency_key) -> Intent
  capture(intent_ref) -> Result{status: succeeded|failed|pending, provider_ref}
  query(intent_ref) -> Result            # for pending reconciliation
  refund(intent_ref, amount_piastres, reason) -> RefundRef
```

`SimulatedProvider` implements it deterministically for MVP (success/failure/timeout controlled by test hooks + explicit admin sim controls). Real provider later swaps implementations — **no other code changes** (this is what "swap-in contract" means; D-b).

**Simulation-control restrictions (demo/dev only):** the simulator's control surface (force success/failure/timeout) is available only when an explicit dev/demo settings flag is on — never enabled by default in any publicly reachable deployment — and only to authorized staff roles (§6.3). Every simulated outcome is stamped `simulated=true` on the intent and rendered with a persistent, unmistakable label («محاكاة تجريبية — ليست عملية دفع حقيقية») in admin and payment-status views, so a simulated success can never be mistaken for a real payment. The label cannot be suppressed by UI configuration.

**Idempotency-key scope:** each key is bound at creation to a request fingerprint — `(booking_id, amount_piastres, provider, payload digest)` stored on the intent.
- Replay with the **same key and identical fingerprint** → returns the original intent unchanged; creates zero rows of any kind (intent, attempt, ledger).
- Same key with a **different booking, amount, or payload** → rejected `409 IDEMPOTENCY_KEY_REUSE`; no intent created, no state change, `audit_log` entry written. A key is never silently re-bound to different money.
- Proven by tests (§8 money row): retries/replays must not create duplicate ledger postings, must not alter an existing intent except through its defined transition, and the mismatched-payload case must fail closed.

### 7.2 Ledger rules (§8.5)

- `ledger_entries` append-only: every movement = rows (e.g., rental→owner_dues, commission→platform_revenue, delivery components split per p.609–613, deposit→liability row **not revenue** per p.648, refunds = reversing legs).
- Corrections = new compensating entries; UPDATE/DELETE on ledger rows are forbidden at the application layer (schema view + tests enforce). The **single sanctioned exception** is demo-batch cleanup (SPEC §6.5 point 4), enforced by a data-layer guard scoped to one batch inside one transaction — it does **not** exist at the application runtime layer, and normal operations never gain a ledger-delete capability.
- Settlement report = projection over ledger (§11.5).
- One `payment_intents` row per attempt, `idempotency_key UNIQUE` **bound to the request fingerprint (scope rules in §7.1)**; duplicate submit → same intent, zero new rows (acceptance #10); key reuse with different booking/amount/payload → 409, no state change.
- Booking confirmed **only** when provider result says succeeded — never from a client message (brief p.556).
- All rates (commission %, fees) read from `platform_settings`; until §22 approvals the values render as **proposed/preview only** and are labeled Pending in admin UI (R-5).

---

## 8. Testing strategy

| Layer | Scope | Tools | Acceptance §17 links |
|---|---|---|---|
| Unit | state-machine transition table exhaustiveness, price snapshot calc, code expiry logic, settings lookups | PHPUnit/Pest (`tests/Unit`) via `php artisan test` (E15) | #8, parts of #16, parts of #20 |
| Integration — booking concurrency | N parallel creates on same unit/range → exactly one success; conflict path exercised (app re-check message + constraint backstop, asserted as a **conflict response — never retried**); a forced transactional failure (`40001`/`40P01`) exercised as a **whole-operation retry** with idempotency key + transaction boundary preserved; `23505` classified by constraint context (§4.2 #5); **required release test: create → cancel (case 1) / reject (case 2) → re-create same unit + exact same period → succeeds** (historical rows never block rebooking) | `tests/Feature` against **PostgreSQL** with **independent concurrent connections** (one per simulated client — a shared connection proves nothing); Laravel parallel testing uses per-process DBs (E15); acceptance #7 is the M1 exit gate (Assessment §11) | **#7** |
| Integration — booking idempotency | `client_token` replay: same token + identical fingerprint → original booking returned, **zero new rows** (booking, events, fees, occupancies); same token + different fingerprint → `409 BOOKING_TOKEN_REUSE`, zero rows, audit entry; `40001`/`40P01` whole-operation retry preserves the token (no second booking); **asserted independently of payment-intent idempotency tests** (distinct key namespaces, §4.2 #6) | `tests/Feature` on PostgreSQL; separate fixtures from the money row | **#5**, #7 (FR-27, brief l.883) |
| Integration — money | idempotent capture replay, **same-key/different-payload rejection (409, zero new rows)**, no duplicate ledger postings on retry, ledger append-only, refund legs, settlement math | Feature tests + ledger assertions | **#9, #10, #15**, #13 |
| Integration — flow | full happy path + owner reject + cancel paths | Feature tests (Inertia endpoints) | #1–#6, #11, #12 |
| Integration — trust & support | review eligibility/uniqueness after completed booking; complaint lifecycle (create, reference no., status track) | Feature tests | **#14** |
| Security/RBAC | permission matrix §6.3 as table-driven tests (allowed AND denied cases) | Feature/unit tests | **#16, #17** |
| Ops | PostgreSQL backup (`pg_dump` semantics) + restore into clean DB + row-count/checksum verify; demo-data suite (§6.5 tests a–i): complete inventory cleanup with no orphan demo financial rows, **audit_log preservation incl. the Clear operation's own entry**, non-demo/unmarked rows untouched **and undeletable via the clear path**, non-demo settlement totals unchanged, Add idempotency before **and after** a clear, production-mode denial | script + documented run | **#18**, #19, #20 |
| UX/device | RTL rendering, responsive breakpoints, target devices, §6.4 design contract (contrast/focus/hierarchy; no banned defaults) | browser pass (manual/scripted later) | #19 |
| Exception | expired code, double code use, conflicting booking race, payment timeout, mid-flow cancel | dedicated error-state suite | **#20** |

Rules: every bug fixed gets a regression test; tests must run offline (no external providers — OTP/payment simulated, ADR-007/ADR-002); concurrency tests are the M1 exit gate (Assessment §11). Test environment = PostgreSQL identical to dev/deploy (ADR-014) — tests never run on a different engine than production.

---

## 9. Deployment & operations (MVP)

- **Dev:** Laravel local dev server (`php artisan serve` + Vite dev for the React/TS bundle) against **PostgreSQL** (local database, git-ignored `.env` — no secrets in repo; none exist yet). PHP/Composer/PostgreSQL are **absent on this machine today** — provisioning is the M0 environment gate (Assessment §8, R-2): on failure, report → explain alternatives → pause → **ask the owner; no silent fallback** to SQLite/MySQL/another framework.
- **Demo/local-prod:** `php artisan config:cache`-style optimized single app + built Vite assets served through the app; PostgreSQL for data; single app process fits the RAM budget (Assessment CR-7, R-3).
- **Public demo URL + local fallback:** both **Approved** (D-j/ADR-015). The public deployment runs the identical app against PostgreSQL behind HTTPS (NFR-2); the local fallback is the same codebase run on this machine. **Hosting provider + hosting/DB cost = Pending** — no vendor is assumed or named until the owner chooses one (register §10.2).
- **Backup:** scheduled PostgreSQL dump (`pg_dump` semantics) → documented retention; **restore drill documented (test #18)** on a clean database.
- **Runbook** deliverable (NFR-5): install (PHP/extensions/Composer/Node), provision DB, migrate, create admin, run tests (`php artisan test`), backup, restore, and verify demo-data controls removed/disabled before production (§6.5).
- No container requirement in MVP (docker absent on machine — honest constraint), no CI yet (not in phase scope; CI skill deferred with implementation).

---

## 10. Acceptance criteria (brief §17's 20 tests) + open decisions register

### 10.1 Acceptance tests (normative — documentation results required before sign-off)

| # | Test (brief text, translated) | Spec section proving design |
|---|---|---|
| 1 | Create account + phone verification | §5.2 auth, ADR-007 |
| 2 | Add a new product | §5.2 owner listing CRUD, FR-9 |
| 3 | Listing review + publish | FR-8, admin RBAC row |
| 4 | Search with filters | FR-4, §5.2 browse |
| 5 | Create booking request | §5.1 transition 1; §4.2 #6 (creation idempotency, brief l.883) |
| 6 | Owner approve/reject | §5.1, RBAC "Booking request approve/reject" row |
| 7 | **Block booking in unavailable period** | §4.2 concurrency design — incl. release test: cancel/reject frees the range so the same unit + exact period can be rebooked |
| 8 | Show price + fees before confirm | FR-7 |
| 9 | Record payment + verify result | §7.1 simulator |
| 10 | **Prevent duplicate payment recording** | §7.2 idempotency |
| 11 | Create + verify handoff code | §5.3 |
| 12 | Record return | §5.1 return transition |
| 13 | Cancellation + refund handling | §7.2 refund legs (policy Pending §10.2) |
| 14 | Open complaint + track | FR-19 |
| 15 | Review financial reports | FR-22 finance views, §7.2 |
| 16 | Verify user permissions | §6.3 matrix |
| 17 | Data protection test | §6.1/§6.2 |
| 18 | Backup + restore test | §9 |
| 19 | Test on target devices | NFR-1 |
| 20 | Exception/error states | NFR-7, testing table |

### 10.2 Open decisions register (brief §22 — statuses honest)

| # | Decision | Status | What blocks / where used |
|---|---|---|---|
| 1 | Final fees + commission formula | **Pending** (brief proposals: 10% p.599, EGP 5 listing p.477, EGP 5 delivery p.607) | `platform_settings` values; UI shows proposal as preview |
| 2 | Commission on owner? | **Pending** | ledger rule set |
| 3 | Ad validity vs listing fee | **Pending** | featured_listings expiry |
| 4 | Cancellation/refund policy | **Pending** | cancel guards in §5.1 |
| 5 | Deposit collect/hold/return mechanism | **Pending** (p.652 provider capability unverified) | deposits table behavior |
| 6 | Payment provider choice | **Pending** (MVP = simulator, Approved) | ADR-002 swap |
| 7 | Owner identity-verification policy | **Pending** (states designed FR-2) | verification workflows |
| 8 | Delivery mechanism phase 1 | **Pending** (ADR-009 manual = Proposed) | deliveries flows |
| 9 | Categories launching | **Pending** | seed data |
| 10 | Geographic scope | **Pending** (Fayoum per p.10 — confirm) | launch config |
| 11 | Platforms v1 | **Approved** — responsive web + admin dashboard (owner stack directive D-i); native Android/iOS deferred | scope baseline |
| 12 | Budget & schedule | **Pending** (48h = objective D-e, not commitment) | planning |
| 13 | Disputes/compensation policy | **Pending** | dispute_decisions guardrails |
| 14 | App-store publishing requirements | **Pending** (moot while native apps stay deferred — the deferral itself is settled for MVP by #11 Approved) | — |
| 15 | Legal/contractual review (Egyptian law) | **Pending** — owner/legal only | NFR-3 final policy |
| — | **Deployment target for competition submission: public URL vs local demo** | **Approved** (D-j/ADR-015): public demo URL **and** local fallback both approved | §9 deployment plan; runbook NFR-5 unchanged either way |
| — | **Hosting provider + hosting/DB cost** (where the public demo runs) | **Pending** — no vendor or price assumed (D-j keeps provider selection open) | §9 public-demo entry; owner decision required before any account is created |

Also Pending: OTP/SMS provider, maps provider, notification-push provider, identity-verification vendor, cloud storage vendor (brief §13.2 providers all unspecified).

---

*End of SPEC. Any change to this document after Phase-2 start requires the same approval gate as its initial sign-off.*
