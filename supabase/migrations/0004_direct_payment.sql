-- BADAL — direct payment (QR / wallet) interim feature
-- Honesty model: platform never holds money. Payer and payee each confirm
-- a direct transfer; when both confirm, paid_at is stamped. Swap requests
-- skip payment entirely.

-- ---------------------------------------------------------------------------
-- 1) profiles: payment / contact columns (payee side)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists payment_qr_path text,
  add column if not exists wallet_name text,
  add column if not exists instagram_handle text,
  add column if not exists whatsapp_phone text,
  add column if not exists payment_note text;

alter table public.profiles drop constraint if exists profiles_wallet_name_len;
alter table public.profiles
  add constraint profiles_wallet_name_len check (wallet_name is null or char_length(wallet_name) between 2 and 120);

alter table public.profiles drop constraint if exists profiles_instagram_handle_len;
alter table public.profiles
  add constraint profiles_instagram_handle_len check (instagram_handle is null or char_length(instagram_handle) between 2 and 60);

alter table public.profiles drop constraint if exists profiles_whatsapp_phone_len;
alter table public.profiles
  add constraint profiles_whatsapp_phone_len check (whatsapp_phone is null or char_length(whatsapp_phone) between 5 and 30);

alter table public.profiles drop constraint if exists profiles_payment_note_len;
alter table public.profiles
  add constraint profiles_payment_note_len check (payment_note is null or char_length(payment_note) <= 300);

alter table public.profiles drop constraint if exists profiles_payment_qr_path_len;
alter table public.profiles
  add constraint profiles_payment_qr_path_len check (payment_qr_path is null or char_length(payment_qr_path) <= 500);

-- ---------------------------------------------------------------------------
-- 2) listing_requests: dual-confirmation timestamps (status stays 'accepted')
-- ---------------------------------------------------------------------------
alter table public.listing_requests
  add column if not exists payer_confirmed_at timestamptz,
  add column if not exists payee_confirmed_at timestamptz,
  add column if not exists paid_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3) payment-qr storage bucket (public read; write only under own folder)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

drop policy if exists "payment_qr_upload" on storage.objects;
create policy "payment_qr_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_qr_update" on storage.objects;
create policy "payment_qr_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_qr_delete" on storage.objects;
create policy "payment_qr_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'payment-qr'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment_qr_public_read" on storage.objects;
create policy "payment_qr_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'payment-qr');

-- ---------------------------------------------------------------------------
-- 4) RPC: payee's payment instructions for an accepted rent/purchase request
--    Callable only by the request's requester or owner.
-- ---------------------------------------------------------------------------
create or replace function public.get_payment_instructions(p_request_id uuid)
returns table (
  wallet_name text,
  payment_qr_path text,
  instagram_handle text,
  whatsapp_phone text,
  payment_note text,
  owner_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    w.wallet_name,
    w.payment_qr_path,
    w.instagram_handle,
    w.whatsapp_phone,
    w.payment_note,
    p.display_name as owner_name
  from public.listing_requests r
  join public.profiles p on p.id = r.owner_id
  left join public.profiles w on w.id = r.owner_id
  where r.id = p_request_id
    and r.request_type in ('rent', 'purchase')
    and r.status = 'accepted'
    and auth.uid() in (r.requester_id, r.owner_id);
$$;

revoke execute on function public.get_payment_instructions(uuid) from public, anon;
grant execute on function public.get_payment_instructions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: caller confirms a direct transfer; role inferred from request.
--    Sets payer_confirmed_at / payee_confirmed_at once, and paid_at when both
--    sides have confirmed. Idempotent — re-calling returns current state.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_direct_payment(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_requests%rowtype;
  v_role text;
begin
  select * into v_request
  from public.listing_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request not found';
  end if;

  if v_request.status <> 'accepted' then
    raise exception 'payment confirmation only allowed on accepted requests';
  end if;

  if v_request.request_type not in ('rent', 'purchase') then
    raise exception 'payment not applicable for swap requests';
  end if;

  if auth.uid() = v_request.requester_id then
    v_role := 'payer';
  elsif auth.uid() = v_request.owner_id then
    v_role := 'payee';
  else
    raise exception 'not a party to this request';
  end if;

  if v_role = 'payer' and v_request.payer_confirmed_at is null then
    update public.listing_requests
    set payer_confirmed_at = now()
    where id = p_request_id;
    v_request.payer_confirmed_at := now();
  elsif v_role = 'payee' and v_request.payee_confirmed_at is null then
    update public.listing_requests
    set payee_confirmed_at = now()
    where id = p_request_id;
    v_request.payee_confirmed_at := now();
  end if;

  if v_request.payer_confirmed_at is not null
    and v_request.payee_confirmed_at is not null
    and v_request.paid_at is null then
    update public.listing_requests
    set paid_at = now()
    where id = p_request_id;
    v_request.paid_at := now();
  end if;

  return jsonb_build_object(
    'role', v_role,
    'payer_confirmed_at', v_request.payer_confirmed_at,
    'payee_confirmed_at', v_request.payee_confirmed_at,
    'paid_at', v_request.paid_at
  );
end;
$$;

revoke execute on function public.confirm_direct_payment(uuid) from public, anon;
grant execute on function public.confirm_direct_payment(uuid) to authenticated;
