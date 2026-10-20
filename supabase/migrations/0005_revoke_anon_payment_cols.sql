-- BADAL — tighten profiles read surface for anon
-- Wallet/whatsapp columns are party-only (via RPC). Anon keeps only the
-- public browse fields so guest search still shows owner names.

revoke select on public.profiles from anon;
grant select (id, display_name, city, avatar_url, created_at, updated_at)
  on public.profiles to anon;
