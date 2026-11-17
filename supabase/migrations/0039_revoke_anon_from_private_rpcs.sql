-- BADAL 0039 — close the anon surface on private RPCs (defense in depth)
-- WHY: 27 SECURITY DEFINER RPCs were executable by role anon (PostgREST
-- 'public' API). Every one of them re-checks identity / role internally
-- (0017 / 0029 / 0034 gates), so none was an active hole — but a single
-- missed gate would have been. Revoking anon drops the whole class:
--   * 12 admin_* RPCs        (moderator+/admin gate inside)
--   * 4 messaging RPCs       (own-conversation gate inside)
--   * money + profile RPCs   (wallet top-ups, plans, promos, quota)
-- Public data RPCs stay public on purpose: get_listing_promos,
-- get_reviews_for_user, get_user_public_profile, get_merchant_store,
-- check_listing_availability, get_badal_payment_settings.
-- Trigger helpers (handle_new_user, set_updated_at, enforce_*, on_*,
-- lock_*) keep PUBLIC execute: the firing role needs them.
-- service_role keeps every grant (edge functions / server tooling).

revoke execute on function public.admin_broadcast_notification(p_title text, p_body text, p_kind text) from public, anon;
grant execute on function public.admin_broadcast_notification(p_title text, p_body text, p_kind text) to authenticated;
revoke execute on function public.admin_list_wallet_topups(p_status text) from public, anon;
grant execute on function public.admin_list_wallet_topups(p_status text) to authenticated;
revoke execute on function public.admin_notify_user(p_user_id uuid, p_title text, p_body text, p_kind text) from public, anon;
grant execute on function public.admin_notify_user(p_user_id uuid, p_title text, p_body text, p_kind text) to authenticated;
revoke execute on function public.admin_review_banner(p_id uuid, p_status text, p_price numeric, p_notes text) from public, anon;
grant execute on function public.admin_review_banner(p_id uuid, p_status text, p_price numeric, p_notes text) to authenticated;
revoke execute on function public.admin_review_subscription_order(p_order_id uuid, p_status text, p_notes text) from public, anon;
grant execute on function public.admin_review_subscription_order(p_order_id uuid, p_status text, p_notes text) to authenticated;
revoke execute on function public.admin_review_wallet_topup(p_topup_id uuid, p_status text, p_notes text) from public, anon;
grant execute on function public.admin_review_wallet_topup(p_topup_id uuid, p_status text, p_notes text) to authenticated;
revoke execute on function public.admin_set_listing_status(p_listing_id uuid, p_status text) from public, anon;
grant execute on function public.admin_set_listing_status(p_listing_id uuid, p_status text) to authenticated;
revoke execute on function public.admin_set_user_ban(p_user_id uuid, p_banned boolean) from public, anon;
grant execute on function public.admin_set_user_ban(p_user_id uuid, p_banned boolean) to authenticated;
revoke execute on function public.admin_set_user_role(p_user_id uuid, p_role text) from public, anon;
grant execute on function public.admin_set_user_role(p_user_id uuid, p_role text) to authenticated;
revoke execute on function public.admin_update_plan(p_id text, p_name text, p_description text, p_price_egp numeric, p_listing_quota integer, p_promo_credits integer, p_is_active boolean) from public, anon;
grant execute on function public.admin_update_plan(p_id text, p_name text, p_description text, p_price_egp numeric, p_listing_quota integer, p_promo_credits integer, p_is_active boolean) to authenticated;
revoke execute on function public.admin_update_promo_service(p_id text, p_name text, p_description text, p_price_egp numeric, p_duration_days integer, p_promo_credits_cost integer, p_is_active boolean) from public, anon;
grant execute on function public.admin_update_promo_service(p_id text, p_name text, p_description text, p_price_egp numeric, p_duration_days integer, p_promo_credits_cost integer, p_is_active boolean) to authenticated;
revoke execute on function public.admin_update_saas_settings(p_free_per_cycle integer, p_free_days integer, p_per_listing_price numeric, p_per_listing_days integer) from public, anon;
grant execute on function public.admin_update_saas_settings(p_free_per_cycle integer, p_free_days integer, p_per_listing_price numeric, p_per_listing_days integer) to authenticated;
revoke execute on function public.send_message(p_conversation_id uuid, p_body text) from public, anon;
grant execute on function public.send_message(p_conversation_id uuid, p_body text) to authenticated;
revoke execute on function public.get_conversation_messages(p_conversation_id uuid) from public, anon;
grant execute on function public.get_conversation_messages(p_conversation_id uuid) to authenticated;
revoke execute on function public.get_or_create_conversation(p_other uuid, p_listing_id uuid) from public, anon;
grant execute on function public.get_or_create_conversation(p_other uuid, p_listing_id uuid) to authenticated;
revoke execute on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;
revoke execute on function public.get_my_payment_profile() from public, anon;
grant execute on function public.get_my_payment_profile() to authenticated;
revoke execute on function public.get_direct_payment_history(p_request_id uuid) from public, anon;
grant execute on function public.get_direct_payment_history(p_request_id uuid) to authenticated;
revoke execute on function public.create_wallet_topup(p_amount_egp numeric, p_payment_method text) from public, anon;
grant execute on function public.create_wallet_topup(p_amount_egp numeric, p_payment_method text) to authenticated;
revoke execute on function public.attach_wallet_topup_screenshot(p_topup_id uuid, p_path text) from public, anon;
grant execute on function public.attach_wallet_topup_screenshot(p_topup_id uuid, p_path text) to authenticated;
revoke execute on function public.list_my_wallet_topups() from public, anon;
grant execute on function public.list_my_wallet_topups() to authenticated;
revoke execute on function public.purchase_plan(p_plan_id text, p_payment_method text) from public, anon;
grant execute on function public.purchase_plan(p_plan_id text, p_payment_method text) to authenticated;
revoke execute on function public.purchase_promo(p_listing_id uuid, p_service_id text, p_payment_method text) from public, anon;
grant execute on function public.purchase_promo(p_listing_id uuid, p_service_id text, p_payment_method text) to authenticated;
revoke execute on function public.create_subscription_order(p_plan_id text) from public, anon;
grant execute on function public.create_subscription_order(p_plan_id text) to authenticated;
revoke execute on function public.attach_order_screenshot(p_order_id uuid, p_path text) from public, anon;
grant execute on function public.attach_order_screenshot(p_order_id uuid, p_path text) to authenticated;
revoke execute on function public.consume_listing_quota(p_listing_id uuid) from public, anon;
grant execute on function public.consume_listing_quota(p_listing_id uuid) to authenticated;
revoke execute on function public.get_merchant_account() from public, anon;
grant execute on function public.get_merchant_account() to authenticated;
