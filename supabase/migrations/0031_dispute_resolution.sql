-- BADAL 0031 - dispute resolution path for the moderation team (SRS §10.4 · A7)
--
-- Why this exists:
--   The live enforce_request_transition (0027) allows only PARTICIPANTS to
--   move disputed -> completed, so the moderation team has NO legal path to
--   end a dispute, and admin.tsx has no dispute surface at all (gap A7:
--   §10.4 · §11.4 · «الإدارة عاجزة عن الحل»).
--
-- What it does:
--   1. enforce_request_transition(): disputed -> completed now also accepts
--      moderator+; NEW disputed -> cancelled (moderator+ ONLY) so a dispute
--      can be unwound as well as honored. Participant self-resolve keeps
--      working exactly as before.
--   2. listing_requests_update_moderator (0022): moderators lose direct
--      UPDATE on rows whose CURRENT status is 'disputed' — every dispute
--      decision must pass through admin_resolve_dispute so a written reason
--      is always recorded (§10.4 «يجب أن تسجل المنصة القرارات وأسبابها»).
--      SELECT is untouched; the party policy (self-resolve) is untouched.
--   3. admin_list_disputes(): one read for the admin tab — every open
--      dispute with booking details, escrow state, the delivery/return
--      handover log, the parties' last messages and linked complaints
--      (§10.4 «مراجعة الشكوى، والاطلاع على تفاصيل الحجز، والرسائل والمرفقات
--      ذات الصلة، وسجل التسليم والإرجاع») plus the last 20 recorded
--      resolutions.
--   4. admin_resolve_dispute(request, outcome, reason): moderator+ only;
--      outcome in (completed | cancelled); reason 10..2000 chars REQUIRED;
--      locks the row, moves the status through the extended trigger, writes
--      decision+reason to admin_audit_log and notifies BOTH parties.
--      NO automatic money movement: §10.4 forbids penalties built on an
--      unverified one-sided claim — refund/release stays a separate audited
--      action (wallet_escrow_refund already allows moderators, 0027).
--
-- 0031 writes NO data rows — a re-run is idempotent (create or replace /
-- drop policy if exists / create index if not exists).
--
-- Verification (scripts/bayna-apply-0031.mjs):
--   1. 0030 applied (complaints exists) — ordering gate.
--   2. Both RPCs exist, granted to authenticated, denied to anon; prosrc
--      carries has_min_role + reason_required + admin_audit_log + notify_user
--      (x2) for the resolver and 'disputed' + booking_handover_codes +
--      admin_audit_log for the lister.
--   3. enforce_request_transition contains the moderator branch on
--      disputed -> completed and the new disputed -> cancelled branch.
--   4. listing_requests_update_moderator qual excludes status = 'disputed'.
--   5. Zero data rows written (listing_requests / notifications / audit
--      unchanged by the apply itself).

-- ---------------------------------------------------------------------------
-- 1) extend enforce_request_transition (0027 is the live copy — full body
--    reproduced here with ONLY the disputed branches changed).
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
    if new.status = 'accepted' and new.request_type = 'rent'
       and not exists (select 1 from public.listings
                       where id = new.listing_id and quantity > 0) then
      raise exception 'listing_quantity_exhausted';
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

  -- 0031: participants may still self-resolve (disputed -> completed), and
  -- the moderation team may now resolve it too (the missing §10.4 path).
  if old.status = 'disputed' and new.status = 'completed' then
    if auth.uid() not in (old.requester_id, old.owner_id)
       and not public.has_min_role('moderator') then
      raise exception 'only participants can resolve a dispute';
    end if;
    return new;
  end if;

  -- 0031 NEW: unwinding a disputed booking is a MODERATION decision only —
  -- participants never get this branch (their door stays disputed->completed).
  if old.status = 'disputed' and new.status = 'cancelled' then
    if not public.has_min_role('moderator') then
      raise exception 'only moderators can cancel a disputed booking';
    end if;
    return new;
  end if;

  raise exception 'invalid status transition from % to %', old.status, new.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) close the reason-bypass: 0022 gave moderators a blanket UPDATE on
--    listing_requests, which would let a dispute be closed with NO recorded
--    reason. Disputed rows are now invisible to that policy for UPDATE —
--    the definer RPC below is the only door (it writes the reason first).
--    The party policy (self-resolve by both sides) is untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "listing_requests_update_moderator" on public.listing_requests;
create policy "listing_requests_update_moderator"
  on public.listing_requests for update
  to authenticated
  using (has_min_role('moderator') and status <> 'disputed')
  with check (has_min_role('moderator'));

-- ---------------------------------------------------------------------------
-- 3) admin_list_disputes(): the whole §10.4 review panel in one read.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_disputes()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_open jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_escrow jsonb;
  v_handover jsonb;
  v_messages jsonb;
  v_complaints jsonb;
  v_conv uuid;
  r record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;

  for r in
    select q.id, q.listing_id, q.requester_id, q.owner_id, q.request_type,
           q.message, q.rent_start, q.rent_end, q.created_at, q.updated_at,
           l.title as listing_title,
           l.city as listing_city,
           rp.display_name as requester_name,
           op.display_name as owner_name
      from public.listing_requests q
      join public.listings l on l.id = q.listing_id
      join public.profiles rp on rp.id = q.requester_id
      join public.profiles op on op.id = q.owner_id
     where q.status = 'disputed'
     order by q.updated_at asc  -- oldest dispute first (fairness queue)
  loop
    -- escrow state (read-only: no money moves here, §10.4)
    select jsonb_build_object(
             'amount', e.amount,
             'status', e.status,
             'held_at', e.held_at,
             'released_at', e.released_at,
             'refunded_at', e.refunded_at
           )
      into v_escrow
      from public.escrow_holds e
     where e.request_id = r.id;

    -- delivery/return log (0028) — codes never leave this function
    select coalesce(jsonb_agg(jsonb_build_object(
             'purpose', c.purpose,
             'valid_until', c.valid_until,
             'attempts', c.attempts,
             'used_at', c.used_at,
             'used_by_name', coalesce(up.display_name, '—'),
             'condition_note', c.condition_note,
             'photos', to_jsonb(c.photos),
             'is_expired', c.valid_until < now()
           ) order by c.purpose), '[]'::jsonb)
      into v_handover
      from public.booking_handover_codes c
      left join public.profiles up on up.id = c.used_by
     where c.request_id = r.id;

    -- the parties' conversation for this listing (fallback: their latest
    -- general thread) — last 25 messages, chronological
    v_conv := null;
    select c.id into v_conv
      from public.conversations c
     where ((c.user_a = r.requester_id and c.user_b = r.owner_id)
         or (c.user_a = r.owner_id and c.user_b = r.requester_id))
       and (c.listing_id = r.listing_id or c.listing_id is null)
     order by (c.listing_id = r.listing_id) desc, c.last_message_at desc
     limit 1;

    if v_conv is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'sender_id', m.sender_id,
               'sender_name', coalesce(p.display_name, 'مستخدم محذوف'),
               'body', m.body,
               'created_at', m.created_at
             ) order by m.created_at), '[]'::jsonb)
        into v_messages
        from (
          select * from public.messages
           where conversation_id = v_conv
           order by created_at desc
           limit 25
        ) m
        left join public.profiles p on p.id = m.sender_id;
    else
      v_messages := '[]'::jsonb;
    end if;

    -- linked complaints (0030) — the complaint side of «الشكاوى والنزاعات»
    select coalesce(jsonb_agg(jsonb_build_object(
             'reference', cm.reference,
             'complaint_type', cm.complaint_type,
             'status', cm.status,
             'attachments', coalesce(array_length(cm.attachments, 1), 0)
           ) order by cm.created_at desc), '[]'::jsonb)
      into v_complaints
      from public.complaints cm
     where cm.request_id = r.id;

    v_open := v_open || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'listing_id', r.listing_id,
      'listing_title', coalesce(r.listing_title, 'إعلان محذوف'),
      'listing_city', r.listing_city,
      'request_type', r.request_type,
      'requester_id', r.requester_id,
      'requester_name', coalesce(r.requester_name, 'مستخدم'),
      'owner_id', r.owner_id,
      'owner_name', coalesce(r.owner_name, 'مستخدم'),
      'message', r.message,
      'rent_start', r.rent_start,
      'rent_end', r.rent_end,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'escrow', v_escrow,
      'handover', v_handover,
      'messages', v_messages,
      'complaints', v_complaints
    ));
  end loop;

  -- last 20 recorded resolutions (decision + reason + who + when)
  select coalesce(jsonb_agg(jsonb_build_object(
           'request_id', x.target_id,
           'listing_title', coalesce(x.meta->>'listing_title', ''),
           'outcome', x.meta->>'outcome',
           'reason', x.meta->>'reason',
           'decided_by', coalesce(p.display_name, '—'),
           'decided_at', x.created_at
         ) order by x.created_at desc), '[]'::jsonb)
    into v_history
    from (
      select target_id, meta, actor_id, created_at
        from public.admin_audit_log
       where action = 'resolve_dispute'
       order by created_at desc
       limit 20
    ) x
    left join public.profiles p on p.id = x.actor_id;

  return jsonb_build_object('open', v_open, 'history', v_history);
end;
$$;

revoke execute on function public.admin_list_disputes() from public, anon;
grant execute on function public.admin_list_disputes() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) admin_resolve_dispute(): the missing legal resolution path (§10.4).
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_dispute(
  p_request_id uuid,
  p_outcome text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_requests%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_title text;
  v_outcome_label text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_min_role('moderator') then
    raise exception 'permission denied';
  end if;
  if p_outcome not in ('completed', 'cancelled') then
    raise exception 'invalid_dispute_outcome';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'reason_too_long';
  end if;

  select * into v_request
    from public.listing_requests
   where id = p_request_id
     for update;
  if not found then
    raise exception 'request not found';
  end if;
  if v_request.status <> 'disputed' then
    raise exception 'request is not disputed';
  end if;

  select title into v_title from public.listings where id = v_request.listing_id;

  -- Status change: the extended trigger accepts moderator+ on disputed -> *.
  update public.listing_requests
     set status = p_outcome, updated_at = now()
   where id = p_request_id;

  v_outcome_label := case when p_outcome = 'completed'
                          then 'أُكملت الصفقة'
                          else 'أُلغيت الصفقة' end;

  -- §10.4: the decision AND its reason are always recorded.
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, meta)
  values (
    auth.uid(),
    'resolve_dispute',
    'listing_requests',
    p_request_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'listing_title', coalesce(v_title, ''),
      'outcome', p_outcome,
      'reason', v_reason
    )
  );

  -- Tell BOTH parties — the 0015/0027 status trigger only notifies one side
  -- and only for disputed -> completed.
  perform public.notify_user(
    v_request.requester_id,
    'حُسم النزاع',
    'حُسم النزاع على "' || coalesce(v_title, 'الإعلان') || '": ' || v_outcome_label ||
      '. السبب: ' || v_reason,
    'moderation',
    v_request.listing_id
  );
  perform public.notify_user(
    v_request.owner_id,
    'حُسم النزاع',
    'حُسم النزاع على "' || coalesce(v_title, 'الإعلان') || '": ' || v_outcome_label ||
      '. السبب: ' || v_reason,
    'moderation',
    v_request.listing_id
  );

  return jsonb_build_object('ok', true, 'status', p_outcome, 'outcome', p_outcome);
end;
$$;

revoke execute on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;
