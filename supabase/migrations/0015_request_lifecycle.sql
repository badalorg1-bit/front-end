-- BADAL 0015 - rental lifecycle: accepted -> completed / disputed
-- Local only until deploy approval.

-- ---------------------------------------------------------------------------
-- 1) widen status check constraint
-- ---------------------------------------------------------------------------
alter table public.listing_requests drop constraint if exists listing_requests_status_check;
alter table public.listing_requests
  add constraint listing_requests_status_check
  check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed'));

-- ---------------------------------------------------------------------------
-- 2) transition rules: extend enforce_request_transition
-- ---------------------------------------------------------------------------
create or replace function public.enforce_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    if auth.uid() is distinct from old.owner_id then
      raise exception 'only the listing owner can accept or reject';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    if auth.uid() is distinct from old.requester_id then
      raise exception 'only the requester can cancel';
    end if;
    return new;
  end if;

  if old.status = 'accepted' and new.status = 'completed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can mark completed';
    end if;
    return new;
  end if;

  if old.status = 'accepted' and new.status = 'disputed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can open a dispute';
    end if;
    return new;
  end if;

  if old.status = 'disputed' and new.status = 'completed' then
    if auth.uid() not in (old.requester_id, old.owner_id) then
      raise exception 'only participants can resolve a dispute';
    end if;
    return new;
  end if;

  raise exception 'invalid status transition from % to %', old.status, new.status;
end;
$$;

-- trigger already attached in 0001; create or replace keeps the binding

-- ---------------------------------------------------------------------------
-- 3) client API helpers: complete / dispute
-- ---------------------------------------------------------------------------
-- (client-side: update status via supabase update — RLS party check + transition trigger)

-- ---------------------------------------------------------------------------
-- 4) reviews: allow after completion too (not only accepted)
-- ---------------------------------------------------------------------------
drop policy if exists "reviews_insert_participant" on public.reviews;
create policy "reviews_insert_participant"
  on public.reviews for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1
      from public.listing_requests r
      where r.id = request_id
        and r.status in ('accepted', 'completed')
        and (
          (r.requester_id = auth.uid() and reviewee_id = r.owner_id)
          or (r.owner_id = auth.uid() and reviewee_id = r.requester_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 5) notifications for new terminal states
-- ---------------------------------------------------------------------------
create or replace function public.on_request_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_title text;
begin
  if old.status = new.status then
    return new;
  end if;
  select title into v_listing_title from public.listings where id = new.listing_id;

  if new.status = 'accepted' then
    perform public.notify_user(
      new.requester_id,
      'تم قبول طلبك',
      'قام مالك "' || coalesce(v_listing_title, 'الإعلان') || '" بقبول طلبك.',
      'request',
      new.listing_id
    );
  elsif new.status = 'rejected' then
    perform public.notify_user(
      new.requester_id,
      'تم رفض طلبك',
      'تم رفض طلبك على "' || coalesce(v_listing_title, 'الإعلان') || '".',
      'request',
      new.listing_id
    );
  elsif new.status = 'cancelled' and old.status = 'pending' then
    perform public.notify_user(
      new.owner_id,
      'تم إلغاء طلب معلق',
      'ألغى صاحب الطلب طلبه على "' || coalesce(v_listing_title, 'الإعلان') || '".',
      'request',
      new.listing_id
    );
  elsif new.status = 'completed' then
    perform public.notify_user(
      case when auth.uid() = new.requester_id then new.owner_id else new.requester_id end,
      'اكتملت الصفقة',
      'تم إكمال "' || coalesce(v_listing_title, 'الإعلان') || '". يمكنك الآن التقييم.',
      'request',
      new.listing_id
    );
  elsif new.status = 'disputed' then
    perform public.notify_user(
      case when auth.uid() = new.requester_id then new.owner_id else new.requester_id end,
      'تم فتح نزاع',
      'فُتح نزاع على "' || coalesce(v_listing_title, 'الإعلان') || '". ستراجعه الإدارة.',
      'request',
      new.listing_id
    );
  end if;
  return new;
end;
$$;

-- trigger already attached; create or replace keeps the binding
