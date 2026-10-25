# Spec: Module `otp` — Phone verification with simulated OTP

**Map entry:** `otp` (first in build order) · **Status:** Draft, awaiting owner approval
**Stack:** React 19 + TypeScript + Vite 7 + Tailwind 4 + shadcn/ui + `@supabase/supabase-js` v2 (existing `ui-prototype` SPA)
**Normative basis:** SPEC ADR-007 / decision D-k — OTP **simulated only** for authorized demo/dev, never real SMS.

---

## 1. Objective

A logged-in user can add an optional phone number to their account and prove ownership
with a 6-digit OTP. The code is issued by a **simulated provider** behind an interface
(`OtpProvider`) so a real SMS provider can be swapped later without touching UI code.
In demo mode the code is displayed in an on-screen **simulation panel**; in any
production-like build the panel is hidden and the code is never returned by the RPC.

**User stories / acceptance:**
- As a logged-in user I can open the account dialog, enter my phone, request a code,
  and verify it — my profile then shows «موثّق» next to the number.
- As a demo tester I see the code + resend countdown in the labeled simulation panel
  («وضع المحاكاة — عرض تجريبي»).
- As an operator I can disable code disclosure with a DB flag (`simulation_settings`),
  independent of the client env flag.

**Assumptions (surface now or correct):**
1. Phone formats accepted: Egyptian mobile `01#########` (11 digits, starts `01`) **or**
   international `+[1-9]…` (up to 15 digits). Stored as typed after trimming.
2. A phone may be set on the profile **unverified** (editable via existing
   `profiles_update_self` RLS); only `verify_phone_otp` sets `phone_verified_at`.
3. Phone is **unique** across profiles (partial unique index, non-null) — future login
   by phone must not collide; duplicate → mapped Arabic error.
4. Verification requires an authenticated session (it proves control of a number for
   *this* account; it is not a login factor in this module).
5. The simulation panel lives in the app header area (global component), reached from
   an «الحساب» dialog opened by clicking the display name in the header.

---

## 2. Commands

| Purpose | Command (cwd = `ui-prototype/`) |
|---|---|
| Dev server | `npm run dev` |
| **Quality gate (must pass)** | `npm run build`  (runs `tsc -b && vite build`) |
| Apply migrations (local only) | `node bayna-apply-migrations.mjs` (reads `.env.server`; never committed) |
| Browser smoke | Playwright MCP against the dev server (checklist in §6) |

No test framework exists in this project today; adding one = **Ask first** (§7).

---

## 3. Project structure (files touched)

```
ui-prototype/
├─ supabase/migrations/0004_otp_phone.sql      NEW  tables + RPCs + flags
├─ src/
│  ├─ lib/
│  │  ├─ otp/provider.ts                       NEW  OtpProvider + SimulatedOtpProvider + factory
│  │  ├─ simulation.ts                         NEW  shared «محاكاة» constants + VITE_DEMO_MODE gate
│  │  └─ types.ts                              EDIT Profile: + phone, phone_verified_at
│  ├─ store/auth.tsx                           EDIT select new fields; updateProfile accepts phone
│  └─ components/
│     ├─ simulation-panel.tsx                  NEW  dev panel: OTP code + countdown + demo label
│     └─ account-dialog.tsx                    NEW  phone form + code form + verified badge
```

---

## 4. Data model & RPC contract (migration `0004_otp_phone.sql`)

**`profiles` (additive):**
```sql
phone text,
phone_verified_at timestamptz,
constraint profiles_phone_format check (
  phone is null or phone ~ '^(01[0-9]{9}|\+[1-9][0-9]{7,14})$'
);
create unique index profiles_phone_uniq on public.profiles (phone) where phone is not null;
```

**`auth_otps`** — RLS **deny-all for clients** (no policies; access only via RPCs):

| column | notes |
|---|---|
| `id uuid pk default gen_random_uuid()` | |
| `requester_id uuid not null references profiles(id)` | = `auth.uid()` at request time |
| `phone text not null` | copy of the phone being verified |
| `code text not null` | 6 numeric digits |
| `attempts int not null default 0` | wrong-code counter, max 5 |
| `expires_at timestamptz not null` | `now() + interval '5 minutes'` |
| `consumed_at timestamptz` | set on success or lockout |
| `created_at timestamptz not null default now()` | drives cooldown/rate limits |

**`simulation_settings`** — single row (`id bool primary key check (id)`), RLS deny-all:

| column | default | meaning |
|---|---|---|
| `otp_code_returned boolean` | `true` | when `false`, `send_phone_otp` never returns the code (production posture) |

**RPCs** — all `security definer`, `set search_path = public`,
`revoke execute … from public, anon; grant execute … to authenticated;`

1. **`send_phone_otp(p_phone text) returns jsonb`**
   - Requires `auth.uid() not null`, else `raise` Arabic «يجب تسجيل الدخول».
   - Validates `p_phone` against the format constraint → Arabic format error.
   - **Cooldown:** reject if an unconsumed OTP for the same phone exists with
     `created_at > now() - interval '60 seconds'` → «انتظر قبل إعادة الإرسال».
   - **Rate limit:** max **5** requests per phone per hour → «تجاوزت عدد المحاولات».
   - Inserts the row (code = `lpad(floor(random()*1000000)::int::text, 6, '0')` —
     demo-grade randomness, acceptable per simulation-only decision).
   - Returns `{"ok": true, "demo": true, "code": "123456" | null}` — the `code` key is
     present **only when** `simulation_settings.otp_code_returned = true`.
2. **`verify_phone_otp(p_code text) returns jsonb`**
   - Requires `auth.uid()`; picks the latest **unconsumed** OTP row of this user.
   - None → «لا يوجد رمز بانتظار التحقق»; expired → «انتهت صلاحية الرمز» (consume it);
     `attempts >= 5` → «تم قفل الرمز» (row stays consumed).
   - Wrong code → `attempts += 1`, Arabic «رمز غير صحيح» (+ remaining tries);
     5th failure consumes the row.
   - Match → set `profiles.phone = otp.phone`, `phone_verified_at = now()`,
     consume row, return `{"ok": true, "phone": …}`.

**Error contract:** plain `raise exception '<Arabic message>'` (SQLSTATE `P0001`);
`src/lib/supabase.ts::toArabicError` gains pass-through for these Arabic messages
(already returns the server message for unmapped codes — verify, no new mapping needed
unless behavior differs).

---

## 5. Front-end behavior & code style

**Provider interface (this is the swap point for a future SMS provider):**
```ts
// src/lib/otp/provider.ts
export interface OtpSendResult { demo: boolean; code?: string }
export interface OtpProvider {
  readonly name: string;
  send(phone: string): Promise<OtpSendResult>;
  verify(phone: string, code: string): Promise<void>;
}

export class SimulatedOtpProvider implements OtpProvider {
  readonly name = "simulated";
  async send(phone: string) {
    const { data, error } = await getSupabase().rpc("send_phone_otp", { p_phone: phone });
    if (error) throw error;
    return { demo: true, code: data.code ?? undefined };
  }
  // verify() → rpc("verify_phone_otp", { p_code: code })
}

export function getOtpProvider(): OtpProvider {
  return new SimulatedOtpProvider(); // future: switch on VITE_OTP_PROVIDER
}
```

**Flow:** account dialog → phone input → «إرسال رمز التحقق» → provider.send →
simulation panel shows code (only if `demo && VITE_DEMO_MODE !== "off"`) + 60s resend
countdown → code input → «تحقق» → verified badge ✓. All copy Arabic, matching the
existing tone in `auth.tsx`/`layout.tsx`.

**Simulation labeling:** panel header carries `SIMULATION_LABEL = "وضع المحاكاة — عرض تجريبي"`
(defined once in `src/lib/simulation.ts`; the `payments` module reuses it).

---

## 6. Testing strategy

Levels, cheapest first — the project has **no unit-test runner today**, so the gate is
typecheck + scripted browser verification:

1. **Build gate:** `npm run build` must pass after every task.
2. **SQL smoke (local):** apply `0004` via `bayna-apply-migrations.mjs`; as an anon
   session run `select * from auth_otps` → 0 rows / RLS denial; call
   `send_phone_otp` without a JWT → permission error.
3. **Browser smoke (Playwright MCP, manual-driven):**
   - Happy path: login → account dialog → phone → send → panel shows 6-digit code →
     verify → ✓ «موثّق» persists after reload.
   - Wrong code → Arabic error; counter visible in message.
   - Resend inside 60s → blocked error; after countdown → allowed.
   - `VITE_DEMO_MODE=off` → panel absent, flow still completes via the code the RPC
     would only return when the DB flag is on (document actual behavior in the run log).
   - Second account requesting the same phone → unique-constraint Arabic error.
4. **Regression rule:** any bug found gets re-produced first, then the fix lands with
   the same check added to the smoke checklist.

---

## 7. Boundaries

**Always:** Arabic UI copy; simulation panel visibly labeled; RPCs `security definer`
with explicit `auth.uid()` checks + execute grants trimmed; additive-only changes to
existing tables; secrets scan before any commit/push.

**Ask first:** new npm dependencies (e.g., vitest); modifying migrations `0001–0003`;
changes to `auth.tsx` beyond additive profile fields; any real-SMS wiring.

**Never:** commit `.env.local` / `.env.server`; log or `console.log` OTP codes;
store the code in `localStorage`/cookies; return the code when `otp_code_returned`
is off; add real SMS providers.

---

## 8. Success criteria (definition of done)

1. `npm run build` passes.
2. Happy path verified in browser; profile shows verified phone after reload.
3. Wrong/expired/locked/cooldown/rate-limit each produce their Arabic error; verified
   by the smoke checklist.
4. Anon session cannot call either RPC and reads **0 rows** from `auth_otps`.
5. Unique-phone collision produces a mapped Arabic error (no raw SQL text leaks).
6. Panel hidden when `VITE_DEMO_MODE=off`; RPC omits `code` when DB flag off
   (both toggles tested).
7. No secrets in the pushed tree (grep scan on staged files before push).

---

## 9. Open questions

1. **Unit tests:** add `vitest` (+ `@testing-library/react`) for provider logic?
   Recommended for the `payments` module even if `otp` stays smoke-tested — costs one
   new dev dependency. *(Answer needed before Phase 2 if you want tests.)*
2. Phone display: show the full number in the header/account dialog, or masked
   (`010•••••12`)? Recommended: full number for the owner of the account, masked in
   any public-facing surface (none exist today).
