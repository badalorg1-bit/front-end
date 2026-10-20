-- BADAL — AI chatbot warnings: prompt-injection / manipulation attempts
-- Written only by the `chat` Edge Function (service role).
-- Read by moderators+ in the admin dashboard. No anon/authenticated insert.

create table if not exists public.ai_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  message text not null check (char_length(message) between 1 and 500),
  ip text not null default '' check (char_length(ip) <= 64),
  detected_type text not null default 'injection'
    check (detected_type in ('injection', 'manipulation')),
  conversation jsonb not null default '[]'::jsonb,
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_warnings_created_idx
  on public.ai_warnings (created_at desc);

create index if not exists ai_warnings_unreviewed_idx
  on public.ai_warnings (created_at desc)
  where reviewed = false;

alter table public.ai_warnings enable row level security;

-- No policies for anon/authenticated: only the service role (Edge Function) inserts;
-- moderators+ read via has_min_role. Service role bypasses RLS.

drop policy if exists "ai_warnings_select_admin" on public.ai_warnings;
create policy "ai_warnings_select_admin"
  on public.ai_warnings for select
  using (has_min_role('moderator'));

drop policy if exists "ai_warnings_update_admin" on public.ai_warnings;
create policy "ai_warnings_update_admin"
  on public.ai_warnings for update
  using (has_min_role('moderator'))
  with check (has_min_role('moderator'));
