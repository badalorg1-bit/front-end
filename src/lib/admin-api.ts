import { getSupabase, toArabicError } from "@/lib/supabase";
import type {
  AdminRole,
  AdminUserRow,
  AdminListingRow,
  AdminRequestRow,
  AdminStats,
  AdminNotificationRow,
  AdminAuditRow,
  NotificationInput,
} from "@/lib/types";

const ADMIN_USER_SELECT = `
  id, display_name, city, avatar_url, created_at, updated_at, role, is_banned
`;

const ADMIN_LISTING_SELECT = `
  id, owner_id, title, description, listing_type, category, city, district,
  condition, status, rental_price, rental_unit, sale_price, swap_preferences,
  deposit, created_at, updated_at
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
      const term = opts.q.trim();
      q = q.or(`display_name.ilike.%${term}%,city.ilike.%${term}%`);
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
      const term = opts.q.trim();
      q = q.or(`title.ilike.%${term}%,city.ilike.%${term}%,category.ilike.%${term}%`);
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

export async function adminSetBadalPayment(opts: {
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

export async function adminUploadBadalQr(file: File): Promise<string> {
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

// ── SaaS admin ──

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
  created_at: string;
  profiles?: { display_name?: string } | null;
  pricing_plans?: { name?: string } | null;
}

export async function adminListSubscriptionOrders(): Promise<AdminSubOrderRow[]> {
  try {
    const { data, error } = await getSupabase()
      .from("subscription_orders")
      .select("id, user_id, plan_id, amount_egp, status, payment_method, created_at, profiles(display_name), pricing_plans(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as AdminSubOrderRow[];
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
