import { getSupabase, toArabicError, sanitizeFilterValue, validateImageFile } from "@/lib/supabase";
import type {
  AdminRole,
  AdminUserRow,
  AdminListingRow,
  AdminRequestRow,
  AdminStats,
  AdminNotificationRow,
  AdminAuditRow,
  AdminAiWarningRow,
  AdminComplaintRow,
  ComplaintStatus,
  DeliveryListResult,
  DisputeListResult,
  DisputeOutcome,
  NotificationInput,
} from "@/lib/types";

const ADMIN_USER_SELECT = `
  id, display_name, city, avatar_url, created_at, updated_at, role, is_banned
`;

const ADMIN_LISTING_SELECT = `
  id, owner_id, title, description, listing_type, category, city, district,
  condition, status, rental_price, rental_unit, swap_preferences,
  quantity, deposit, delivery_available, delivery_fee, created_at, updated_at
`;

function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function adminGetStats(): Promise<AdminStats> {
  try {
    const sb = getSupabase();
    const [users, listings, requests, profiles, listingRows] = await Promise.all([
      sb.from("profiles").select("id, role, is_banned, created_at"),
      sb.from("listings").select("id, status, created_at"),
      sb.from("listing_requests").select("id, status, created_at"),
      sb.from("profiles").select("id, created_at").order("created_at", { ascending: true }).limit(5000),
      sb.from("listings").select("id, created_at").order("created_at", { ascending: true }).limit(5000),
    ]);

    if (users.error) throw users.error;
    if (listings.error) throw listings.error;
    if (requests.error) throw requests.error;
    if (profiles.error) throw profiles.error;
    if (listingRows.error) throw listingRows.error;

    const userRows = users.data ?? [];
    const listingAll = listings.data ?? [];
    const requestRows = requests.data ?? [];

    const months = lastNMonths(8);
    const userByMonth = new Map(months.map((m) => [m, 0]));
    for (const p of profiles.data ?? []) {
      const k = monthKey(p.created_at);
      if (userByMonth.has(k)) userByMonth.set(k, (userByMonth.get(k) ?? 0) + 1);
    }
    const listingByMonth = new Map(months.map((m) => [m, 0]));
    for (const l of listingRows.data ?? []) {
      const k = monthKey(l.created_at);
      if (listingByMonth.has(k)) listingByMonth.set(k, (listingByMonth.get(k) ?? 0) + 1);
    }

    return {
      totalUsers: userRows.length,
      bannedUsers: userRows.filter((u) => u.is_banned).length,
      staffCount: userRows.filter((u) => u.role !== "user").length,
      totalListings: listingAll.length,
      publishedListings: listingAll.filter((l) => l.status === "published").length,
      blockedListings: listingAll.filter((l) => l.status === "blocked").length,
      pendingListings: listingAll.filter((l) => l.status === "draft").length,
      totalRequests: requestRows.length,
      pendingRequests: requestRows.filter((r) => r.status === "pending").length,
      acceptedRequests: requestRows.filter((r) => r.status === "accepted").length,
      rejectedRequests: requestRows.filter((r) => r.status === "rejected").length,
      usersByMonth: months.map((m) => ({ month: m, count: userByMonth.get(m) ?? 0 })),
      listingsByMonth: months.map((m) => ({ month: m, count: listingByMonth.get(m) ?? 0 })),
    };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListUsers(opts?: { q?: string; role?: AdminRole | "all" }): Promise<AdminUserRow[]> {
  try {
    let q = getSupabase().from("profiles").select(ADMIN_USER_SELECT).order("created_at", { ascending: false }).limit(200);
    if (opts?.q?.trim()) {
      const term = sanitizeFilterValue(opts.q);
      if (term) q = q.or(`display_name.ilike.%${term}%,city.ilike.%${term}%`);
    }
    if (opts?.role && opts.role !== "all") q = q.eq("role", opts.role);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AdminUserRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListListings(opts?: {
  q?: string;
  status?: string;
}): Promise<AdminListingRow[]> {
  try {
    let q = getSupabase()
      .from("listings")
      .select(`${ADMIN_LISTING_SELECT}, owner:profiles!listings_owner_id_fkey(display_name)`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (opts?.q?.trim()) {
      const term = sanitizeFilterValue(opts.q);
      if (term) q = q.or(`title.ilike.%${term}%,city.ilike.%${term}%,category.ilike.%${term}%`);
    }
    if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as AdminListingRow[]).map((r) => ({
      ...r,
      owner_name: (r.owner as { display_name?: string } | null)?.display_name ?? null,
    }));
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListRequests(opts?: { status?: string }): Promise<AdminRequestRow[]> {
  try {
    let q = getSupabase()
      .from("listing_requests")
      .select(
        `id, listing_id, requester_id, owner_id, request_type, status, message, rent_start, rent_end, created_at, updated_at,
         listing:listings!listing_requests_listing_id_fkey(title), requester:profiles!listing_requests_requester_id_fkey(display_name), owner:profiles!listing_requests_owner_id_fkey(display_name)`,
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as unknown as AdminRequestRow[]).map((r) => ({
      ...r,
      listing_title: (r.listing as { title?: string } | null)?.title ?? null,
      requester_name: (r.requester as { display_name?: string } | null)?.display_name ?? null,
      owner_name: (r.owner as { display_name?: string } | null)?.display_name ?? null,
    }));
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Complaints (SRS §10.4 · 0030 · A3) — RPC-only table ─────────────────────

export async function adminListComplaints(status?: ComplaintStatus | "all"): Promise<AdminComplaintRow[]> {
  try {
    const { data, error } = await getSupabase().rpc("admin_list_complaints", {
      p_status: status && status !== "all" ? status : null,
    });
    if (error) throw error;
    return (data ?? []) as AdminComplaintRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

/** Transition a complaint. Terminal states (resolved/rejected) REQUIRE note. */
export async function adminUpdateComplaintStatus(
  id: string,
  status: ComplaintStatus,
  note?: string,
): Promise<{ ok: boolean; status: string; reference: string }> {
  try {
    const { data, error } = await getSupabase().rpc("update_complaint_status", {
      p_id: id,
      p_status: status,
      p_note: note ?? null,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string; reference: string };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Disputes (SRS §10.4 · 0031 · A7) — RPC-only path ────────────────────────

/** The whole §10.4 review panel in one read: open disputes + history. */
export async function adminListDisputes(): Promise<DisputeListResult> {
  try {
    const { data, error } = await getSupabase().rpc("admin_list_disputes");
    if (error) throw error;
    return (data ?? { open: [], history: [] }) as DisputeListResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

/**
 * Resolve a dispute. The server requires moderator+, a disputed row and a
 * 10..2000-char reason; it records the decision and notifies BOTH parties.
 * No money moves here (§10.4) — refund/release stays a separate action.
 */
export async function adminResolveDispute(
  requestId: string,
  outcome: DisputeOutcome,
  reason: string,
): Promise<{ ok: boolean; status: string; outcome: string }> {
  try {
    const { data, error } = await getSupabase().rpc("admin_resolve_dispute", {
      p_request_id: requestId,
      p_outcome: outcome,
      p_reason: reason,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string; outcome: string };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ── Delivery (SRS §9 · 0033 · A6) — manual courier entry (§9.3) ──────────────

/** The §9.2 tracking board: live orders + eligible accepted bookings. */
export async function adminListDeliveryOrders(): Promise<DeliveryListResult> {
  try {
    const { data, error } = await getSupabase().rpc("admin_list_delivery_orders");
    if (error) throw error;
    return (data ?? { orders: [], eligible: [] }) as DeliveryListResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

/**
 * Register a courier order for an ACCEPTED booking. The server requires
 * moderator+, a provider, an address (falls back to the tenant's §9.2
 * address) and refuses a second order for the same booking; BOTH parties
 * are notified (§7.1 step 13) and the entry is audited.
 */
export async function adminCreateDeliveryOrder(input: {
  requestId: string;
  provider: string;
  courierOrderNo?: string;
  deliveryFee?: number;
  address?: string;
}): Promise<{ ok: boolean; status: string }> {
  try {
    const { data, error } = await getSupabase().rpc("admin_create_delivery_order", {
      p_request_id: input.requestId,
      p_provider: input.provider.trim(),
      p_courier_order_no: input.courierOrderNo?.trim() || null,
      p_delivery_fee: input.deliveryFee ?? null,
      p_address: input.address?.trim() || null,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

/**
 * Advance a courier order. The server enforces strict transitions;
 * delayed/failed REQUIRE a note, delivered REQUIRE who received it and
 * stamp delivered_at; terminal states are immutable. Audited + notified.
 */
export async function adminUpdateDeliveryOrder(input: {
  requestId: string;
  status: string;
  note?: string;
  deliveredTo?: string;
}): Promise<{ ok: boolean; status: string }> {
  try {
    const { data, error } = await getSupabase().rpc("admin_update_delivery_order", {
      p_request_id: input.requestId,
      p_status: input.status,
      p_status_note: input.note?.trim() || null,
      p_delivered_to: input.deliveredTo?.trim() || null,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminSetListingStatus(listingId: string, status: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_set_listing_status", {
      p_listing_id: listingId,
      p_status: status,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminSetUserRole(userId: string, role: AdminRole): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_set_user_role", {
      p_user_id: userId,
      p_role: role,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminSetUserBan(userId: string, banned: boolean): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_set_user_ban", {
      p_user_id: userId,
      p_banned: banned,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminBroadcast(input: NotificationInput): Promise<number> {
  try {
    const { data, error } = await getSupabase().rpc("admin_broadcast_notification", {
      p_title: input.title,
      p_body: input.body ?? "",
      p_kind: input.kind ?? "broadcast",
    });
    if (error) throw error;
    return Number(data ?? 0);
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminNotifyUser(userId: string, input: NotificationInput): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_notify_user", {
      p_user_id: userId,
      p_title: input.title,
      p_body: input.body ?? "",
      p_kind: input.kind ?? "system",
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListNotifications(): Promise<AdminNotificationRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("notifications")
      .select("id, user_id, title, body, kind, read_at, created_at, profile:profiles!notifications_user_id_fkey(display_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return ((data ?? []) as AdminNotificationRow[]).map((r) => ({
      ...r,
      user_name: (r.profile as { display_name?: string } | null)?.display_name ?? null,
    }));
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListAudit(): Promise<AdminAuditRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("admin_audit_log")
      .select("id, actor_id, action, target_type, target_id, meta, created_at, actor:profiles!admin_audit_log_actor_id_fkey(display_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as AdminAuditRow[]).map((r) => ({
      ...r,
      actor_name: (r.actor as { display_name?: string } | null)?.display_name ?? null,
    }));
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminListAiWarnings(): Promise<AdminAiWarningRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("ai_warnings")
      .select("id, user_id, message, ip, detected_type, conversation, reviewed, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as AdminAiWarningRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminMarkAiWarningReviewed(id: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("ai_warnings")
      .update({ reviewed: true })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listMyNotifications(userId: string): Promise<
  Array<{ id: string; title: string; body: string; kind: string; read_at: string | null; created_at: string }>
> {
  try {
    const { data, error } = await getSupabase()
      .from("notifications")
      .select("id, title, body, kind, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminSetEscrowFee(percent: number): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_set_escrow_fee", {
      p_percent: percent,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminSetBaynaPayment(opts: {
  wallet_name?: string;
  qr_path?: string;
  instagram?: string;
}): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_set_badal_payment", {
      p_wallet_name: opts.wallet_name ?? null,
      p_qr_path: opts.qr_path ?? null,
      p_instagram: opts.instagram ?? null,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminUploadBaynaQr(file: File): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);
  const path = `badal-platform/qr-${Date.now()}.jpg`;
  const { error } = await getSupabase().storage.from("payment-qr").upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw new Error(toArabicError(error));
  return path;
}

export async function adminFundWallet(userId: string, amount: number): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_fund_wallet", {
      p_user_id: userId,
      p_amount: amount,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface AdminWalletRow {
  user_id: string;
  balance: number;
  display_name?: string | null;
}

export async function adminListWallets(): Promise<AdminWalletRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("wallet_balances")
      .select("user_id, balance, profiles(display_name)")
      .order("balance", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const p = r.profiles as { display_name?: string } | null;
      return {
        user_id: r.user_id as string,
        balance: Number(r.balance ?? 0),
        display_name: p?.display_name ?? null,
      };
    });
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// â”€â”€ SaaS admin â”€â”€

export interface AdminPlanRow {
  id: string;
  name: string;
  description: string;
  price_egp: number;
  listing_quota: number;
  promo_credits: number;
  is_active: boolean;
}

export async function adminListPlans(): Promise<AdminPlanRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("pricing_plans")
      .select("id, name, description, price_egp, listing_quota, promo_credits, is_active")
      .order("sort_order");
    if (error) throw error;
    return (data ?? []) as AdminPlanRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminUpdatePlan(p: AdminPlanRow): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_update_plan", {
      p_id: p.id,
      p_name: p.name,
      p_description: p.description,
      p_price_egp: p.price_egp,
      p_listing_quota: p.listing_quota,
      p_promo_credits: p.promo_credits,
      p_is_active: p.is_active,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface AdminPromoServiceRow {
  id: string;
  name: string;
  description: string;
  price_egp: number;
  duration_days: number;
  promo_credits_cost: number;
  is_active: boolean;
}

export async function adminListPromoServices(): Promise<AdminPromoServiceRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("promo_services")
      .select("id, name, description, price_egp, duration_days, promo_credits_cost, is_active")
      .order("price_egp");
    if (error) throw error;
    return (data ?? []) as AdminPromoServiceRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminUpdatePromoService(p: AdminPromoServiceRow): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_update_promo_service", {
      p_id: p.id,
      p_name: p.name,
      p_description: p.description,
      p_price_egp: p.price_egp,
      p_duration_days: p.duration_days,
      p_promo_credits_cost: p.promo_credits_cost,
      p_is_active: p.is_active,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminUpdateSaasSettings(p: {
  free_per_cycle: number;
  free_days: number;
  per_listing_price: number;
  per_listing_days: number;
}): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_update_saas_settings", {
      p_free_per_cycle: p.free_per_cycle,
      p_free_days: p.free_days,
      p_per_listing_price: p.per_listing_price,
      p_per_listing_days: p.per_listing_days,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface AdminBannerRow {
  id: string;
  advertiser_name: string;
  contact_info: string;
  banner_slot: string;
  status: string;
  price_egp: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  created_at: string;
}

export async function adminListBannerCampaigns(): Promise<AdminBannerRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("banner_campaigns")
      .select(
        "id, advertiser_name, contact_info, banner_slot, status, price_egp, start_date, end_date, notes, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as AdminBannerRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminReviewBanner(
  id: string,
  status: string,
  price: number | null,
  notes = "",
): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_review_banner", {
      p_id: id,
      p_status: status,
      p_price: price,
      p_notes: notes,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface AdminSubOrderRow {
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
  profiles?: { display_name?: string } | null;
  pricing_plans?: { name?: string } | null;
}

export async function adminListSubscriptionOrders(): Promise<AdminSubOrderRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("subscription_orders")
      .select("id, user_id, plan_id, amount_egp, status, payment_method, screenshot_path, reviewed_by, reviewed_at, review_notes, created_at, profiles(display_name), pricing_plans(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as AdminSubOrderRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminReviewSubscriptionOrder(
  orderId: string,
  status: "paid" | "failed",
  notes: string = "",
): Promise<{ ok: boolean; status: string; message?: string }> {
  try {
    const { data, error } = await getSupabase().rpc("admin_review_subscription_order", {
      p_order_id: orderId,
      p_status: status,
      p_notes: notes,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string; message?: string };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface AdminSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  started_at: string | null;
  expires_at: string | null;
  listing_used: number;
  promo_credits_remaining: number;
  profiles?: { display_name?: string } | null;
  pricing_plans?: { name?: string } | null;
}

export async function adminListSubscriptions(): Promise<AdminSubscriptionRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("subscriptions")
      .select("id, user_id, plan_id, status, started_at, expires_at, listing_used, promo_credits_remaining, profiles(display_name), pricing_plans(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as AdminSubscriptionRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// â”€â”€ Wallet top-ups (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AdminWalletTopupRow {
  id: string;
  user_id: string;
  amount_egp: number;
  /** Points credited on approval (0029); null while pending/rejected. */
  points_granted: number | null;
  status: "pending" | "approved" | "rejected";
  payment_method: string;
  screenshot_path: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profiles?: { display_name?: string } | null;
}

export async function adminListWalletTopups(status?: "pending" | "approved" | "rejected"): Promise<AdminWalletTopupRow[]> {
  try {
    let q = getSupabase()
      .from("wallet_topups")
      .select("id, user_id, amount_egp, points_granted, status, payment_method, screenshot_path, review_notes, reviewed_by, reviewed_at, created_at, profiles(display_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AdminWalletTopupRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminReviewWalletTopup(
  topupId: string,
  status: "approved" | "rejected",
  notes: string = "",
): Promise<{ ok: boolean; status: string; balance?: number }> {
  try {
    const { data, error } = await getSupabase().rpc("admin_review_wallet_topup", {
      p_topup_id: topupId,
      p_status: status,
      p_notes: notes,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string; balance?: number };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// â”€â”€ Pending external escrow holds (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AdminPendingEscrowRow {
  id: string;
  request_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  payment_method: string;
  held_at: string;
  status: string;
  payer_name?: string | null;
  payee_name?: string | null;
  listing_title?: string | null;
}

export async function adminListPendingExternalHolds(): Promise<AdminPendingEscrowRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("escrow_holds")
      .select("id, request_id, payer_id, payee_id, amount, fee_amount, net_amount, payment_method, held_at, status")
      .eq("status", "pending_confirmation")
      .order("held_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as AdminPendingEscrowRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminConfirmExternalPayment(requestId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_confirm_external_payment", {
      p_request_id: requestId,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function adminRejectExternalPayment(requestId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("admin_reject_external_payment", {
      p_request_id: requestId,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}
