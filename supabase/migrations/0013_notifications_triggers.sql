-- BADAL 0013 - automatic notifications via triggers
-- Local only until deploy approval.
-- notifications.kind is constrained to ('system','moderation','request','broadcast')
-- so request events use 'request' and review events use 'system'.

-- ---------------------------------------------------------------------------
-- 1) helper: insert notification as definer (bypasses no RLS issue)
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text default 'system',
  p_listing_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, title, body, kind, listing_id)
  values (p_user_id, p_title, p_body, p_kind, p_listing_id);
end;
$$;

-- no direct grant: only triggers/definer RPCs call it

-- ---------------------------------------------------------------------------
-- 2) listing_requests: new request -> notify owner
-- ---------------------------------------------------------------------------
create or replace function public.on_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_title text;
  v_requester_name text;
begin
  select title into v_listing_title from public.listings where id = new.listing_id;
  select display_name into v_requester_name from public.profiles where id = new.requester_id;
  perform public.notify_user(
    new.owner_id,
    'طلب جديد على إعلانك',
    coalesce(v_requester_name, 'مستخدم') || ' أرسل ' ||
      case new.request_type
        when 'rent' then 'طلب تأجير'
        when 'purchase' then 'طلب شراء'
        else 'عرض مقايضة'
      end || ' على "' || coalesce(v_listing_title, 'إعلانك') || '".',
    'request',
    new.listing_id
  );
  return new;
end;
$$;

drop trigger if exists listing_requests_notify_created on public.listing_requests;
create trigger listing_requests_notify_created
  after insert on public.listing_requests
  for each row execute function public.on_request_created();

-- ---------------------------------------------------------------------------
-- 3) listing_requests: status change -> notify the other party
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
  end if;
  return new;
end;
$$;

drop trigger if exists listing_requests_notify_status on public.listing_requests;
create trigger listing_requests_notify_status
  after update on public.listing_requests
  for each row execute function public.on_request_status_changed();

-- ---------------------------------------------------------------------------
-- 4) reviews: new review -> notify reviewee
-- ---------------------------------------------------------------------------
create or replace function public.on_review_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_user(
    new.reviewee_id,
    'تقييم جديد لك',
    'حصلت على تقييم ' || new.rating || ' من 5.',
    'system',
    null
  );
  return new;
end;
$$;

drop trigger if exists reviews_notify on public.reviews;
create trigger reviews_notify
  after insert on public.reviews
  for each row execute function public.on_review_created();
