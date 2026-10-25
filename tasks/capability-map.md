# BADAL (بدّال) — Capability Map (Phase 1)

**Document type:** Execution map — risk-first vertical slices, one row per buildable capability
**Status:** Proposed — pending owner approval (the **stack** is Approved per ADR-013/ADR-014; approval of this map ≠ coding permission)
**Author:** OpenCode agent · **Date:** 2026-10-16
**Companions:** `ARCHITECTURE_ASSESSMENT.md` (why this stack), `SPEC.md` (contracts each row implements)

---

## 0. How to read this map

**Columns**

- **ID** — stable reference (C-nn) for tasks & reviews.
- **Capability** — a vertically sliceable unit of user-visible or safety-visible behavior.
- **Brief ref** — § in `badal.txt` (traceability to requirements source).
- **Accept test** — number(s) in brief §17's 20 acceptance tests (l.1065–1091). `—` = no direct test; still covered by §Cut rules.
- **Risk** — why it is placed where it is: `RISK-peak` (must fail early), `RISK-high` (integrity/security), `MED`, `LOW`.
- **Depends on** — prerequisite capability IDs (DAG, no cycles).
- **Slice** — M0–M3 / S (acceptance sweep) per Assessment §8 windows (test gates in §11).
- **Evidence of done** — concrete artifact produced before the row counts as done (test file + result, admin screenshot-equivalent proof, doc update). No row is "done" without its evidence.

**Slice schedule (48h optimization objective, ADR-011 — never overrides integrity rows):**

| Slice | Window | Theme |
|---|---|---|
| **M0** | 0–6 h | Skeleton, environment proof, schema, harness |
| **M1** | 6–20 h | **Risk peak:** booking concurrency, money, RBAC |
| **M2** | 20–34 h | Core flows: browse → listing → booking → handoff |
| **M3** | 34–42 h | Notifications, reviews, complaints, reports, ops proof |
| **S** | 42–48 h | Acceptance sweep: all 20 §17 tests + docs package |

**Cut rules (normative, from brief §16 l.1061 + ADR-011):** rows marked `!CUT` (security, authorization, booking integrity, financial correctness, audit, backup/restore) are **never** cut, skipped, stubbed, or weakened to save time — shown as `RISK-x !CUT` where a severity also applies. Anything else may be descoped to the owner with the remaining brief §16 core list intact.

**Convention on Pending decisions (§10.2 of SPEC):** rows that *consume* an unapproved rate/policy build the mechanism + admin-configurable value (`platform_settings`) and label the value `Pending`; they never hard-code a proposal as final.

---

## 1. M0 — Foundation & environment proof (risk-first: disprove the stack early)

| ID | Capability | Brief ref | Accept test | Risk | Depends | Evidence of done |
|---|---|---|---|---|---|---|
| C-01 | **Environment gate (official docs E10/E13):** verify/install compatible **PHP 8.5 + required extensions**, **Composer**, **Node/npm** vs the official Laravel React starter kit, **provision/verify PostgreSQL**, filesystem write + RAM headroom; record actual outputs/versions. **On failure: report → explain alternatives → pause → ask owner — no silent fallback** to SQLite/Django/Next.js/MySQL/another framework (Assessment R-2) | §13.1 (l.851–871) | — | RISK-peak (R-2) | — | Environment report with commands + versions; stack confirmed (or failure escalated to owner before anything else proceeds) |
| C-02 | Project skeleton from the **official Laravel React starter kit** (Inertia/React/TS/Tailwind 4/shadcn/ui, E11/E14): RTL base (`dir=rtl`, `lang=ar`), app config split (dev/prod), `.env` git-ignored (DB_* → PostgreSQL, ADR-014) | §4.1 (l.189–204), §13.1 | 19 | RISK-peak | C-01 | `php artisan serve` + Vite build boots; RTL page renders; smoke test passes |
| C-03 | Full schema migration for all 22 entity groups (SPEC §4.1) incl. money-as-integer, FKs, enums, **PG range types + `booking_occupancies` + GiST exclusion constraint (SPEC §4.2)**, `platform_settings` seed with Pending-labeled values | §14 (l.912–941), §6.4 (l.475–488) | 20 | RISK-peak | C-02 | `php artisan migrate` clean on fresh PostgreSQL; schema review vs SPEC §4.1/§4.2 checklist |
| C-04 | Test harness: PHPUnit/Pest categories wired (`tests/Unit`, `tests/Feature`), `.env.testing` → **PostgreSQL**, independent-connection concurrency harness ready (E15); `php artisan test` green baseline | §13.3 (l.873–886), §17.20 | 20 | RISK-peak | C-02 | Empty-green suite command documented |
| C-05 | User model + 7 account types + owner-activation gate stub + OTP request/verify path with **simulated dev OTP** (ADR-007, clearly labeled) + login throttle (`login_attempts`) | §5.1–5.2 (l.356–383), §13.4 (l.894–897) | 1, 17 | RISK-high !CUT | C-03 | Registration + OTP tests pass; throttle test passes |

## 2. M1 — Integrity core (risk peak: everything that must not fail)

| ID | Capability | Brief ref | Accept test | Risk | Depends | Evidence of done |
|---|---|---|---|---|---|---|
| C-06 | **Booking state machine** module: 15 states, closed transition table (from,to,actor,guard), `booking_events` log with real UTC timestamps; no state change outside the module | §7.2 (l.535–551), §7.3 (l.560–564) | 5, 6, 12 | RISK-peak !CUT | C-03 | Transition-exhaustiveness unit test (legal + illegal cases) |
| C-07 | **Availability + anti-double-booking (PostgreSQL, SPEC §4.2 / ADR-014):** server-authoritative windows/blocks; single transaction = status-aware `overlap SELECT` (live states only, clean Arabic conflict message on hit) → INSERT booking + fees + **`booking_occupancies` row**; **GiST exclusion constraint** `EXCLUDE USING gist (unit_id WITH =, during WITH &&)` **and** the exact-duplicate `UNIQUE (unit_id, during)` **both owned by `booking_occupancies`** — apply only to currently-occupying records (row deleted on every release transition, so historical cancelled/rejected bookings can never block rebooking; the `bookings` table carries **no** date-range uniqueness); **booking-creation idempotency** via `bookings.client_token` `UNIQUE (renter_id, client_token)` + stored fingerprint — identical replay returns the original booking with zero new rows, mismatched fingerprint → `409 BOOKING_TOKEN_REUSE` + audit entry, namespace **separate from** payment `idempotency_key` (SPEC §4.2 #6); **SQLSTATE-aware error classification (SPEC §4.2 #5, E16), no blind retries:** app re-check hit or `23P01 exclusion_violation` → clean Arabic **conflict response, never retried**; `40001`/`40P01` → **whole-operation** retry with bounded backoff **only when the entire operation can safely rerun** (idempotency key/fingerprint + transaction boundary preserved); `23505 unique_violation` → classified by **actual constraint name + operation context** (`payment_intents.idempotency_key` → §7.1 replay/409; `bookings (renter_id, client_token)` → §4.2 #6 replay/409; occupancy exact-duplicate → conflict response; other → app error) | §4.9 (l.319–332), §7.3 (l.556), §14 (l.928), §13.3 (l.883) | **7** | RISK-peak !CUT | C-06 | Concurrency suite on **PostgreSQL** with **independent connections** (one per simulated client): N parallel creates → exactly 1 success; conflict asserted as a **no-retry conflict response**; forced `40001`/`40P01` failure asserted as successful **whole-operation retry** (idempotency preserved); `23505` path asserted per constraint name; **release/rebooking test: create → cancel (and separately reject) → create again same unit + exact same period → succeeds**; **booking-creation idempotency tests: identical replay → original booking, zero new rows (no events/fees/occupancies); mismatched payload → 409 + audit entry — asserted independently of payment-idempotency tests**; no SQLite/`TransactionTestCase` mechanisms anywhere; **retry + idempotency classification counts as design until these tests run** |
| C-08 | **Money core:** `price_snapshot`/`policy_snapshot` write-once; `booking_fees` freeze at confirm; integer piastres; summary payload (rental, service, delivery, deposit, total, refundable terms) | §7.3 (l.560–562), §4.10 (l.334–350), §8.4 (l.617) | 8 | RISK-high !CUT | C-06 | Snapshot-frozen-after-confirm test; summary computation unit tests |
| C-09 | **Payment simulator + idempotency:** `PaymentProvider` interface, `SimulatedProvider` (**demo/dev-only controls, labeled «محاكاة»**), `payment_intents.idempotency_key UNIQUE` bound to request fingerprint (same key + different booking/amount/payload → 409, zero new rows), replay→same intent, provider result gates `confirmed` (never client message), security event log | §8.5 (l.632–644), §7.3 (l.556), §13.4 (l.901) | 9, **10** | RISK-peak !CUT | C-08 | Replay test: double POST pay → one intent, one capture, no duplicate ledger rows; mismatched-payload reuse → 409 with zero rows |
| C-10 | **Ledger (append-only):** owner dues / platform revenue / delivery components / deposit-as-liability legs; corrections=compensating entries; forbidden UPDATE/DELETE on ledger; settlement projection | §8.5 (l.632–644), §8.6 (l.646–648), §11.5 (l.797–799) | 15 | RISK-peak !CUT | C-09 | Ledger invariant tests + settlement math tests; mutation-attempt test fails as designed |
| C-11 | **RBAC enforcement:** role model (SPEC §6.3), server-side check on every route/action, staff-vs-customer boundary, sensitive ops → `audit_log` (who/when/what) | §11.6 (l.803–816), §13.4 (l.891) | **16**, 3 | RISK-peak !CUT | C-03, C-05 | Table-driven permission-matrix test: every cell allowed **and** denied |
| C-12 | Deposit mechanism (hold/released/deducted states; deduction only via dispute decision; **not revenue**) — policy values Pending §10.2 | §8.6 (l.646–652), §10.4 (l.736) | 13 | RISK-high !CUT | C-09 | State tests; revenue-exclusion ledger test |

## 3. M2 — Core flows (browse → list → book → handoff)

| ID | Capability | Brief ref | Accept test | Risk | Depends | Evidence of done |
|---|---|---|---|---|---|---|
| C-13 | Category tree (admin-editable) + custom fields per category + allowed rental units + seed (Fayoum-scoped config, §22.9/22.10 Pending) | §3.6 (l.168–183) | 3 | MED | C-03, C-11 | Admin CRUD test; product form renders category fields dynamically |
| C-14 | Browse: home/category pages, Arabic-aware search + filters (name/cat/city/price/duration/condition) + sort + empty-state + **pagination** | §4.5 (l.249–266), §13.3 (l.877–879) | 4 | MED | C-13 | Search/filter unit tests incl. Arabic normalization; no bulk-load query (pagination asserted) |
| C-15 | Product detail page: all 19 info groups (incl. availability calendar, deposit, delivery cost, cancellation policy label=Pending) | §4.8 (l.291–317) | 4, 8 | MED | C-14, C-16, C-07 (calendar data) | Page checklist test vs 19 groups |
| C-16 | Listing lifecycle (7 states) + admin review/approve/reject/suspend **with recorded reason** | §6.3 (l.459–473) | **3** | RISK-high | C-11 | Lifecycle transition tests; reason persisted + audited |
| C-17 | Listing form: all required fields (§6.1) + validation; duration min/max; special terms | §6.1 (l.422–443) | 2 | MED | C-13 | Create-listing test w/ validation failures |
| C-18 | Image upload: multi, primary, reorder, delete/replace, type/size validation, compressed storage, secure serving | §6.2 (l.445–455) | 2 | MED | C-17 | Upload tests incl. rejection cases; authorized serving (no direct exposure of sensitive docs) |
| C-19 | Booking request flow (multi-step → summary screen → submit) + owner approve/reject with notifications hooks | §7.1 (l.510–531), §4.10 (l.334–350) | 5, 6, 8 | MED | C-06…C-09, C-16 | End-to-end happy path + reject path tests |
| C-20 | Handoff codes: pickup + return codes (hash, expiry, **single-use**), server verification, condition record + optional photos, events logged | §7.4 (l.566–580) | **11**, 12 | RISK-high | C-06, C-19 | Code reuse/expiry tests; return completes → settling transition |
| C-21 | Cancellation + refund flow (mechanism real, **policy Pending**): cancel transition, refund legs via ledger, policy text from settings | §7.2 (l.548), §17.13, §22.4 | 13 | MED | C-09, C-10, C-12 | Cancel path tests; refund ledger test; policy rendered from settings |
| C-22 | Owner/merchant dashboard: listing list/search/sort, edit price & availability, pause, booking list, add product | §6.5 (l.490–504) | 2, 6 | MED | C-16, C-17 | Dashboard tests; owner-scoped queries asserted |
| C-23 | Delivery records (manual admin entry flag, direct-pickup choices, address, fees, statuses incl. delay/failure, proof) — ADR-009 | §9 (l.656–687) | 8, 14 | MED | C-19 | Delivery row created with booking; manual-entry path test |
| C-24 | Availability calendar UI (month view on detail + owner management screen) | §4.9 (l.323–326), §6.5 (l.495) | 7 | MED | C-07, C-17 | Calendar renders from server data; conflict shown |
| C-42 | **BADAL design system foundation (added in Final Architecture Update):** Tailwind 4 tokens (color/spacing/typography) + shadcn/ui wrapper components + shared RTL layout shell (header/nav/footer) — the reusable base every renter/merchant/admin screen builds on; enforces SPEC §6.4 contract (accessible contrast, visible focus, hierarchy; **banned defaults**: AI-style blue/purple gradients, gratuitous glassmorphism, generic-template look) | SPEC §6.4 (ADR-016/D-l), brief NFR-1 | 19 | MED | C-02 | Token/component inventory exists; checklist vs §6.4 banned-defaults list passes on a sample screen |

## 4. M3 — Operations, trust & reporting

| ID | Capability | Brief ref | Accept test | Risk | Depends | Evidence of done |
|---|---|---|---|---|---|---|
| C-25 | Notification engine: 14 events, in-app first (SMS/push adapters stubbed), **dedupe key**, delivery state recorded | §12 (l.820–841) | 1, 5, 13 | MED | C-06 | Event→notification tests; duplicate-suppression test (p.841) |
| C-26 | Reviews: only after completed booking, unique per booking, score+comment, report + admin hide/moderate | §10.1 (l.693–704) | 14 | MED | C-06, C-19 (completed booking) | Uniqueness + eligibility tests; moderation test |
| C-27 | Complaints: 11 types, attachments, reference number, status tracking, admin handling | §10.2–10.3 (l.706–731) | 14 | MED | C-11 | Create/track tests; reference uniqueness |
| C-28 | Disputes: decision recording (reason required), no penalty from uncorroborated claim, deposit link | §10.4 (l.732–736) | 13, 16 | RISK-high | C-12, C-27 | Decision tests incl. guard: deduction requires evidence ref |
| C-29 | Admin dashboard KPIs (12 groups) computed from real DB + time-range filter | §11.1 (l.742–759) | 15 | MED | C-09, C-10 | Each KPI has a fixture-based expected-value test |
| C-30 | Admin: user management, booking search by number + event log, financial views (payments/commissions/fees/refunds/payouts/settlements/export) | §11.2–11.5 (l.761–801) | 15, 16 | MED | C-10, C-11 | Search/export tests; RBAC-gated |
| C-31 | Reports per brief §19 (17 indicators, documented calculation + data source, no invented targets) | §19 (l.1123–1147) | 15 | LOW | C-29 | Indicator dictionary table (calc + source) in runbook |
| C-32 | Platform settings admin UI: edit commission/fees/limits at runtime, values labeled Pending until §22 approved, audit-logged | §6.4 (l.475–488), §14 item 22 | 16 | RISK-high | C-11 | Edit→behavior change test (e.g., fee change reflected in new summary); audit entry asserted |
| C-33 | Verification workflows: 5 states, admin review queue, ID docs need-to-know + audit | §5.4 (l.402–416) | 17 | MED | C-11 | Access-control test: only permitted roles fetch docs |
| C-34 | Privacy basics: data minimization on forms, account delete-request flow (policy Pending), retention doc section | §13.5 (l.904–908) | 17 | MED | C-05 | Delete-request path test; doc section exists |
| C-35 | Backup + **restore drill**: scheduled **PostgreSQL dump** (`pg_dump` semantics) + restore into clean DB with row verification | §13.4 (l.899–900), §18 | **18** | !CUT | C-03 | Script + documented run output proving restored data matches |
| C-41 | **Demo-data tooling (required feature; normative contract = SPEC §6.5):** admin-only «Add demo data» (**idempotent** per request token — double-run yields one batch, zero duplicate rows; the `demo_batches` registry row is **never deleted**: after Clear it persists as a tombstone with `status='cleared'`, and the same token re-submitted then returns that cleared batch, zero rows — a **new token is required** for a new batch) + «Clear demo data» (**batch-scoped, dependency-safe, complete inventory** — all 34 business tables deleted children-before-parents in one transaction per SPEC §6.5 point 3; **any failure rolls back everything**; post-check = per-table count 0 for the batch; config tables (`platform_settings`, `categories*`, `subscription_plans`, `staff_roles`) and **`audit_log` are never touched — audit history, including the Clear operation's own entry, always survives**; demo financial rows = the **single sanctioned ledger-delete exception**, enforced at the **data layer** (batch-scoped guard; `NULL` `demo_batch_id` always blocked; normal runtime gains no ledger-delete ability — design until tests run); no orphaned demo financial rows, non-demo/unmarked rows untouched **and undeletable via the clear path**, non-demo settlement totals asserted unchanged); privileged authorization (`system_admin`/`project_owner`) + CSRF + explicit typed confirmation + affected-record preview + `audit_log`; feature-flag + environment gate, **removed/disabled before production with tests asserting denial in production mode** | §13.1, §16 (demo/simulation rules), SPEC §6.5 (§6.4 labeling) | 19, 20 | RISK-high | C-03, C-11 | Seeded demo set with provenance IDs; tests per SPEC §6.5 (a–i): complete inventory cleanup with zero remaining batch rows, no orphan demo financial rows, audit_log preserved **incl. the Clear op's own entry**, non-demo/unmarked rows untouched and undeletable via the clear path, non-demo settlement totals unchanged, Add idempotency **before and after a clear** (same token → cleared tombstone, new token → new batch), ledger guard rejects non-batch deletes, production-mode denial green |

## 5. S — Acceptance sweep (42–48h)

| ID | Capability | Brief ref | Accept test | Risk | Depends | Evidence of done |
|---|---|---|---|---|---|---|
| C-36 | **Full §17 pass:** all 20 tests executed, each with pass/fail + evidence pointer (test output, session notes, screenshots for device tests) | §17 (l.1065–1091) | 1–20 | RISK-peak | all core rows | Acceptance matrix: 20/20 with artifacts (failures → fix loop, never re-label) |
| C-37 | Responsive/RTL device pass on target screens; usability check: price/duration/deposit/location prominent; **design-contract pass vs SPEC §6.4** (contrast/focus/hierarchy, banned defaults, labeled demo data, designed loading/empty/error/success states) | §4.1 (l.197–204), §17.19 | 19 | MED | C-14, C-15, C-19, C-42 | Device checklist w/ notes + §6.4 contract checklist |
| C-38 | Exception-suite sweep (error states): expired code, double code use, race on booking, payment timeout, mid-flow cancel, permission-denied, offline/retry messaging | §13.3 (l.882), §17.20 | **20** | RISK-peak | C-06, C-07, C-09, C-20 | Error-suite green |
| C-39 | Deliverables package: source, schema, API/contract doc (SPEC), run/deploy/runbook, test results, admin guide skeleton, OSS license inventory, open-decisions register snapshot | §18 (l.1096–1119) | — | MED | C-36 | Package directory listing + each item present |
| C-40 | Final traceability re-check: every brief §16 core function ↔ capability row; every §17 test ↔ row; no Pending value hard-coded; `!CUT` rows all green | §16, §17, §22 | all | !CUT | C-36…C-39 | Traceability report appended to this file (post-build section) |

---

## 6. Dependency summary (critical chains)

```
C-01 → C-02 → C-03 → C-04
              → C-05 → C-11 (RBAC) → C-16, C-32, C-33, C-41 …
              → C-06 → C-07 (!CUT core) → C-24, C-15
                    → C-08 → C-09 → C-10 → C-29/C-30
C-13 → C-14 → C-15 ; C-16/17/18 → C-19 → C-20 → C-21/C-23
C-02 → C-42 (design system) → C-37 (§6.4 pass)
M3 rows (C-25…C-35, C-41) hang off M1 core; C-35 anytime after C-03
S: C-36 needs the §17-relevant subset of C-05…C-42
```

Highest-leverage early risk burn-down: **C-01 (env), C-07 (concurrency), C-09/C-10 (money), C-11 (authz)** — these four decide whether the stack choice survives contact with reality (Assessment §9, §11). Rows **C-41/C-42** were added in the Final Architecture Update (demo-data feature per owner directive; UI design contract per D-l) — IDs are stable references, their table position follows slice logic, not ID order.

---

## 7. Explicitly out of scope for Phase 2 build (deferred per brief/owner)

Native iOS/Android (§22.11), internal wallet, AI pricing, loyalty, recommendation engine, multi-carrier integration (after official API verified, p.686), real payment provider (after §22.6 decision), SMS/push provider wiring (labeled stubs), CI/CD (not in approved phase scope), English localization (addable later, §4.1). Each deferred item must be visible in the §10.2 open-decisions register or brief §16 deferred list — no silent omissions.

---

*End of capability map. Post-build, section 8 will hold the completed traceability evidence (C-40).*
