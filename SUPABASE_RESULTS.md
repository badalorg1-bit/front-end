# BADAL — Supabase Integration Results

Date: 2026-10-16  
Project ref: `havpresypsvxevwwkjis`  
Local app: http://127.0.0.1:5199

## Goal

Wire the React MVP to the real Supabase project (Postgres + Auth + Storage), prove a two-user publish → request → accept loop end-to-end, verify RLS, and run a quality gate. Free plan only; no payment flows.

## What is connected

| Piece | Status |
|---|---|
| Frontend env | `.env.local` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (publishable key only; gitignored) |
| Auth | Login/signup against Supabase Auth (email confirm required by project) |
| Postgres | `profiles`, `listings`, `listing_requests`, `listing_images` via Supabase JS client |
| Storage | Bucket `listing-images`; paths `{auth.uid()}/{listing_id}/…` |
| RLS | Enabled on all public tables (listings, requests, images, profiles, notifications, admin_audit_log) |
| Migrations | `0001_init_schema.sql`, `0002_storage.sql`, `0003_admin_system.sql` applied via pooler |

## Two-user E2E (browser)

1. **User A** (`ahmed.owner.badal@gmail.com`) signed in, published a rent listing:
   - Title: كاميرا Sony A7 IV للايجار
   - Type: rent · 350 ج.م/يوم · تأمين 2000 · القاهرة / مصر الجديدة
   - Image uploaded to Storage under A’s uid
2. Home + search show the listing with photo; owner tab shows it as منشور.
3. **User B** (`sara.buyer.badal@gmail.com`) opened the listing, submitted a rent request (20–23 Oct + message). Status: في انتظار الرد.
4. User A accepted from طلبات واردة → UI: مقبول.
5. User B’s طلباتي → outgoing shows مقبول. DB row `status = accepted`.

IDs (test data):
- Listing `056032ec-4e2c-4d4c-96fa-7663ba65e495`
- Request `bbbd7149-1f3a-4956-bcfa-9e571392c9ea`

## Bug fixed during E2E

`src/lib/format.ts` assumed `YYYY-MM-DD`. Supabase returns full timestamps (`…T…Z`) → `RangeError: Invalid time value` on owner listings tab.  
Fix: `toDate()` accepts date-only or full ISO; invalid dates render `—`. Also hardened `addDaysISO` / `diffDays`.

## RLS / security checks (scripted, 8/8 pass)

| Check | Result |
|---|---|
| Anon cannot read others’ `listing_requests` | Pass (0 rows) |
| Requester can read own request | Pass |
| Cross-user listing update | Pass (0 rows) |
| Requester cannot accept others’ requests | Pass |
| Cross-user `listing_images` delete | Pass (0 rows) |
| Cross-user Storage upload into other uid path | Pass (RLS reject) |
| Cross-user `profiles` update | Pass (0 rows) |
| No secrets in `dist` bundle | Pass |

Notes:
- Publishable key appears in the frontend by design.
- `sb_secret_` string in the minified Supabase client is a prefix check, not a credential.
- Helper scripts take secrets from env (`SUPABASE_DB_PASSWORD`, `SUPABASE_SECRET_KEY`, `BADAL_PASSWORD_*`); no plaintext passwords remain in repo scripts.

## Admin dashboard (migration 0003 + `/admin`)

| Piece | Status |
|---|---|
| Schema | `notifications`, `admin_audit_log`; `profiles.role` (`user`/`moderator`/`admin`/`super_admin`), `profiles.is_banned`; listing status gains `blocked` |
| RPCs | `admin_broadcast_notification`, `admin_notify_user`, `admin_set_listing_status`, `admin_set_user_ban`, `admin_set_user_role` (SECURITY DEFINER) |
| Bootstrap | Super admin `mohamed_rashad.king@gmail.com` (role `super_admin`); promote signed-up users from المستخدمون tab |
| UI | KPIs + SVG growth charts · tabbed moderation (overview / users / listings / requests / notifications / team / audit) · broadcast + per-user notify · block listing notifies owner |

Permission tiers (browser-verified):

| Role | Sees |
|---|---|
| `super_admin` | Full dashboard incl. فريق الإدارة + سجل الإجراءات + role changes |
| `moderator` | Overview, listings, requests, notifications — no team/audit, no role edits |
| `user` | Access denied («لا تملك صلاحية الوصول»); no admin nav link |

E2E verified:
- Broadcast to all users → rows in `notifications` for A, B, super admin.
- Block listing → flash «تم حظر الإعلان وإشعار مالكه» + `moderation` notification to owner + audit row.
- Non-admin `/admin` → denied with role label.

RLS fix after first audit: dropped over-broad `listings_update_admin` (moderators could edit any listing field via PostgREST). Status changes now only via `admin_set_listing_status` RPC. Re-ran scripted checks: **8/8**.

Bugs fixed:
- `adminListRequests` PostgREST 400: ambiguous `listing:title` (two FKs to `listings`) → `listing:listings!listing_requests_listing_id_fkey(title)`.

## Quality gate

| Gate | Result |
|---|---|
| `npm run build` (`tsc -b && vite build`) | Pass; chunk size warning only (~1051 kB JS) |
| Browser smoke (home / search / listing / requests / admin) | Pass |
| Console errors after admin FK fix | 0 on successful load |
| `.env.local` / `.env.server` gitignored | Yes |

## Out of scope / not done

- Payment / upgrade (intentionally)
- Email confirmation UX for production (project still has “Confirm email” on; `.local` addresses rejected)
- E2E for sale + swap request types (rent path proved the full pipeline)
- Code-split / bundle size optimization (warning only)
- Unban / unblock UI action (status restore done via SQL this session; wire a reverse action if product needs it)
- Admin role selector UI (promote via direct role update from المستخدمون; RPC exists)

## How to re-run helpers

```powershell
# pooler password from env only
$env:SUPABASE_DB_PASSWORD = '…'
node .\bayna-apply-migrations.mjs
node .\bayna-check-db.mjs
node .\bayna-check-requests.mjs

# RLS + dist scan (loads .env.server / .env.local automatically when present)
node .\bayna-rls-check.mjs

# Super-admin bootstrap (needs SUPABASE_SECRET_KEY in .env.server)
node .\bayna-apply-admin.mjs
```

## Verdict

Supabase is genuinely wired: migrations 0001–0003 live, auth works, listing + image + request + accept complete a real two-account loop, admin dashboard moderates users/listings/notifications with tiered roles, RLS holds under negative tests (8/8), production build has no leaked secrets. Ready for sale/swap flows and deployment hardening next.
