-- Batch 3: Retire the self-serve direct-payment path.
--
-- The BADAL/Bayna payment system is moving to an escrow-gateway-only flow.
-- This migration revokes the public `confirm_direct_payment` RPC, replaces it with
-- a hard-blocked stub (defense-in-depth for any client that still calls it),
-- and adds a read-only history surface for authorized parties so historical
-- direct-payment records remain auditable without exposing them to everyone.

BEGIN;

-- 1. Revoke the previously-granted execute privilege on the live function.
--    Authenticated users (and anon) must no longer be able to invoke it.
REVOKE EXECUTE ON FUNCTION public.confirm_direct_payment(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_direct_payment(uuid) FROM anon;

-- 2. Replace the function body with a hard guard. The signature and return
--    type are preserved so dependent objects (grants, comments, etc.) stay valid.
--    No DROP: historical rows and the column set on listing_requests are untouched.
CREATE OR REPLACE FUNCTION public.confirm_direct_payment(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'direct payment is retired; use the escrow gateway instead'
        USING ERRCODE = 'P0001';
END;
$$;

-- Ensure only the security-definer owner (and superusers) can execute the stub.
REVOKE EXECUTE ON FUNCTION public.confirm_direct_payment(uuid) FROM PUBLIC;

-- 3. Add a security-definer helper that returns direct-payment history for a
--    request, restricted to the authorized party (buyer or seller). Reads only;
--    never mutates listing_requests.
CREATE OR REPLACE FUNCTION public.get_direct_payment_history(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid;
    v_row listing_requests%ROWTYPE;
BEGIN
    v_uid := auth.uid();

    SELECT * INTO v_row
    FROM listing_requests
    WHERE id = p_request_id;

    IF v_row IS NULL THEN
        RETURN NULL;
    END IF;

    -- Only the buyer or seller of this request may inspect direct-payment history.
    -- Schema note: listing_requests stores the buyer as requester_id and the
    -- seller as owner_id (there are no payer_id/seller_id columns on it).
    IF v_uid IS DISTINCT FROM v_row.requester_id AND v_uid IS DISTINCT FROM v_row.owner_id THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'request_id', v_row.id,
        'payer_id', v_row.requester_id,
        'seller_id', v_row.owner_id,
        'payer_confirmed_at', v_row.payer_confirmed_at,
        'payee_confirmed_at', v_row.payee_confirmed_at,
        'paid_at', v_row.paid_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_direct_payment_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_direct_payment_history(uuid) TO authenticated;

-- 4. A convenience view over historical direct-payment state, joined with the
--    request participants. Read-only; RLS on listing_requests still applies.
CREATE OR REPLACE VIEW public.direct_payment_history AS
SELECT
    lr.id AS request_id,
    lr.requester_id AS payer_id,
    lr.owner_id AS seller_id,
    lr.payer_confirmed_at,
    lr.payee_confirmed_at,
    lr.paid_at,
    lr.updated_at
FROM listing_requests lr
WHERE lr.paid_at IS NOT NULL
   OR lr.payer_confirmed_at IS NOT NULL
   OR lr.payee_confirmed_at IS NOT NULL;

COMMIT;