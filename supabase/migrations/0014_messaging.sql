-- BADAL 0014 - user-to-user messaging
-- Local only until deploy approval.

-- ---------------------------------------------------------------------------
-- 1) tables
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversations_no_self check (user_a < user_b)
);

create unique index if not exists conversations_pair_listing_uidx
  on public.conversations (user_a, user_b, coalesce(listing_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists conversations_user_a_idx on public.conversations (user_a, last_message_at desc);
create index if not exists conversations_user_b_idx on public.conversations (user_b, last_message_at desc);

alter table public.conversations enable row level security;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

-- ---------------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------------
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "messages_update_read" on public.messages;
create policy "messages_update_read"
  on public.messages for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  )
  with check (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- no direct insert/delete from clients: only via RPCs below

-- ---------------------------------------------------------------------------
-- 3) RPC: open or fetch conversation (normalized user_a < user_b)
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_conversation(
  p_other uuid,
  p_listing_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'invalid conversation partner';
  end if;
  if public.is_user_banned(v_me) then
    raise exception 'account is banned';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user not found';
  end if;

  if v_me < p_other then
    v_a := v_me;
    v_b := p_other;
  else
    v_a := p_other;
    v_b := v_me;
  end if;

  select id into v_id
  from public.conversations
  where user_a = v_a and user_b = v_b
    and listing_id is not distinct from p_listing_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (user_a, user_b, listing_id)
  values (v_a, v_b, p_listing_id)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: send message + notify recipient
-- ---------------------------------------------------------------------------
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_msg_id uuid;
  v_other uuid;
  v_title text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if public.is_user_banned(v_me) then
    raise exception 'account is banned';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty message';
  end if;

  select case when user_a = v_me then user_b else user_a end
  into v_other
  from public.conversations
  where id = p_conversation_id
    and (user_a = v_me or user_b = v_me);

  if v_other is null then
    raise exception 'conversation not found';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_me, left(trim(p_body), 2000))
  returning id into v_msg_id;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id;

  select display_name into v_title from public.profiles where id = v_me;
  perform public.notify_user(
    v_other,
    'رسالة جديدة',
    coalesce(v_title, 'مستخدم') || ' أرسل لك رسالة.',
    'system',
    null
  );

  return v_msg_id;
end;
$$;

grant execute on function public.send_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: list my conversations (denormalized for the inbox UI)
-- ---------------------------------------------------------------------------
create or replace function public.list_my_conversations()
returns table (
  id uuid,
  other_id uuid,
  other_name text,
  other_avatar text,
  listing_id uuid,
  listing_title text,
  last_message_at timestamptz,
  last_body text,
  unread_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id,
    case when c.user_a = auth.uid() then c.user_b else c.user_a end as other_id,
    p.display_name as other_name,
    p.avatar_url as other_avatar,
    c.listing_id,
    l.title as listing_title,
    c.last_message_at,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count
  from public.conversations c
  join public.profiles p
    on p.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join public.listings l on l.id = c.listing_id
  where c.user_a = auth.uid() or c.user_b = auth.uid()
  order by c.last_message_at desc
  limit 100;
$$;

grant execute on function public.list_my_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPC: get one conversation's messages (mark them read)
-- ---------------------------------------------------------------------------
create or replace function public.get_conversation_messages(p_conversation_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.conversations c
       where c.id = p_conversation_id
         and (c.user_a = auth.uid() or c.user_b = auth.uid())
     ) then
    raise exception 'conversation not found';
  end if;

  -- mark incoming as read
  update public.messages
  set read_at = now()
  where conversation_id = p_conversation_id
    and sender_id <> auth.uid()
    and read_at is null;

  return query
  select m.id, m.sender_id, m.body, m.read_at, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation_id
  order by m.created_at asc
  limit 500;
end;
$$;

grant execute on function public.get_conversation_messages(uuid) to authenticated;
