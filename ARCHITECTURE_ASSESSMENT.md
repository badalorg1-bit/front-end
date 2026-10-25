# BADAL — Architecture Assessment (Phase 1)

**Document type:** ADR-style architecture assessment
**Status:** Stack **Approved** by owner directive (Laravel + React + TypeScript + Inertia.js + Tailwind CSS + shadcn/ui + PostgreSQL — decision D-i, §1.2); the earlier Django recommendation (§5) is **Superseded**. Document sign-off and coding permission remain separate gates (assessment approval ≠ permission to start Phase 2 / M0).
**Author:** OpenCode agent (evidence-driven review)
**Date:** 2026-10-16
**Requirements source:** `B:\badal\badal.txt` — Arabic Project Brief & SRS for بدّال (BADAL), 1,349 lines, owner-approved as authoritative (see §1.1 note on the missing `docs/BADAL_PROJECT_BRIEF.txt` path).
**Companion artifacts:** `SPEC.md`, `tasks/capability-map.md`

---

## 1. Context and verified constraints

### 1.1 What is being built

بدّال (BADAL) is a multi-sided rental marketplace for Egypt (Fayoum pilot first) covering products, properties, services, events equipment and more (brief §1–§3). Phase 1 MVP scope as **approved** (decision D-d now **Approved** — the owner's stack directive D-i fixes the customer product as a polished responsive Arabic RTL **website** plus an **admin dashboard** implemented as a **custom React/Inertia interface on the Laravel backend** (Laravel ships no Django-style admin panel — E11/E17; no third-party admin package without explicit owner approval), settling brief §22.11 "required platforms for first release" for MVP) = responsive Arabic RTL web app (renter + owner) + admin dashboard; native Android/iOS remain deferred for MVP (§22.14 stays moot/Pending while no native target exists). Full rental lifecycle must work end-to-end: search → booking request → owner approval → payment (simulated gateway, real ledger) → handoff codes → return → settlement → rating/complaints (brief §7, §16).

### 1.2 Owner decisions from this conversation (statuses honest)

| # | Decision | Status |
|---|---|---|
| D-a | Source of truth = `badal.txt` (owner-verified complete); `docs/BADAL_PROJECT_BRIEF.txt` does not exist — record discrepancy in SPEC | **Approved** |
| D-b | Payments = simulated gateway with real ledger / state machine / audit / idempotency; real provider swapped in later | **Approved** |
| D-c | Architecture = open, evidence-driven, framework-agnostic, no pre-commitment; all 7 candidates evaluated — the §4 matrix compares the 6 remaining candidates (10 criteria), and C7's exclusion is documented separately with evidence (§3.1) | **Approved** |
| D-d | MVP platforms = responsive Arabic RTL web (renter + owner) + admin dashboard; native apps deferred | **Approved** (fixed by D-i: website + admin; native stays deferred, brief §22.11 resolved for MVP) |
| D-e | ≤48h competition-ready MVP = optimization objective, **never** a guarantee; never weaken authorization, booking integrity, or financial correctness for speed | **Approved** |
| D-f | Docs in English with Arabic domain terms (حجز, مؤجر, مستأجر, عمولة, تأمين…) | **Approved** |
| D-g | No invented weights/scores/benchmarks; unapproved commercial terms recorded as *Pending* | **Approved** |
| D-h | Adversarial review manual/local; no external models, no data uploads | **Approved** |
| D-i | **Stack:** Laravel (PHP) backend; React + TypeScript + Inertia.js frontend (one app — no separate Next.js app, no independent API service); Tailwind CSS + shadcn/ui + custom BADAL design system; **PostgreSQL** for local dev, tests, and deployment. Owner-selected, not agent-recommended — supersedes the §5 Django recommendation | **Approved** |
| D-j | Deployment: **public demo URL + local fallback both approved**; the hosting provider (and its cost) remains **Pending** (§10 row) | **Approved** (provider Pending) |
| D-k | OTP: **simulated only** for authorized demo/dev — never real SMS in MVP (reaffirms ADR-007). Payment: **simulated provider** with real states/idempotency/ledger/audit, no real transactions (reaffirms D-b) | **Approved** |
| D-l | UI quality bar: polished, responsive, Arabic RTL, accessible (contrast/focus/hierarchy); **banned defaults**: AI-style blue/purple gradients, gratuitous glassmorphism, generic template with swapped logo; real experience for customers + merchants, demo/synthetic data clearly labeled, no invented counts/reviews/ratings/revenue | **Approved** |

### 1.3 Verified machine/environment facts (evidence E7)

| Fact | Value |
|---|---|
| OS | Windows 10 Pro x64 (build 19045), PowerShell 5.1 |
| RAM | ~8 GB total, ~0.7 GB free at probe time — **hard constraint on dev-server/build memory** |
| Disk | C: 37.8 GB free; B: 2.5 GB free |
| Node / npm | v24.14.0 / 11.9.0 — registry reachable (PONG 714 ms) |
| Python / pip | 3.11.9 (Microsoft Store delivery) / pip 24.0; stdlib `sqlite3` 3.45.1 |
| git | 2.51.1; repo `B:\badal` on branch `master`, **no commits yet**, only untracked `badal.txt` |
| winget | Present; `winget search` shows **.NET SDK 8.0/10.0** and **PHP 8.1–8.5** installable (E9) |
| Missing | **PHP, Composer (no winget package, E9), PostgreSQL server** (psql absent), .NET SDK, Ruby, Go, Java, docker, mysql/sqlite3 CLI, pnpm/yarn — M0 must provision PHP+extensions, Composer, and PostgreSQL (D-i); **no silent fallback** to SQLite/Django/Next.js/MySQL/another framework if setup fails — report to owner and pause (§9 R-2) |
| Playwright | Browsers installed (available for verification later) |

### 1.4 Environment-derived version facts (evidence E8, E9) + official-doc facts for the approved stack (E10–E17)

- Django latest = **6.1.2 requires Python ≥ 3.12** → on this machine's Python 3.11.9 the installable line is **Django 5.2 LTS** (last release supporting 3.11 in the 5.x line). *Historical — Django is superseded by D-i; recorded for the evidence trail, not a live option.*
- FastAPI 0.143.2 requires Python ≥ 3.10 → installable. *Historical (same note).*
- C5 (.NET) and C6 (Laravel/PHP) were **not hard-blocked**: winget can install both runtimes; C6 additionally needs a **manual Composer bootstrap** (absent from winget, E9). C6 is now the **owner-selected** stack (D-i) — its bootstrap cost moves into the M0 environment gate (§8, R-2), not a comparison penalty.
- **Laravel (official docs, E10):** current major line is **Laravel 13.x** (2026); official install path is `php.new` tooling → **PHP 8.5**, Composer + Laravel installer; SQLite is the default local DB but `.env` `DB_*` settings switch it to PostgreSQL with no code change; Vite is the asset pipeline.
- **React starter kit (E11):** Laravel's official React starter kit ships exactly the owner-approved UI stack — **React 19, Inertia.js 3, TypeScript, Tailwind CSS 4, shadcn/ui**, Fortify auth, optional teams, Wayfinder typed routing, optional SSR (`npm run build:ssr`), 2FA, rate limiting.
- **Inertia server-side (E12):** `composer require inertiajs/inertia-laravel`; root Blade view uses `<x-inertia::head />` / `<x-inertia::app />` v3 components; `php artisan inertia:middleware`; `HandleInertiaRequests` appended to the web group in `bootstrap/app.php`.
- **PostgreSQL (E13):** current stable **PG 18** (PG 19 RC1 dated 2026-10-15); native range types (`tsrange`/`tstzrange`/`daterange`) + **exclusion constraints** (`EXCLUDE USING gist (… WITH &&)`) + `btree_gist` for scalar+range rules; official docs §8.17.10 state UNIQUE indexes are the wrong tool for range overlap — use an exclusion constraint.
- **shadcn/ui (E14):** dedicated **Laravel** installation path (`laravel new` → React starter kit → `npx shadcn@latest init`) and a Vite path with an `--rtl` CLI flag relevant to the Arabic RTL requirement.
- **Testing (E15):** Laravel 13 testing = `php artisan test` (or Pest/PHPUnit), `tests/Feature` + `tests/Unit`, `.env.testing`, parallel testing with per-process databases — maps directly to the independent-connection concurrency tests (§8, R-1).

**Skills honesty (report item):** the machine's installed skill sources were inventoried in full (`.config\opencode\skills` ~73, `.agents\skills` 24, `.config\opencode\skills-hub` ~120 across `ai-automation-skills` / `marketing-skills` / `github` / `social-media-skills`; **zero skills inside this project** — no project `SKILL.md` exists in `B:\badal`). They contain **no PHP or Laravel skill, no PostgreSQL/database-schema-design skill, no financial/ledger-integrity skill, and no data-lifecycle/seed-cleanup skill** — implementation guidance for Phase 2 will come from the official Laravel/Inertia/PostgreSQL docs verified above (E10–E15), not from a local playbook; the closest installed matches (`security-and-hardening`, `test-driven-development`, `source-driven-development`, `documentation-and-adrs`, `api-and-interface-design`) are consulted only as generic engineering process. `billing-automation` covers SaaS subscription billing, not marketplace ledger integrity, and is not treated as authority here.

---

## 2. Requirements distilled for architecture evaluation

### 2.1 Hard requirements (must hold regardless of framework)

| ID | Requirement | Brief ref |
|---|---|---|
| HR-1 | Arabic-first, RTL, responsive web + admin; English-addable later | §4.1 |
| HR-2 | Server-side authoritative availability; **no double booking** for single-unit inventory; multi-unit stock for merchants | §4.9, §7.3, §21.3 |
| HR-3 | Booking = explicit 15-state machine with defined transitions; all events timestamped | §7.2 |
| HR-4 | Price/policy **snapshot frozen at booking time**; no post-confirmation tampering of dates/price | §7.3, §14 p.939 |
| HR-5 | Payment records: per-transaction log, provider reference, failure handling, **duplicate-prevention (idempotency)**, refunds, separation of owner dues vs platform revenue, full audit | §8.5 |
| HR-6 | Handoff codes: single-booking-bound, time-limited, single-use, server-verified, logged | §7.4 |
| HR-7 | RBAC with least privilege + audit log for sensitive actions | §11.6 |
| HR-8 | Security baseline: HTTPS, hashed passwords, rate-limited login, API protection, no card data storage, security-event log, backup + restore test | §13.4 |
| HR-9 | 22 entity groups modeled with clear relations + anti-duplication/anti-conflict constraints | §14 |
| HR-10 | Categories/fields admin-editable without code changes | §3.6 |
| HR-11 | Deliverables: full source, DB schema, API docs, run/deploy instructions — owner can operate and migrate away | §18 |
| HR-12 | Acceptance = 20 concrete tests, documented results | §17 |
| HR-13 | Nothing security-, rights-, or finance-related may be deferred to hit scope | §16 p.1061 |

### 2.2 Evaluation criteria (owner-approved set of 10; no weights assigned)

| # | Criterion | What "good" means here |
|---|---|---|
| CR-1 | Business fit | RTL Arabic UX, multi-role (7 account types §5.2), admin-heavy marketplace, categories-as-data |
| CR-2 | 48-hour MVP speed | Minimal boilerplate to a working end-to-end rental loop + admin; small critical path |
| CR-3 | Dev & test ergonomics | One dev + AI agent; batteries-included testing; fast local feedback |
| CR-4 | Security & authz | Framework-level protections (CSRF, sessions, hashing, RBAC primitives) over hand-rolled |
| CR-5 | DB integrity & transactions | First-class transactions, constraint support, verified anti-double-booking pattern (SQLite wording at evaluation time; **governing bar under D-i = the PostgreSQL mechanism in §4.1**) |
| CR-6 | Payment-simulation fit | Easy idempotent writes, ledger tables, state machine, audit — framework-neutral but frictionless |
| CR-7 | Performance & resource use | Must run inside ~0.7 GB free RAM (dev server + build) |
| CR-8 | Deploy & operate | Single-person operation on Windows; simple local demo; portable later |
| CR-9 | Maintainability & scale | Clear structure, Postgres-portable schema, low long-term friction |
| CR-10 | Cost, dependencies, risk | Free/open-source, license-clean (brief p.1116), low supply-chain/bootstrap risk **on this machine** |

**Assumption recorded (single point of failure for CR-3):** equal TS/Python familiarity is assumed because the AI agent writes most code. If the owner has a strong language preference, re-run CR-3 — this is the one input most likely to flip the recommendation.

---

## 3. Candidates (all 7 retained until evidence says otherwise)

> **Update (D-i):** the owner has **selected C6 (Laravel)** and defined its concrete shape — Laravel + React + TypeScript + Inertia + Tailwind + shadcn/ui + PostgreSQL. The table below is the *pre-decision* feasibility evidence; C6's row is now the chosen path, all other rows are historical comparison material only.

| ID | Candidate | Bootstrap feasibility on this machine (E7/E9) |
|---|---|---|
| C1 | **Next.js full-stack** (TypeScript, App Router, route handlers [E6], SQLite via ORM/driver) | ✅ node/npm verified; no extra runtime needed — **not chosen** (owner picked Inertia-in-Laravel instead of a separate Next app, D-i) |
| C2 | **Django** (Python, server-rendered templates + HTMX/vanilla JS, SQLite; optional React islands later) | ✅ pip verified; Django 5.2 LTS resolves on Python 3.11 [E8] — **recommendation Superseded by D-i** |
| C3 | **FastAPI + React (Vite)** separate API + SPA | ✅ both toolchains present; two apps to wire |
| C4 | **NestJS + React** | ✅ npm; Nest boilerplate (modules/decorators) adds code |
| C5 | **ASP.NET Core + React** | ⚠️ SDK absent but `winget install Microsoft.DotNet.SDK.8` available [E9]; largest runtime install |
| C6 | **Laravel (PHP) + Blade/Livewire or Vue** — *as selected:* **Laravel 13.x + React 19 + Inertia 3 + TypeScript + Tailwind 4 + shadcn/ui via the official React starter kit (E10/E11)** | ⚠️→M0: PHP via winget/php.new + **manual Composer** (no winget pkg, E9) + PostgreSQL provisioning + Node build — all become the **M0 environment gate**, with report-and-pause on failure (§8, R-2) |
| C7 | **BaaS (Supabase/Firebase/managed backend)** | ❌ see §3.1 — excluded **with documented evidence**, not silently dropped |

### 3.1 C7 — documented exclusion evidence

1. **Deliverable conflict (HR-11 / brief p.1101, p.1103, p.1105):** BaaS requires handing the owner a managed-service dependency for the database and auth; the brief demands full source, DB schema, and the owner's ability to operate/migrate independently. BaaS makes the DB/auth layer a third-party contract, not a deliverable.
2. **Payment-ledger integrity (HR-5 / §8.5):** the real ledger + audit must sit behind server code we fully control; BaaS row-level security adds a second policy engine to audit inside a 48h window.
3. **Environment/ops conflict:** BaaS requires external accounts, API keys, and always-on network; the owner's review policy is local/manual with no external uploads, and the competition demo must run without third-party service sign-ups (decision deferred, never assumed — brief p.1283 forbids turning assumptions into shipped features).
4. **Egypt-specific privacy posture (§13.5 p.908):** data-residency and Egyptian personal-data-law compliance are simpler with a self-hosted single-file DB in MVP.

→ **Verdict: Excluded for MVP with evidence above; revisit only if the owner explicitly approves external accounts and accepts the §18 deliverable trade-off.**

---

## 4. Evidence matrix (10 criteria × remaining 6 candidates)

> **Status: historical evidence, superseded as a *decision instrument*.** This matrix produced the agent's Django recommendation, which the owner **superseded by selecting Laravel (D-i)**. It is retained per owner rule D-c (evaluation transparency) — not rewritten to favor the chosen stack, and not presented as if Laravel had been scored or installed/tested here. Laravel was chosen by owner decision; its environment proof is an **M0 gate** (§8), not a claim of this document.

Legend: ✅ meets with cited evidence · ⚠️ meets with a documented, mitigable gap · ❌ documented blocker for the 48h MVP (not an absolute technical impossibility).

All seven candidates were evaluated (§3). C7 is deliberately absent from this matrix because it is excluded with documented evidence (§3.1) — **this is a 10-criteria × 6-candidate comparison, not 10 × 7.**

| Criterion | C1 Next.js | C2 Django | C3 FastAPI+React | C4 NestJS+React | C5 ASP.NET+React | C6 Laravel |
|---|---|---|---|---|---|---|
| CR-1 Business fit | ✅ RTL SPA; admin to build | ✅ SSR RTL; **admin framework maps §11** | ✅ API fine; UI+admin to build | ✅ same as C3 | ✅ same as C3 | ✅ Blade RTL; admin needs package |
| CR-2 48h speed | ⚠️ one language, but admin + all UI written from scratch; heavier build | ✅ auth/forms/admin/migrations batteries; SSR needs less UI code | ⚠️ two apps, hand-rolled auth/admin | ⚠️ boilerplate-heavy (modules/decorators) | ⚠️ + SDK install step, heavier stack | ⚠️ + PHP & Composer bootstrap |
| CR-3 Dev/test ergonomics | ✅ TS end-to-end; tests need vitest/jsdom setup | ✅ built-in test client/runner; `TestCase`/`TransactionTestCase` guidance [E3] | ⚠️ pytest good, but auth/admin/CSRF assembled by hand | ✅ Jest/Nest testing module | ⚠️ xUnit good; setup heavier | ⚠️ PHPUnit fine; extra toolchain |
| CR-4 Security & authz | ⚠️ sessions/CSRF/passwords via libs (Auth.js etc.) — more choices, more wiring | ✅ CSRF, sessions, password hashing, permission framework built-in | ❌ hand-rolled baseline (framework defaults lack CSRF/session batteries) | ⚠️ guards/decorators; library choices still manual | ✅ Identity + antiforgery built-in | ✅ auth/sanitization/session batteries |
| CR-5 DB integrity & transactions | ⚠️ Prisma/Drizzle transactions work; constraint patterns must be coded carefully | ✅ `atomic()` + IntegrityError pattern + `UniqueConstraint(condition)` → partial unique index on SQLite [E3,E5]; **`select_for_update` is a no-op on SQLite [E4]** → design = serialized write txn (E1) for both, documented identically | ⚠️ SQLAlchemy pattern-equivalent, more config | ⚠️ TypeORM/Prisma equivalent | ✅ EF Core + SQLite OK | ✅ Eloquent/transactions OK |
| CR-6 Payment-simulation fit | ✅ route handler writes ledger + idempotency key | ✅ same logic in view/service | ✅ same | ✅ same | ✅ same | ✅ same — **neutral across candidates by design** |
| CR-7 Performance & RAM | ⚠️ Next dev server + build are the heaviest option on 0.7 GB free RAM; build-OOM mitigation required | ✅ `runserver` + templates, no SPA compile step; lightest footprint | ⚠️ Vite build + API process | ⚠️ webpack/vite build + Node | ⚠️ dotnet build memory + install | ✅ PHP CLI light, but toolchain cost moves to CR-2 |
| CR-8 Deploy & operate | ✅ `next start` / standalone output | ✅ single process; static collected; Windows-friendly | ⚠️ two processes to run/supervise | ⚠️ two processes | ⚠️ Kestrel fine, first-time setup heavier | ✅ built-in server fine for demo |
| CR-9 Maintainability & scale | ✅ strong typing; keep DB portable | ✅ standard path SQLite→Postgres; Django docs stable [E3,E5] | ✅ clean boundary, more glue code | ✅ structured, verbose | ✅ solid ecosystem | ✅ solid ecosystem |
| CR-10 Cost/deps/risk | ✅ npm verified [E7] | ⚠️ **Store-delivered Python pip-install must be verified at M0** (mitigation: `pip install --user` / venv; fallback documented in §9 R-2) | ✅ same pip note applies | ✅ npm verified | ⚠️ large SDK download (winget OK) [E9] | ⚠️ Composer manual bootstrap [E9] |

**Method note (per owner rule D-g):** cells are qualitative ✅/⚠️/❌ with a cited reason — **no numeric scores, no weights, no benchmark numbers were invented.** Where evidence was not fetched (e.g., per-framework blog benchmarks), the cell was resolved by official docs (E1–E6) or local probes (E7–E9) only.

### 4.1 Verified mechanism for the approved stack (PostgreSQL everywhere — D-i)

Anti-double-booking on **PostgreSQL** (design; proof = M1 concurrency gate, §11 T2). Four cooperating layers — none of them alone is claimed as sufficient:

1. **Range types + GiST indexes (E13).** Booking periods are stored as PG range types (`tstzrange`/`daterange`) with GiST indexes on them; `btree_gist` supplies the scalar equality arm. Overlap (`&&`), containment and index support are native PG capabilities (official range-types docs).
2. **Exclusion constraint as hard backstop (E13).** `EXCLUDE USING gist (unit_id WITH =, during WITH &&)` makes a conflicting overlap impossible at the storage layer — the official docs explicitly say UNIQUE indexes are the wrong tool for range overlap (§8.17.10). Because an exclusion constraint applies to *every row of its table*, occupancy is modeled so only **live** bookings occupy the range: a derived `booking_occupancies (unit_id, during)` row is inserted/removed **in the same transaction** as the booking's state transition (occupied states = all non-cancelled/non-rejected lifecycle states; cancelled/rejected/terminal-release transitions delete the row so a dead booking never blocks rebooking). The exclusion constraint sits on that table. Multi-unit products get one occupancy row per physical unit; single-unit exclusivity follows automatically.
3. **Transactional app-level re-check (status-aware).** The booking write path is one DB transaction: overlap `SELECT` filtered by live states → clean Arabic conflict message on hit → `INSERT` (+ occupancy row). The app check is what produces *legible* errors and status semantics; the constraint is the *backstop* when two writers race past the check. Client-side guards (disabled double-click) are UX only and never counted as a correctness control.
4. **Exact-duplicate backstop — owned by `booking_occupancies`, scoped to currently-occupying records.** The exact-duplicate rule ("no more than one booking for the same unit in the same period", brief l.557) is `UNIQUE (unit_id, during)` **on the occupancy table** — the same table as the exclusion constraint, so both apply **only while a booking actually holds the range** (occupancy rows are deleted with every release transition, layer 2). The `bookings` table deliberately carries **no** `(unit_id, start_at, end_at)` uniqueness: cancelled/rejected bookings keep their `bookings` row for history but hold no occupancy row, so **historical cancelled/rejected bookings can never block a valid rebooking of the same unit and exact period** (spec-guarded by the release/rebooking test in SPEC §4.2 #4 / §8). Redundancy is intentional: the exclusion constraint catches *any overlap* (`23P01`, never retried), this named unique catches *exact-equality duplicates* (`23505`, cheap btree, distinct constraint name for classification below).

**Transaction/retry rules (SQLSTATE-aware — E16):** every failure class has exactly one permitted response. A **genuine overlap conflict** (status-aware re-check hit or `23P01 exclusion_violation` on the occupancy table) maps to a clean user conflict error and is **never retried** — re-running a true conflict cannot succeed. `40001 serialization_failure` / `40P01 deadlock_detected` (class 40) are retried as the **entire operation** with bounded attempts and backoff, **only when the whole operation can safely rerun** with its idempotency key and transaction boundary preserved. `23505 unique_violation` (class 23; PG reports the constraint name) is classified by **actual constraint name + operation context** — `payment_intents.idempotency_key` → payment idempotency rules (SPEC §7.1); `bookings (renter_id, client_token)` → booking-creation replay/`409` (SPEC §4.2 #6 — a contract **separate from** payment idempotency: distinct key namespaces, independent tests); `booking_occupancies (unit_id, during)` exact-duplicate → conflict response — never a blind retry. A partial retry of a half-committed write is always forbidden. Concurrency is proven by PG integration tests using **independent parallel connections** (one per simulated client), run through `php artisan test` with per-process test databases (E15) — a single shared connection proves nothing.

**SQLite mechanisms are historical only (superseded path).** The previously documented `BEGIN IMMEDIATE` write-lock dance, `busy_timeout`, and whole-transaction `SQLITE_BUSY` retry (evidence E1) described the superseded SQLite candidate. Under D-i, PostgreSQL is the database for local dev, tests, **and** deployment — **no SQLite fallback** in any environment, and those SQLite-specific instructions are not carried into the Laravel implementation (re-deriving them mechanically would be wrong).

---

## 5. Recommendation and runner-up trade-off

> **SUPERSEDED by owner decision D-i (§1.2).** The section below is retained verbatim as the historical, evidence-based recommendation that preceded the owner's stack selection. The owner selected **C6 — Laravel + React + TypeScript + Inertia.js + Tailwind CSS + shadcn/ui + PostgreSQL**; that selection is the governing architecture decision. Nothing here may be read as an agent claim that Laravel was scored in §4, installed, or tested on this machine — its proof is the M0 environment gate (§8, R-2). Comparison conclusions in this section are frozen history, not live guidance.

### 5.1 Original recommendation (historical): **C2 — Django (server-rendered RTL + HTMX/vanilla JS, SQLite, Django admin for §11)** — *was: Proposed · now: **Superseded***

Why, strictly from the matrix:

- **CR-2 (48h speed)** — the brief's heaviest admin surface (§11: users, ads, bookings, finance, RBAC, audit) is largely served by Django's admin framework, which maps directly to those screens; auth, forms, CSRF, migrations, and the test runner ship in-framework. Fewer new files to reach "all core operations interconnected" (brief p.1349).
- **CR-4/CR-5 (security + DB integrity)** — the two criteria the owner forbids trading for speed (D-e) have the most *officially documented* ready-made patterns here: CSRF/session/hash/permissions built-in; `atomic()` + `IntegrityError` transaction pattern and `UniqueConstraint(condition)` partial-unique-index support verified against official docs (E3, E5), plus the honest SQLite lock caveat (E4) handled by design (§4.1).
- **CR-7 (RAM)** — no SPA compile step in the default path; template rendering + SQLite is the lightest verified option for ~0.7 GB free RAM. Next.js dev/build is the heaviest (matrix CR-7).
- **CR-1** — brief p.859–871 explicitly allows "تقنية مكافئة" (equivalent technology) and states the listed stacks are *not required* ("لا يُشترط استخدام هذه التقنيات تحديدًا", p.871); RTL server-rendered UI satisfies §4.1, and React islands/HTMX can be added per-page without changing architecture.
- Trade-off accepted: the brief *suggests* React/Next.js for site+admin (p.864) — deviation is documented here and will be recorded as ADR-001 (Proposed) in SPEC, not silently.

### 5.2 Original runner-up (historical): **C1 — Next.js full-stack**

- **Wins:** one language end-to-end, strong typing across API + UI, verified route-handler model (E6), single runtime.
- **Costs:** the §11 admin panel and every UI screen are written from scratch inside 48h; dev-server/build RAM pressure is the top OOM risk on this machine; security baseline (CSRF/session/password policy) is assembled from libraries rather than batteries-included; test harness setup is manual.
- **Swap condition (documented, not invented):** if the owner states a TypeScript-only preference, C1 becomes primary **with** these mitigations required in M0: SSR-first pages, no unnecessary client-side hydration, vendored/local assets, build memory budget checks, explicit auth/session design review. *Note: the owner's D-i decision delivers TypeScript end-to-end **inside Laravel** via the React starter kit — the original "TypeScript preference" swap condition is thereby satisfied without the Next.js swap.*
- C3/C4/C5/C6 remain viable outside the 48h constraint; they lose on bootstrap cost + batteries gaps for *this* machine and window (documented in §4), not on absolute capability. *C6 is now the chosen stack by owner decision (D-i); its bootstrap gap is an M0 gate, not a comparison loss.*

---

## 6. Target architecture (approved implementation shape — D-i: Laravel + Inertia/React + PostgreSQL)

```mermaid
flowchart TB
    subgraph Clients
        W[Renter/Owner RTL Web<br/>React 19 + TypeScript via Inertia<br/>Tailwind + shadcn/ui + design system]
        A[Admin Dashboard §11<br/>Custom React/Inertia admin (no admin package)<br/>RBAC + audit log]
    end
    subgraph App[Laravel application - single deployable]
        P[Inertia controllers / routes<br/>Wayfinder typed endpoints]
        B[Booking service<br/>15-state machine §7.2]
        PAY[Payment simulator<br/>idempotency + ledger §8.5]
        AUTH[Authn/Authz<br/>Fortify sessions + RBAC §11.6]
        NOT[Notification service<br/>in-app + dedupe §12]
    end
    subgraph Data
        DB[(PostgreSQL 18<br/>dev + tests + deploy · 22 entity groups §14<br/>range types + GiST exclusion §4.1)]
        FS[Local media store §6.2<br/>replaceable by object storage]
        AUD[(Audit + event log<br/>§11.6, §7.3)]
    end
    W --> P
    A --> P
    P --> AUTH
    P --> B
    P --> PAY
    P --> NOT
    B --> DB
    PAY --> DB
    B --> AUD
    PAY --> AUD
    AUTH --> AUD
    P --> FS
```

Notes on the diagram: **one application** (no separate Next.js app, no independent API service — D-i); Vite builds the React/TS bundle (Tailwind 4 + shadcn/ui components); PostgreSQL is the only database in dev, test, and deploy (no SQLite anywhere — §4.1); UI layer follows D-l's quality bar (documented as principles in SPEC §6.4 — no UI code in this phase).

Layering rules (implementation-neutral, carried into SPEC):

1. **UI → handlers → services → repositories/DB**; no client-side authority over availability, price, or state (brief p.332).
2. **All state transitions** for حجز go through one guarded state-machine module (single source for §7.2's 15 states).
3. **All money** moves only through the payment/ledger module; ledger rows are append-only; corrections are new rows (§8.5).
4. **All authz** decisions go through one RBAC check per route/action — UI hiding is never the control (owner rule; §11.6).
5. **Timestamps** stored UTC, rendered in Africa/Cairo; every state change and money movement persists `occurred_at` (brief p.564).

---

## 7. Payment simulation — boundaries (approved decision D-b)

| In scope for MVP (real mechanics) | Out of scope (stub / Pending) |
|---|---|
| Payment intent record per booking attempt (§8.5) | Real provider selection — **Pending (§22.6)** |
| Idempotency key per intent → exactly-once capture (prevents duplicate posting, §8.5 / p.1180) | Card/token handling (explicitly never stored, p.896) |
| Append-only ledger: rental, commission, delivery fee, deposit, refund legs; owner dues separated from platform revenue (p.643) | Actual bank/wallet settlement |
| Deterministic simulator outcomes (success/failure/timeout→pending→re-query) with provider-style reference numbers | Real 3-D Secure / OTP from a bank |
| Separated state machines: payment intent `pending → succeeded \| failed` (`payment_intents.status`, SPEC §7.1); refund lifecycle lives on `refunds` records + reversing ledger legs (SPEC §4.1 #12, §7.2). Booking effects are limited to explicit valid transitions of the **15-state** machine (brief §7.2 p.535–549): intent *succeeded* → `payment_processing → confirmed`; intent *failed* → `payment_processing → awaiting_payment` (retry) or `→ cancelled` per configured policy; payment anomaly → `payment_processing → disputed`. `failed`, `refunding`, `refunded` are **never** booking states | Dynamic commercial values (10% commission, EGP 5 fees, Premium, deposit policy) — **Pending (§22.1–5)** |
| Audit rows for every money event; snapshot of agreed price/policy at booking (§7.3, §14 p.939) | |

Rule: until the owner approves §22 commercial terms, fee/commission **rates** render from platform settings (§14 item 22) with *no* hard-coded defaults shipped as final behavior.

---

## 8. ≤48h critical path (optimization objective, never a guarantee — D-e)

Sequenced risk-first: the riskiest correctness surfaces are built and tested first (detail in `tasks/capability-map.md`).

| Window | Slice | Contents | Est. |
|---|---|---|---|
| 0–6h | **M0 Foundation (environment gate first)** | **Verify/install per official docs (E10): compatible PHP 8.5 + required extensions, Composer, Node/npm against the official React starter kit (E11), provision/verify PostgreSQL (E13), filesystem write + memory headroom; record actual outputs/versions.** Then scaffold from the official Laravel React starter kit (Inertia/TS/Tailwind/shadcn — E11/E14); migrations for **all 22 entity groups** (SPEC §4.1, C-03) on PostgreSQL; auth — phone + OTP *simulated* in dev (C-05); starter-kit auth flow + `php artisan test` harness green (C-04). **On any setup failure: report → document alternatives → pause → ask owner; no silent fallback** (R-2) | ~6h |
| 6–20h | **M1 Integrity core (risk peak)** | Availability recheck + PG exclusion-constraint double-booking guard + independent-connection concurrency tests (§17.7, C-07); 15-state machine + `booking_events` log (C-06); price/policy snapshot (§17.8, C-08); payment simulator + ledger + idempotency (§17.9, §17.10, C-09/C-10); RBAC enforcement + permission tests (§17.16, C-11); deposit states (C-12) | ~14h |
| 20–34h | **M2 Marketplace flows** | Categories + search/filter (§17.4, C-13/C-14); product detail incl. 19 info groups (C-15); listing lifecycle + admin review/publish (§17.3, C-16); listing form + image upload (§17.2, C-17/C-18); booking flow + owner approve/reject (§17.5, §17.6, C-19); handoff codes + return records (§17.11, §17.12, C-20); cancel/refund path (§17.13, C-21); owner dashboard (C-22); delivery records (C-23); availability calendar UI (C-24); **BADAL design-system foundation (Tailwind tokens + shadcn wrappers + RTL shell, SPEC §6.4, C-42)** | ~14h |
| 34–42h | **M3 Operations** | In-app notifications + dedupe (C-25); reviews (C-26); complaints (§17.14, C-27); disputes (C-28); **admin §11 KPI + financial views** (§17.15, C-29/C-30); reports (C-31); configurable fees, Pending-aware (C-32); verification workflows (C-33); privacy basics (C-34); backup script + **restore test (§17.18, C-35)**; **demo-data add/clear tooling with provenance-tagged, batch-scoped cleanup (SPEC §6.5, C-41)** | ~8h |
| 42–48h | **Acceptance sweep** | Run §17's 20 tests end-to-end, document results, fix must-fix defects, exception/error states (§17.20), responsive/RTL pass + §6.4 design-contract pass (§17.19, C-37) — capability rows C-36…C-40 | ~6h |

**Bottlenecks (ranked):** (1) booking-concurrency correctness, (2) payment idempotency edge cases, (3) admin coverage breadth (§11), (4) RTL responsive polish, (5) image upload pipeline.
**Fastest safe alternative if the window collapses:** cut from the bottom of §16's *deferrable* list first (advanced search niceties, report exports, video uploads) — **never** authz, booking integrity, ledger, or audit (D-e, p.1061). Target = "one real rental completes and reconciles" (p.1347), not screen count.

---

## 9. Risk register

| ID | Risk | Evidence | Mitigation |
|---|---|---|---|
| R-1 | Double booking: overlap not expressible as a UNIQUE index; app transactions alone never claimed race-safe | E13 (PG range/exclusion docs), §4.1 | Four-layer design (range+GiST, exclusion constraint on live-occupancy rows, in-txn status-aware re-check, exact-duplicate unique backstop **owned by `booking_occupancies` — occupying records only, §4.1 layer 4**); **PG integration tests with independent parallel connections as the M1 exit gate** (§11 T2) |
| R-2 | **PHP + Composer + PostgreSQL absent on this machine** (E7/E9); bootstrap may fail (no winget Composer; PG must be provisioned) | E7, E9 | M0 environment gate first (§8): verify PHP 8.5+extensions, Composer, Node vs official starter kit, PG provision, FS/memory — record actual outputs; **on failure: report → explain alternatives → pause → ask owner. No silent fallback to SQLite/Django/Next.js/MySQL/other framework** |
| R-3 | ~0.7 GB free RAM → Vite build/dev-server OOM (TS + React build is the memory-heavy step) | E7 | M0 measures headroom before scaffolding; dev without SSR unless proven necessary; no heavy watchers; vendored local assets; build in low-memory mode; monitor before adding bundler features |
| R-4 | Occupancy scoping: exclusion constraint applies to all rows of its table — cancelled/rejected bookings must stop occupying their range or they illegally block rebooking | design review vs E13 | `booking_occupancies` rows inserted/deleted **inside the same transaction** as every state transition; state-machine tests assert cancel/reject frees the range **and that rebooking the same unit + exact same period succeeds afterwards** (historical cancelled/rejected bookings keep only their `bookings` row — no occupancy row, no constraint, §4.1 layer 4); covered GiST + `(unit, start, end)` indexes for scan growth |
| R-5 | Commercial terms unapproved → accidental hard-coding of 10%/EGP 5 | brief p.599, p.607, p.477 | All rates read from platform settings; values remain *Pending* (§10) until §22 sign-off |
| R-6 | Chosen stack (C6) misread as *proven*: Laravel/PHP was **owner-selected, not installed/tested here** — comparison cells in §4 were never re-scored for it | D-i, §4 header note | Honest labeling throughout; proof = M0 gate outputs (R-2) + M1 integrity gates; matrix retained as history only (D-c) |
| R-7 | OTP/SMS, maps, delivery, identity-verification providers unresolved | brief p.358, p.868, p.683 | Simulated dev/demo OTP only, no real SMS (D-k); admin-entered delivery records (brief p.687 allows manual entry); provider rows *Pending* |
| R-8 | Arabic search quality (normalization, no external search service) | brief p.264 | Server-side normalized matching first (Eloquent query level); PostgreSQL full-text/`pg_trgm` options evaluated at M2 — no external service, chosen by evidence then |
| R-9 | Timezone/DST errors in availability windows | brief p.564 | Store UTC (Laravel app timezone config pinned to UTC; render Africa/Cairo); test Cairo-local boundaries in M1 |
| R-10 | Scope creep past approved boundary | brief p.1331, D-e | Capability map rows outside approved scope require owner sign-off before code |
| R-11 | **No PHP/Laravel skill — and no PostgreSQL/schema-design, financial-ledger-integrity, or data-lifecycle skill — installed** among this machine's skill sources (full inventory, §1.1 skills honesty); agent must rely on official docs | skills inventory (report item) | Implementation phase reads official Laravel/Inertia/PG/shadcn docs (E10–E17) as the source of truth; no pattern guessed from memory where docs exist |
| R-12 | Generic/third-party admin scaffold or package shipped as the finished customer UI (D-l bans template-looking output); Laravel ships **no** bundled Django-style admin panel, so any admin package added without approval would both break the design contract and violate the owner's no-package-without-approval rule (E11/E17) | D-l, E11/E17 | Admin = custom React/Inertia interface per SPEC §2.1/§6.4; UI quality bar recorded as design contract; acceptance sweep C-37 checks RTL/responsive/hierarchy/contrast; scaffold ≠ acceptance; **no admin package without explicit owner approval** |

---

## 10. Owner decision register (statuses honest)

| Brief ref | Decision | Status |
|---|---|---|
| §22.1 | Final fees + commission calculation | **Pending** (brief proposes 10% p.599, EGP 5 listing p.477, EGP 5 delivery p.607 — proposals only) |
| §22.2 | Commission on owner (مؤجر)? | **Pending** |
| §22.3 | Ad validity period vs listing fee | **Pending** |
| §22.4 | Cancellation/refund policy | **Pending** |
| §22.5 | Deposit collection/holding/return mechanism | **Pending** (p.652: provider hold-capability unverified) |
| §22.6 | Payment provider choice + capability check | **Pending** (MVP = approved simulator D-b; real provider later) |
| §22.7 | Owner identity-verification policy | **Pending** (mechanism/levels specified p.404–416, policy open) |
| §22.8 | Delivery mechanism for phase 1 | **Pending** (manual admin entry allowed p.687) |
| §22.9 | Categories actually launched | **Pending** (all six modeled as data p.168–183) |
| §22.10 | Geographic launch scope | **Pending** (Fayoum pilot assumed per p.10 — confirmation requested in SPEC) |
| §22.11 | Platforms in first release | **Approved** — responsive web + admin dashboard (owner stack directive D-i fixes website + admin for MVP); native Android/iOS deferred |
| §22.12 | Budget & schedule | **Pending** (48h objective = D-e, not a contractual schedule) |
| §22.13 | Disputes/compensation policy | **Pending** (process shape p.732–736; outcomes policy open) |
| §22.14 | App-store publishing requirements | **Pending** (moot while native apps stay deferred — the deferral is now settled for MVP by D-i/§22.11 Approved) |
| §22.15 | Legal/contractual requirements review | **Pending** — owner/legal, never agent-assumed |
| — | Competition deployment target: public URL vs local demo | **Approved** (D-j): public demo URL **and** local fallback both approved. **Hosting provider + hosting/DB cost = Pending** (provider selection not assumed) |
| — | Architecture: simulated payments, open evaluation, source of truth, doc language | **Approved** (D-b, D-c, D-a, D-f) |
| — | **Stack: Laravel + React + TypeScript + Inertia + Tailwind + shadcn/ui + PostgreSQL**; simulated OTP; simulated payment provider; UI quality bar; admin = custom React/Inertia interface on the Laravel backend (no admin package without owner approval) | **Approved** (D-i, D-k, D-l — supersedes the §5 Django recommendation) |

---

## 11. Test & acceptance stages (mapped to brief §17's 20 acceptance tests)

| Stage | When | §17 tests covered |
|---|---|---|
| T1 Unit | continuous (M0–S) | parts of 8, 16, 20 |
| T2 Integration — booking integrity & concurrency | **M1 exit gate** | **7** + machine transitions behind 5, 6, 12 + **release/rebooking of the same unit + exact period after cancel/reject** + **booking-creation idempotency** replay & mismatched-payload rejection, independently from payment-idempotency tests (SPEC §4.2 #4, #6; §8 rows) |
| T3 Integration — money (simulator, ledger, idempotency) | **M1 exit gate** | **9, 10**, parts of 13, 15 |
| T4 Security, authz & account protection | M1 (enforcement) → M3 (verification/privacy) | **1, 16, 17** |
| T5 Integration — marketplace flow (end-to-end) | M2 exit gate | **2, 3, 4, 5, 6, 8, 11, 12, 13** |
| T6 Operations — trust, reports, backup/restore, demo-data lifecycle | M3 exit gate | **14, 15, 18** + demo-data suite per SPEC §6.5 (a–i, C-41): complete cleanup inventory, audit_log preservation incl. Clear's own entry, non-demo settlement integrity, Add idempotency before/after clear, production-mode denial |
| T7 UX/responsive/RTL + device pass | acceptance sweep | **19** |
| T8 Exception & error states | acceptance sweep | **20** |

All 20 tests are covered (T2+T3 both sit at the M1 gate; T4 spans M1 enforcement and M3 verification/privacy).

Exit rule for the Phase-2 build gate: T2 and T3 must pass before any polish work starts (risk-first sequencing; owner rule D-e).

---

## 12. Evidence appendix

| ID | Source | Used for |
|---|---|---|
| E1 | https://www.sqlite.org/lang_transaction.html | *(historical)* Single-writer model; `BEGIN IMMEDIATE` write-lock behavior — superseded stack (§4.1) |
| E2 | https://www.sqlite.org/partialindex.html | *(historical)* Unique partial indexes; WHERE-clause restrictions — superseded stack |
| E3 | https://docs.djangoproject.com/en/stable/topics/db/transactions/ | *(historical)* `atomic()`, autocommit, savepoints, IntegrityError pattern — superseded stack |
| E4 | https://docs.djangoproject.com/en/stable/ref/models/querysets/#select-for-update | *(historical)* `select_for_update` no-op on SQLite — superseded stack |
| E5 | https://docs.djangoproject.com/en/stable/ref/models/constraints/ | *(historical)* `UniqueConstraint(condition/expressions)` — superseded stack |
| E6 | https://nextjs.org/docs/app/api-reference/file-conventions/route | Next.js route-handler contract (C1 feasibility; historical) |
| E7 | Local probes (this machine): `node -v`, `npm -v`, `python -V`, `python -m pip --version`, `git --version`, `winget --version`, RAM/disk checks, tool-absence checks | Environment constraints §1.3 (PHP/Composer/PostgreSQL absence = M0 gate, R-2) |
| E8 | PyPI metadata (`https://pypi.org/pypi/Django/json`, `.../fastapi/json`) | *(historical)* Django 6.1.2 needs ≥3.12 → 5.2 LTS on py3.11 — superseded stack |
| E9 | `winget search Microsoft.DotNet.SDK`, `winget search PHP.PHP`, `winget search composer` | C5/C6 bootstrap feasibility; Composer absence — now feeds the M0 gate (R-2) |
| E10 | https://laravel.com/docs/installation | Laravel 13.x current (2026); `php.new` → PHP 8.5; Composer + installer; default SQLite switchable to PostgreSQL via `.env` `DB_*`; Vite |
| E11 | https://laravel.com/docs/starter-kits | Official React starter kit: React 19, Inertia 3, TypeScript, Tailwind 4, shadcn/ui, Fortify auth, Wayfinder, optional SSR, 2FA, rate limiting — the owner's exact stack (D-i) |
| E12 | https://inertiajs.com/server-side-setup | `inertiajs/inertia-laravel`; v3 Blade components `<x-inertia::head />`/`<x-inertia::app />`; `inertia:middleware`; `HandleInertiaRequests` in `bootstrap/app.php` |
| E13 | https://www.postgresql.org/docs/current/rangetypes.html | PG range types + GiST exclusion constraints (`EXCLUDE USING gist … WITH &&`); `btree_gist`; §8.17.10 UNIQUE-vs-exclusion guidance (§4.1, R-1, R-4) |
| E14 | https://ui.shadcn.com/docs/installation/vite and https://ui.shadcn.com/docs/installation/laravel | shadcn/ui CLI (`init`/`add`), `--rtl` flag; dedicated Laravel installation path |
| E15 | https://laravel.com/docs/13.x/testing | `php artisan test`/Pest/PHPUnit; `tests/Feature`+`tests/Unit`; `.env.testing`; parallel testing with per-process DBs (concurrency tests §4.1, §8) |
| E16 | https://www.postgresql.org/docs/current/errcodes-appendix.html | SQLSTATE classification for the retry discipline (§4.1, SPEC §4.2 #5, C-07): class 23 → `23505 unique_violation`, `23P01 exclusion_violation` (constraint-name fields reported for class-23 errors); class 40 → `40001 serialization_failure`, `40P01 deadlock_detected`; official guidance: test the error **code**, not the localized message |
| E17 | https://laravel.com/docs/starter-kits + https://laravel.com/docs/13.x (navigation) | Starter kits ship "the routes, controllers, and views you need to **register and authenticate**" (Fortify) — **no admin CRUD panel**; the official docs navigation contains no Django-style admin feature → admin = custom React/Inertia interface, no admin package without owner approval (SPEC §2.1, §6.4; §1.1, R-12) |

**Verification method:** official documentation and local command probes only — no third-party benchmark blogs, no invented scores (D-g). Laravel/Inertia/PG/shadcn facts (E10–E15) were fetched as primary official pages during the Final Architecture Update; E16 (PG SQLSTATE errcodes) and E17 (Laravel admin-absence in official docs) were fetched during the Final Consistency Pass. Django/SQLite entries (E1–E5, E8) are retained as historical evidence for the superseded recommendation. Adversarial re-read performed per Step 6 protocol (manual, local).

---

*End of assessment. Companion files: `SPEC.md` (normative), `tasks/capability-map.md` (execution slices). Approval of this file records architecture direction only; Phase-2 coding still requires explicit owner go-ahead.*
