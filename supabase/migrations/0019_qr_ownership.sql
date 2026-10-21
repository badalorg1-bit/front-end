-- BADAL 0019 — payment QR path ownership + profiles privilege hygiene
-- Closes: the profiles_payment_qr_path_format CHECK only validated the path
--         SHAPE (any UUID folder passed), so any authenticated user could
--         store a payment QR pointing at ANOTHER user's folder. Now the path
--         must live under the profile row's own folder (enforced in the same
--         security-definer trigger that guards role/is_banned).
--         Also drops unused anon/authenticated table-level write grants on
--         profiles (anon never needs UPDATE; clients never DELETE/TRUNCATE).
-- Depends on: 0001-0018.

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.is_banned is distinct from old.is_banned then
    if not has_min_role('admin') then
      new.role := old.role;
      new.is_banned := old.is_banned;
    end if;
  end if;

  if old.role = 'super_admin' and new.role is distinct from old.role then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'super_admin'
        and p.id <> old.id
        and p.is_banned = false
    ) then
      raise exception 'لا يمكن تخفيض صلاحية آخر مسؤول نظام';
    end if;
  end if;

  -- payment_qr_path must live under this profile's own folder when changed.
  -- new.id (not auth.uid()) so admin/service writes targeting a user still
  -- have to point at THAT user's folder; unchanged values are never re-checked.
  if new.payment_qr_path is distinct from old.payment_qr_path
     and new.payment_qr_path is not null
     and new.payment_qr_path not like new.id::text || '/%' then
    raise exception 'payment_qr_path must be under your own folder';
  end if;

  return new;
end;
$$;
-- trigger already exists (created in 0003); CREATE OR REPLACE keeps it attached

-- belt & braces: RLS already blocks anon updates, but anon holds a table-level
-- UPDATE grant with no legitimate use; no client flow deletes or truncates
-- profiles (user deletion goes through the auth admin API as postgres).
revoke update, delete, truncate on public.profiles from anon;
revoke delete, truncate on public.profiles from authenticated;
