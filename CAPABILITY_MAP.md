# Capability Map — Mock Payment Gateway + OTP (ui-prototype)

**Status:** Approved by owner (2026-10-17)
**Scope:** Simulated payment + simulated OTP for the Supabase SPA, with provider
interfaces so real providers swap in later. Simulation-only (SPEC ADR-002 / ADR-007,
decisions D-b, D-k). No real SMS, no real money, no card fields.

| Module id | Responsibility | Depends on |
|---|---|---|
| `otp` | Optional phone on `profiles` + simulated OTP send/verify (RPCs, throttle, 5-min expiry) + verify UI + **simulation panel** showing the code with resend countdown | — |
| `payments` | `payment_intents` table (`idempotency_key UNIQUE`) + `PaymentProvider` interface + `SimulatedPaymentProvider` + pay-after-accept flow (`accepted → confirmed`) + «محاكاة تجريبية» labels; extends the simulation panel with an outcome selector | `otp` (reuses the simulation panel component; no data dependency) |

**Build order:** `otp` → `payments`

**Confirmed decisions (owner):**
- Payment plugs in **after owner accepts** the request; success → request `confirmed`.
- OTP covers **phone verification on account** (not payment 3DS, not login).
- Simulated code is shown in a **simulation panel on screen**, hidden by env flag.
- Clean split pushed to GitHub: `badalorg1-bit/front-end`, `badalorg1-bit/back-end`.

**Out of scope:** real SMS / real money, card data fields, full 15-state booking
machine, Laravel stack, refunds/disputes, native apps.

**Module specs:** [SPEC-otp.md](SPEC-otp.md) · [SPEC-payments.md](SPEC-payments.md)
