# Spec: Module `payments` — Simulated payment gateway (pay after accept)

**Map entry:** `payments` (second; depends on `otp` for the simulation panel) · **Status:** Draft, awaiting owner approval
**Stack:** same SPA as `otp` (React 19 + TS + supabase-js v2); SQL layer = migration `0005_payments.sql`
**Normative basis:** SPEC §7 (payment simulation contract) / ADR-002 / decision D-b —
simulated gateway, **real** idempotency + audit-grade state, no card data anywhere,
every result stamped `simulated=true` and labeled «محاكاة تجريبية — ليست عملية دفع حقيقية».

---

## 1. Objective

After the owner accepts a request, the requester pays through a **simulated gateway**
behind a `PaymentProvider` interface (future real provider swaps in without UI
rewrite). A successful capture moves `listing_requests.status` from `accepted` →
`confirmed`; a failure leaves the request `accepted` and retryable. Money-touching
state is modeled properly even though the money is fake: unique idempotency key,
pending → succeeded|failed intent states, provider-style reference numbers, RLS that
lets clients **read** but never **write** intents.

**User stories / acceptance:**
- As a requester I see «ادفع الآن (محاكاة)» on an accepted request; after paying I see
  the status pill change to «مؤكد».
- As a demo tester I choose the outcome (نجاح / فشل) in the simulation panel before
  capturing.
- As a future integrator I replace `SimulatedPaymentProvider` with a real one by
  implementing the same interface — UI and SQL contract stay unchanged.

**Assumptions (surface now or correct):**
1. **Amount basis:** flat `listings.price` snapshot at intent creation (labeled
   «قيمة إرشادية للمحاكاة») — no duration math in the prototype (Open question #1).
2. Outcomes in v1: `succeeded` | `failed` only; `pending`/timeout+re-query deferred
   (Open question #2).
3. Only the **requester** can pay their own request; only requests in `accepted` are
   payable; paying twice (second intent after a success) is impossible because the
   request leaves `accepted`.
4. `confirmed` is a **terminal** status for the prototype (no cancel-after-confirm,
   no handoff/return flow in this module).
5. The request `owner` can see intents for their requests (SELECT policy) so the
   incoming-requests view can show «مؤكد» truthfully — but owners never capture.

---

## 2. Commands

Same table as `SPEC-otp.md` §2, with migrations `0004` **and** `0005` applied in order
(`node bayna-apply-migrations.mjs`). Quality gate remains `npm run build`.

---

## 3. Project structure (files touched)

```
ui-prototype/
├─ supabase/migrations/0005_payments.sql       NEW  status + intents + RPCs
├─ src/
│  ├─ lib/
│  │  ├─ payments/provider.ts                  NEW  PaymentProvider + SimulatedPaymentProvider + factory
│  │  ├─ types.ts                              EDIT + PaymentIntent; RequestStatus += "confirmed"
│  │  └─ simulation.ts                         EDIT (from otp) reuse SIMULATION_LABEL
│  ├─ components/
│  │  ├─ status.tsx                            EDIT confirmed pill («مؤكد», green)
│  │  ├─ payment-dialog.tsx                    NEW  amount + label + outcome selector + pay CTA
│  │  └─ simulation-panel.tsx                  EDIT outcome selector (نجاح / فشل)
│  └─ pages/
│     ├─ requests.tsx                          EDIT pay button+dialog on outgoing accepted request
│     ├─ owner.tsx                             EDIT show confirmed state on incoming requests
```

---

## 4. Data model & RPC contract (migration `0005_payments.sql`)

**Status machine (minimal extension of the existing 4-status CHECK):**
```sql
alter table public.listing_requests drop constraint if exists listing_requests_status_check;
alter table public.listing_requests add constraint listing_requests_status_check
  check (status in ('pending','accepted','rejected','cancelled','confirmed'));
```
**Trigger guard (`enforce_request_transition`, edited in place):** new branch
`old.status='accepted' and new.status='confirmed'` is allowed **only if a
`succeeded` payment_intents row exists for that request** — i.e. confirmation is gated
by DB evidence of a captured payment, not by who sent the UPDATE. Any other transition
from `accepted` still raises «invalid status transition…». (`failed` remains a
payment-intent state, never a request state — SPEC §7.)

**`payment_intents`** — RLS: `select` for requester/owner/admin (`has_min_role`);
**no insert/update/delete policies** (clients can only read; writes happen in RPCs):

| column | notes |
|---|---|
| `id uuid pk default gen_random_uuid()` | |
| `request_id uuid not null references listing_requests(id)` | |
| `payer_id uuid not null` | = caller of `create_payment_intent` |
| `amount_egp numeric(12,2) not null check (amount_egp > 0)` | snapshot of `listings.price` |
| `idempotency_key text not null` | **unique** — client-generated `crypto.randomUUID()` per checkout attempt |
| `fingerprint text not null` | `md5(request_id || payer_id || amount_egp)` — binds key to payload |
| `status text not null check (status in ('pending','succeeded','failed')) default 'pending'` | |
| `provider text not null default 'simulated'` | swap marker for a future real provider |
| `provider_ref text` | `SIM-<12 hex>` assigned at capture (provider-style reference) |
| `simulated boolean not null default true` | stamped on every row |
| `failure_reason text` | set on `failed` |
| `created_at / updated_at timestamptz` | |

**`simulation_settings` (from `0004`)** gains:
```sql
alter table public.simulation_settings
  add column payment_capture_enabled boolean not null default true;
```

**RPCs** — `security definer`, execute granted to `authenticated` only:

1. **`create_payment_intent(p_request_id uuid, p_idempotency_key text) returns payment_intents`**
   - Requires `auth.uid()` = the request's `requester_id` → else Arabic «غير مصرح».
   - Request must be `status='accepted'` → else «لا يمكن الدفع في هذه الحالة».
   - Computes `amount_egp` from the request's listing price (assumption 1).
   - **Idempotency:** existing row for `p_idempotency_key` → if its `fingerprint`
     matches → return it (zero new rows); else raise
     «مفتاح التكرار مستخدم ببيانات مختلفة» (`409` semantics, zero rows, no state change).
     Unique backstop: `23505` on `payment_intents_idempotency_key` → same Arabic error,
     never retried (SPEC §4.2 #5).
2. **`capture_payment_intent(p_intent_id uuid, p_outcome text) returns payment_intents`**
   - Caller must be the intent's `payer_id`; intent must be `pending`;
     `simulation_settings.payment_capture_enabled` must be on → else
     «الدفع غير مفعّل».
   - `p_outcome in ('succeeded','failed')`; sets `provider_ref`, `simulated=true`,
     terminal status (+ `failure_reason` on failure).
   - On success: `update listing_requests set status='confirmed'` where id = intent's
     request **and status='accepted'** (atomic, same transaction; trigger's evidence
     guard passes because the intent is already `succeeded`).
   - On failure: request stays `accepted`; capture of the same intent again →
     «العملية مكتملة بالفعل» (terminal intents are immutable — retry = **new** intent
     with a **new** idempotency key).

---

## 5. Front-end behavior & code style

**Provider interface (the swap point):**
```ts
// src/lib/payments/provider.ts
export type PaymentOutcome = "succeeded" | "failed";

export interface CreateIntentInput { requestId: string; idempotencyKey: string }
export interface PaymentProvider {
  readonly name: string;
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  capture(intentId: string, outcome: PaymentOutcome): Promise<PaymentIntent>;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated";
  // createIntent() → rpc("create_payment_intent", {...})
  // capture()     → rpc("capture_payment_intent", { p_intent_id, p_outcome })
}
export function getPaymentProvider(): PaymentProvider {
  return new SimulatedPaymentProvider(); // future: switch on VITE_PAYMENT_PROVIDER
}
```

**Flow:** outgoing request card with status `accepted` → «ادفع الآن (محاكاة)» →
dialog shows amount («قيمة إرشادية للمحاكاة») + persistent banner
`SIMULATION_LABEL` + outcome selector (visible only when `VITE_DEMO_MODE !== "off"`),
selector state lives in the simulation panel from `otp` → «تأكيد الدفع» →
provider.createIntent(`crypto.randomUUID()`) → provider.capture(selected) →
- success: dialog closes, pill becomes «مؤكد», intent ref shown as
  «مرجع المحاكاة: SIM-…»;
- failure: Arabic error + «إراءة المحاولة» (new idempotency key) — request stays
  «مقبول».

Incoming/owner views render the same pill; intent rows are read-only context.

---

## 6. Testing strategy

1. **Build gate:** `npm run build`.
2. **SQL smoke (local):** apply `0004`+`0005`; anon `select from payment_intents` →
   0 rows; anon RPC calls → permission errors; as an authenticated non-payer,
   `create_payment_intent` on someone else's request → Arabic «غير مصرح».
3. **Browser smoke (Playwright MCP):**
   - E2E success: owner accepts → requester pays (نجاح) → pill «مؤكد» after reload.
   - Failure path: pay (فشل) → stays «مقبول» → retry with نجاح → «مؤكد».
   - Idempotency: double-submit the pay action (double-click / back) → exactly
     **one** intent row for that key (assert via RLS `select count(*)` as the payer).
   - **Bypass attempt:** client-side
     `.update({ status: "confirmed" })` directly without an intent → rejected by the
     trigger evidence guard.
   - Owner view shows «مؤكد»; owner cannot capture (payer-only RPC check).
4. **Regression rule:** same as `otp` §6.4 — reproduce first, checklist updated.

---

## 7. Boundaries

**Always:** «محاكاة تجريبية — ليست عملية دفع حقيقية» on every payment surface;
`simulated=true` + provider ref on every intent; intents client-readable but
server-written only; Arabic errors; secrets scan before push.

**Ask first:** new npm dependencies; edits to migrations `0001–0003` (0005 may edit the
`enforce_request_transition` function **body** — flag this explicitly at execution);
changing request-status semantics beyond adding `confirmed`.

**Never:** card-number/CVV/expiry fields anywhere (contract-level impossibility);
client-side writes to `payment_intents`; capturing a terminal intent twice; enabling
capture controls by default outside demo (`payment_capture_enabled` stays a deliberate
DB setting, never an env-only client bypass); commit `.env.*`.

---

## 8. Success criteria (definition of done)

1. `npm run build` passes.
2. E2E success and failure paths pass the browser checklist (§6.3).
3. Double-submit produces exactly one intent (idempotency proven), and a reused key
   with a different request/amount raises the mismatch Arabic error with zero rows.
4. Direct client update to `confirmed` without a succeeded intent is rejected.
5. Anon reads 0 intent rows; non-payer cannot create/capture; owner cannot capture.
6. Every payment surface shows the «محاكاة» label; every intent row has
   `simulated=true` + `provider_ref` after capture.
7. Secrets scan clean before push (same as `otp`).

---

## 9. Open questions

1. **Amount basis** (assumption 1): flat `listings.price` snapshot for the mock —
   OK? Alternative: multiply by rental days (`rent_end − rent_start`) when
   `request_type='rent'`. Recommended for v1: **flat price** + visible note; duration
   math belongs with real pricing (SPEC §17.8 snapshot rules).
2. **`pending`/timeout outcome** in the simulator (SPEC §7 allows
   success/failure/timeout→re-query): add a third outcome + «تحديث الحالة» button now,
   or defer? Recommended: **defer** — keep v1 `succeeded|failed`, note it in the spec
   as a deliberate cut.
3. Unit tests (carried from `otp` open question 1): add `vitest`? Recommended **yes**
   for provider + idempotency logic if any dependency addition is acceptable.
