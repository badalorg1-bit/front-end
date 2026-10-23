import { getSupabase, toArabicError, validateImageFile } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price_egp: number;
  currency: string;
  billing_interval: string;
  listing_quota: number;
  promo_credits: number;
  has_store_page: boolean;
  has_stats: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface MerchantAccount {
  plan_id: string;
  plan_name: string;
  plan_description: string | null;
  price_egp: number;
  listing_quota: number;
  promo_credits: number;
  promo_credits_remaining: number;
  has_store_page: boolean;
  has_stats: boolean;
  status: string; // "active" | "free"
  started_at: string | null;
  expires_at: string | null;
  days_left: number | null;
  listings_used: number;
  listings_remaining: number;
  pending_orders: number;
}

export interface PromoService {
  id: string;
  name: string;
  description: string;
  price_egp: number;
  duration_days: number;
  promo_type: string;
  promo_credits_cost: number;
  is_active: boolean;
}

export interface PromoOrderResult {
  ok: boolean;
  promo_id?: string;
  status: string;
  credits_remaining?: number;
  expires_at?: string;
  message?: string;
}

export interface PlanOrderResult {
  ok: boolean;
  order_id?: string;
  subscription_id?: string;
  status: string;
  expires_at?: string;
  message?: string;
}

export interface SubscriptionOrder {
  id: string;
  user_id: string;
  plan_id: string;
  amount_egp: number;
  status: string;
  payment_method: string;
  screenshot_path: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  plan_name?: string;
}

// ── Plans ──────────────────────────────────────────────

export async function listPricingPlans(): Promise<PricingPlan[]> {
  try {
    const { data, error } = await getSupabase()
      .from("pricing_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw error;
    return (data ?? []) as PricingPlan[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getMerchantAccount(): Promise<MerchantAccount> {
  try {
    const { data, error } = await getSupabase().rpc("get_merchant_account");
    if (error) throw error;
    return data as MerchantAccount;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function purchasePlan(
  planId: string,
  method: "trial" | "wallet_qr" | "instagram" = "trial",
): Promise<PlanOrderResult> {
  try {
    const { data, error } = await getSupabase().rpc("purchase_plan", {
      p_plan_id: planId,
      p_payment_method: method,
    });
    if (error) throw error;
    return data as PlanOrderResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Subscription payment flow (QR + screenshot + admin approval) ──

export async function createSubscriptionOrder(planId: string): Promise<PlanOrderResult> {
  try {
    const { data, error } = await getSupabase().rpc("create_subscription_order", {
      p_plan_id: planId,
    });
    if (error) throw error;
    return data as PlanOrderResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function attachOrderScreenshot(orderId: string, path: string): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await getSupabase().rpc("attach_order_screenshot", {
      p_order_id: orderId,
      p_path: path,
    });
    if (error) throw error;
    return data as { ok: boolean };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listMySubscriptionOrders(): Promise<SubscriptionOrder[]> {
  try {
    const { data, error } = await getSupabase()
      .from("subscription_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SubscriptionOrder[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function uploadSubscriptionScreenshot(file: File, orderId: string): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);
  try {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `subscription-screenshots/${orderId}/${Date.now()}.${ext}`;
    const { error } = await getSupabase().storage.from("payment-qr").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    return path;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Promo ──────────────────────────────────────────────

export async function listPromoServices(): Promise<PromoService[]> {
  try {
    const { data, error } = await getSupabase()
      .from("promo_services")
      .select("*")
      .eq("is_active", true)
      .order("price_egp");
    if (error) throw error;
    return (data ?? []) as PromoService[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function purchasePromo(
  listingId: string,
  serviceId: string,
  method: "trial" | "credits" | "wallet_qr" | "instagram" = "trial",
): Promise<PromoOrderResult> {
  try {
    const { data, error } = await getSupabase().rpc("purchase_promo", {
      p_listing_id: listingId,
      p_service_id: serviceId,
      p_payment_method: method,
    });
    if (error) throw error;
    return data as PromoOrderResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getListingPromos(listingId: string): Promise<Array<{ service_id: string; promo_type: string; expires_at: string }>> {
  try {
    const { data, error } = await getSupabase().rpc("get_listing_promos", {
      p_listing_id: listingId,
    });
    if (error) throw error;
    return (data ?? []) as Array<{ service_id: string; promo_type: string; expires_at: string }>;
  } catch {
    return [];
  }
}

export async function getMerchantStore(userId: string): Promise<{
  user_id: string;
  display_name: string;
  city: string | null;
  avatar_url: string | null;
  listings: Array<Record<string, unknown>>;
}> {
  try {
    const { data, error } = await getSupabase().rpc("get_merchant_store", {
      p_user_id: userId,
    });
    if (error) throw error;
    return data as Awaited<ReturnType<typeof getMerchantStore>>;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Banner campaign (user submits) ─────────────────────

export async function submitBannerCampaign(input: {
  advertiser_name: string;
  contact_info: string;
  destination_url?: string;
  banner_slot: string;
  start_date?: string;
  end_date?: string;
}): Promise<string> {
  try {
    const { data: u } = await getSupabase().auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("not_authenticated");
    const { data, error } = await getSupabase()
      .from("banner_campaigns")
      .insert({ ...input, created_by: uid })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listMyBannerCampaigns(): Promise<Array<Record<string, unknown>>> {
  try {
    const { data: u } = await getSupabase().auth.getUser();
    const uid = u.user?.id;
    if (!uid) return [];
    const { data, error } = await getSupabase()
      .from("banner_campaigns")
      .select("*")
      .eq("created_by", uid)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}
