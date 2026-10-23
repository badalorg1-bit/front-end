-- 0023_revoke_anon_money_grants.sql
-- Defense-in-depth: anon has no business holding table-level write grants on
-- money tables even though RLS blocks the actual rows. Revoke from anon.
-- SECURITY DEFINER RPCs run as the function owner (postgres) and are unaffected.

revoke insert, update, delete on public.escrow_holds from anon;
revoke insert, update, delete on public.wallet_balances from anon;
revoke insert, update, delete on public.wallet_transactions from anon;
revoke insert, update on public.listing_requests from anon;
