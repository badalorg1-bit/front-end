-- BADAL 0016 - fix get_conversation_messages
-- Two defects surfaced on first real use:
--   1) 42702: OUT params (id, sender_id, body, read_at, created_at) collide with
--      public.messages columns inside the mark-read UPDATE.
--   2) 0A000: function was declared STABLE but performs an UPDATE.
-- Keeps the exact OUT column names the client contract (src/lib/api.ts) expects.

create or replace function public.get_conversation_messages(p_conversation_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  body text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.conversations c
       where c.id = p_conversation_id
         and (c.user_a = auth.uid() or c.user_b = auth.uid())
     ) then
    raise exception 'conversation not found';
  end if;

  -- mark incoming as read (qualified: OUT params share these column names)
  update public.messages m
  set read_at = now()
  where m.conversation_id = p_conversation_id
    and m.sender_id <> auth.uid()
    and m.read_at is null;

  return query
  select m.id, m.sender_id, m.body, m.read_at, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation_id
  order by m.created_at asc
  limit 500;
end;
$$;

grant execute on function public.get_conversation_messages(uuid) to authenticated;
