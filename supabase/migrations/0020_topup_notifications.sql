-- BADAL 0020 — wallet top-up notifications + realtime
-- Depends on: 0003 (notifications + notify_user from 0013), 0018 (wallet_topups).

-- ---------------------------------------------------------------------------
-- 1) notify ALL admins when a top-up request is created
-- ---------------------------------------------------------------------------
create or replace function public.on_wallet_topup_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  a record;
begin
  select display_name into v_name from public.profiles where id = new.user_id;
  for a in
    select id from public.profiles
    where role in ('admin', 'super_admin') and is_banned = false
  loop
    perform public.notify_user(
      a.id,
      'طلب شحن محفظة جديد',
      coalesce(v_name, 'مستخدم') || ' أرسل طلب شحن بقيمة ' ||
        round(new.amount_egp)::bigint || ' ج.م. — بانتظار مراجعتك.',
      'system',
      null
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists wallet_topups_notify_inserted on public.wallet_topups;
create trigger wallet_topups_notify_inserted
  after insert on public.wallet_topups
  for each row execute function public.on_wallet_topup_inserted();

-- ---------------------------------------------------------------------------
-- 2) notify the requesting user when reviewed (approved / rejected)
-- ---------------------------------------------------------------------------
create or replace function public.on_wallet_topup_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform public.notify_user(
      new.user_id,
      'تمت الموافقة على شحن المحفظة',
      'تمت إضافة ' || round(new.amount_egp)::bigint || ' ج.م. إلى رصيدك.',
      'system',
      null
    );
  elsif new.status = 'rejected' then
    perform public.notify_user(
      new.user_id,
      'تم رفض طلب شحن المحفظة',
      coalesce(nullif(trim(new.review_notes), ''),
               'لم يتم اعتماد طلب الشحن. تواصل مع الإدارة للتفاصيل.'),
      'system',
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists wallet_topups_notify_reviewed on public.wallet_topups;
create trigger wallet_topups_notify_reviewed
  after update on public.wallet_topups
  for each row execute function public.on_wallet_topup_reviewed();

-- ---------------------------------------------------------------------------
-- 3) enable Realtime (RLS still applies: each user only receives own rows)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'wallet_topups'
  ) then
    alter publication supabase_realtime add table public.wallet_topups;
  end if;
end $$;
