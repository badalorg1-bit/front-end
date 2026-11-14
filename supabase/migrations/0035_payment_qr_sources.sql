-- BADAL 0035 — payment sources: split the wallet QR from the Instagram QR
--
-- Why: platform_settings.badal_qr_path currently holds the INSTAGRAM QR
-- (badal-platform/qr-instagram.jpg decodes to https://instagram.com/badal.egypt)
-- yet the top-up / subscribe pages presented it as the scan-to-transfer QR.
-- The admin-managed payment sources are now two explicit slots:
--   badal_wallet_qr_path -> QR المحفظة (scan-to-transfer)   [NEW]
--   badal_qr_path        -> QR الإنستا (legacy column name, kept)
-- Both are added/edited by the admin from the platform admin panel.
--
-- Idempotent by design: add column if not exists + drop/create functions,
-- so a re-run changes nothing. Business data is untouched (only the schema
-- and the two RPC signatures change).

alter table public.platform_settings
  add column if not exists badal_wallet_qr_path text;

-- ---------------------------------------------------------------------------
-- get: the return table gains a column -> return type changed -> drop + create
-- (old callers keep reading wallet_name / qr_path / instagram / fee_percent,
--  which are all still returned, so the currently-deployed frontend keeps
--  working until it is replaced)
-- ---------------------------------------------------------------------------
drop function if exists public.get_badal_payment_settings();

create function public.get_badal_payment_settings()
returns table (
  wallet_name text,
  qr_path text,        -- Instagram QR (legacy name kept for compatibility)
  wallet_qr_path text, -- scan-to-transfer wallet QR
  instagram text,
  fee_percent numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select badal_wallet_name, badal_qr_path, badal_wallet_qr_path,
         badal_instagram, escrow_fee_percent
  from public.platform_settings where id = 1;
$$;

revoke execute on function public.get_badal_payment_settings() from public, anon;
grant execute on function public.get_badal_payment_settings() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- set: one more parameter -> drop the 3-arg signature, create the 4-arg one.
-- p_wallet_qr_path defaults to null, so the deployed 3-named-arg calls still
-- resolve (PostgREST passes only the args it knows; the rest use defaults).
-- The gate (has_min_role('admin')) and the coalesce keep-when-null semantics
-- are unchanged from 0008.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_set_badal_payment(text, text, text);

create or replace function public.admin_set_badal_payment(
  p_wallet_name text default null,
  p_qr_path text default null,
  p_instagram text default null,
  p_wallet_qr_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_min_role('admin') then
    raise exception 'admin only';
  end if;
  update public.platform_settings
  set badal_wallet_name    = coalesce(p_wallet_name, badal_wallet_name),
      badal_qr_path        = coalesce(p_qr_path, badal_qr_path),
      badal_instagram      = coalesce(p_instagram, badal_instagram),
      badal_wallet_qr_path = coalesce(p_wallet_qr_path, badal_wallet_qr_path),
      updated_at = now()
  where id = 1;
  insert into public.admin_audit_log (actor_id, action, target_type, meta)
  values (auth.uid(), 'set_badal_payment', 'platform_settings',
          jsonb_build_object(
            'wallet_name', p_wallet_name,
            'qr_path', p_qr_path,
            'instagram', p_instagram,
            'wallet_qr_path', p_wallet_qr_path
          ));
end;
$$;

revoke execute on function public.admin_set_badal_payment(text, text, text, text) from public, anon;
grant execute on function public.admin_set_badal_payment(text, text, text, text) to authenticated;
