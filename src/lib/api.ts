import { getSupabase, getPublicUrlForPath, toArabicError, validateImageFile, MAX_IMAGES_PER_LISTING } from "@/lib/supabase";
import { diffDays } from "@/lib/format";
import type {
  BadalPaymentSettings,
  DirectPaymentState,
  EscrowHold,
  EscrowPayResult,
  ListingImageRow,
  ListingRequestRow,
  ListingRow,
  ListingType,
  ListingWithImages,
  PaymentInstructions,
  PaymentProfile,
  Profile,
  RequestStatus,
  RequestType,
  RequestWithListing,
  Review,
  UserPublicProfile,
  WalletSummary,
  WalletTransaction,
} from "@/lib/types";

const LISTING_SELECT = `
  id, owner_id, title, description, listing_type, category, city, district,
  condition, status, rental_price, rental_unit, sale_price, swap_preferences,
  deposit, created_at, updated_at
`;

function mapImages(rows: ListingImageRow[]): Record<string, string[]> {
  const byListing: Record<string, string[]> = {};
  for (const r of rows) {
    if (!byListing[r.listing_id]) byListing[r.listing_id] = [];
    byListing[r.listing_id].push(getPublicUrlForPath(r.storage_path));
  }
  for (const key of Object.keys(byListing)) {
    byListing[key] = byListing[key].filter(Boolean);
  }
  return byListing;
}

async function attachImages(
  listings: ListingRow[],
  profiles?: Map<string, string>,
): Promise<ListingWithImages[]> {
  if (listings.length === 0) return [];
  const ids = listings.map((l) => l.id);
  const { data: imageRows } = await getSupabase()
    .from("listing_images")
    .select("id, listing_id, storage_path, sort_order, is_primary")
    .in("listing_id", ids)
    .order("sort_order", { ascending: true });
  const byListing = mapImages((imageRows ?? []) as ListingImageRow[]);
  return listings.map((l) => ({
    ...l,
    images: byListing[l.id] ?? [],
    owner_name: profiles?.get(l.owner_id) ?? null,
  }));
}

export interface SearchFilters {
  q?: string;
  category?: string;
  city?: string;
  listingType?: ListingType | "all";
  minPrice?: number;
  maxPrice?: number;
}

export async function searchPublishedListings(filters: SearchFilters = {}): Promise<ListingWithImages[]> {
  try {
    let query = getSupabase()
      .from("listings")
      .select(LISTING_SELECT)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filters.q?.trim()) {
      const term = filters.q.trim();
      query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.city) query = query.eq("city", filters.city);
    if (filters.listingType && filters.listingType !== "all") {
      query = query.eq("listing_type", filters.listingType);
    }
    if (filters.minPrice != null) {
      query = query.or(
        `rental_price.gte.${filters.minPrice},sale_price.gte.${filters.minPrice}`,
      );
    }
    if (filters.maxPrice != null) {
      query = query.or(
        `rental_price.lte.${filters.maxPrice},sale_price.lte.${filters.maxPrice}`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const ownerIds = [...new Set((data ?? []).map((l) => l.owner_id))];
    let profiles = new Map<string, string>();
    if (ownerIds.length) {
      const { data: profs } = await getSupabase()
        .from("profiles")
        .select("id, display_name")
        .in("id", ownerIds);
      profiles = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
    }
    return await attachImages((data ?? []) as ListingRow[], profiles);
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getListingById(id: string): Promise<ListingWithImages | null> {
  try {
    const { data, error } = await getSupabase()
      .from("listings")
      .select(LISTING_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: prof } = await getSupabase()
      .from("profiles")
      .select("id, display_name")
      .eq("id", data.owner_id)
      .maybeSingle();
    const withImages = await attachImages([data as ListingRow]);
    return { ...withImages[0], owner_name: prof?.display_name ?? null };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getRelatedListings(
  listing: Pick<ListingRow, "id" | "category" | "city">,
): Promise<ListingWithImages[]> {
  try {
    const { data, error } = await getSupabase()
      .from("listings")
      .select(LISTING_SELECT)
      .eq("status", "published")
      .neq("id", listing.id)
      .or(`category.eq.${listing.category},city.eq.${listing.city}`)
      .limit(4);
    if (error) throw error;
    return await attachImages((data ?? []) as ListingRow[]);
  } catch {
    return [];
  }
}

export async function listMyListings(ownerId: string): Promise<ListingWithImages[]> {
  try {
    const { data, error } = await getSupabase()
      .from("listings")
      .select(LISTING_SELECT)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return await attachImages((data ?? []) as ListingRow[]);
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface CreateListingInput {
  owner_id: string;
  title: string;
  description: string;
  listing_type: ListingType;
  category: string;
  city: string;
  district?: string;
  condition: "جديد" | "ممتاز" | "جيد";
  rental_price?: number | null;
  rental_unit?: string | null;
  sale_price?: number | null;
  swap_preferences?: string | null;
  deposit: number;
  files: File[];
}

export async function createListingWithImages(input: CreateListingInput): Promise<string> {
  try {
    if (input.files.length > MAX_IMAGES_PER_LISTING) {
      throw new Error(`الحد الأقصى ${MAX_IMAGES_PER_LISTING} صور للإعلان.`);
    }
    for (const f of input.files) {
      const v = validateImageFile(f);
      if (v) throw new Error(v);
    }

    const { data: listing, error: insErr } = await getSupabase()
      .from("listings")
      .insert({
        owner_id: input.owner_id,
        title: input.title.trim(),
        description: input.description.trim(),
        listing_type: input.listing_type,
        category: input.category,
        city: input.city.trim(),
        district: input.district?.trim() || null,
        condition: input.condition,
        status: "published",
        rental_price: input.listing_type === "rent" ? input.rental_price : null,
        rental_unit: input.listing_type === "rent" ? input.rental_unit : null,
        sale_price: input.listing_type === "sale" ? input.sale_price : null,
        swap_preferences: input.listing_type === "swap" ? input.swap_preferences : null,
        deposit: input.deposit,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    const listingId = listing.id as string;

    // consume quota (atomic — raises quota_exceeded if over limit)
    const { error: quotaErr } = await getSupabase().rpc("consume_listing_quota", {
      p_listing_id: listingId,
    });
    if (quotaErr) {
      // delete the just-created listing so we don't leave an orphan
      await getSupabase().from("listings").delete().eq("id", listingId);
      throw quotaErr;
    }

    const sb = getSupabase();
    const imageRows: Omit<ListingImageRow, "id" | "created_at">[] = [];
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const path = `${input.owner_id}/${listingId}/${Date.now()}-${i}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const { error: upErr } = await sb.storage
        .from("listing-images")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      imageRows.push({
        listing_id: listingId,
        storage_path: path,
        sort_order: i,
        is_primary: i === 0,
      });
    }
    if (imageRows.length) {
      const { error: imgErr } = await sb.from("listing_images").insert(imageRows);
      if (imgErr) throw imgErr;
    }
    return listingId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("quota_exceeded")) {
      throw new Error("وصلت للحد الأقصى من الإعلانات في هذه الدورة — اشترك في باقة تجّار للحصول على حصص أكبر.");
    }
    throw new Error(toArabicError(e));
  }
}

export async function setListingStatus(
  id: string,
  status: "draft" | "published" | "archived",
): Promise<void> {
  try {
    const { error } = await getSupabase().from("listings").update({ status }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface CreateRequestInput {
  listing_id: string;
  requester_id: string;
  request_type: RequestType;
  message?: string | null;
  rent_start?: string | null;
  rent_end?: string | null;
  offered_listing_id?: string | null;
}

export async function createRequest(input: CreateRequestInput): Promise<string> {
  try {
    const { data, error } = await getSupabase()
      .from("listing_requests")
      .insert({
        listing_id: input.listing_id,
        requester_id: input.requester_id,
        owner_id: "00000000-0000-0000-0000-000000000000", // replaced by trigger
        request_type: input.request_type,
        status: "pending",
        message: input.message?.trim() || null,
        rent_start: input.rent_start || null,
        rent_end: input.rent_end || null,
        offered_listing_id: input.offered_listing_id || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function decideRequest(
  id: string,
  decision: "accepted" | "rejected",
): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("listing_requests")
      .update({ status: decision })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function cancelRequest(id: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("listing_requests")
      .update({ status: "cancelled" as RequestStatus })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function completeRequest(id: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("listing_requests")
      .update({ status: "completed" as RequestStatus })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function disputeRequest(id: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("listing_requests")
      .update({ status: "disputed" as RequestStatus })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  other_id: string;
  other_name: string | null;
  other_avatar: string | null;
  listing_id: string | null;
  listing_title: string | null;
  last_message_at: string;
  last_body: string | null;
  unread_count: number;
}

export interface MessageRow {
  id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export async function openConversation(
  otherUserId: string,
  listingId?: string | null,
): Promise<string> {
  try {
    const { data, error } = await getSupabase().rpc("get_or_create_conversation", {
      p_other: otherUserId,
      p_listing_id: listingId ?? null,
    });
    if (error) throw error;
    return data as string;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listConversations(): Promise<ConversationRow[]> {
  try {
    const { data, error } = await getSupabase().rpc("list_my_conversations");
    if (error) throw error;
    return (data ?? []) as ConversationRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getConversationMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  try {
    const { data, error } = await getSupabase().rpc("get_conversation_messages", {
      p_conversation_id: conversationId,
    });
    if (error) throw error;
    return (data ?? []) as MessageRow[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function sendMessage(
  conversationId: string,
  body: string,
): Promise<string> {
  try {
    const { data, error } = await getSupabase().rpc("send_message", {
      p_conversation_id: conversationId,
      p_body: body,
    });
    if (error) throw error;
    return data as string;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

async function hydrateRequests(rows: ListingRequestRow[]): Promise<RequestWithListing[]> {
  if (!rows.length) return [];
  const listingIds = [...new Set(rows.map((r) => r.listing_id))];
  const offerIds = [...new Set(rows.map((r) => r.offered_listing_id).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.requester_id, r.owner_id])),
  ];

  const [listingsRes, offersRes, profilesRes] = await Promise.all([
    getSupabase()
      .from("listings")
      .select(`${LISTING_SELECT}, listing_images ( storage_path, sort_order )`)
      .in("id", listingIds),
    offerIds.length
      ? getSupabase().from("listings").select("id, title").in("id", offerIds)
      : Promise.resolve({ data: [] }),
    getSupabase().from("profiles").select("id, display_name").in("id", userIds),
  ]);

  const listingsMap = new Map<string, ListingWithImages>();
  for (const l of (listingsRes.data ?? []) as (ListingRow & { listing_images: { storage_path: string; sort_order: number }[] })[]) {
    const imgs = [...(l.listing_images ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => getPublicUrlForPath(i.storage_path))
      .filter(Boolean);
    const { listing_images: _drop, ...rest } = l;
    listingsMap.set(l.id, { ...rest, images: imgs });
  }
  const offersMap = new Map(
    ((offersRes.data ?? []) as { id: string; title: string }[]).map((o) => [o.id, o.title]),
  );
  const profilesMap = new Map(
    ((profilesRes.data ?? []) as Profile[]).map((p) => [p.id, p.display_name]),
  );

  return rows.map((r) => ({
    ...r,
    listing: listingsMap.get(r.listing_id) ?? null,
    requester_name: profilesMap.get(r.requester_id) ?? null,
    owner_name: profilesMap.get(r.owner_id) ?? null,
    offered_title: r.offered_listing_id ? (offersMap.get(r.offered_listing_id) ?? null) : null,
  }));
}

export async function listIncomingRequests(ownerId: string): Promise<RequestWithListing[]> {
  try {
    const { data, error } = await getSupabase()
      .from("listing_requests")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return await hydrateRequests((data ?? []) as ListingRequestRow[]);
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listOutgoingRequests(requesterId: string): Promise<RequestWithListing[]> {
  try {
    const { data, error } = await getSupabase()
      .from("listing_requests")
      .select("*")
      .eq("requester_id", requesterId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return await hydrateRequests((data ?? []) as ListingRequestRow[]);
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

/** Single request by id (hydrated with listing + names). Returns null when missing. */
export async function getRequestById(requestId: string): Promise<RequestWithListing | null> {
  try {
    const { data, error } = await getSupabase()
      .from("listing_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const rows = await hydrateRequests([data as ListingRequestRow]);
    return rows[0] ?? null;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function listMySwapListings(ownerId: string): Promise<ListingWithImages[]> {
  const all = await listMyListings(ownerId);
  return all.filter((l) => l.listing_type === "swap" && l.status === "published");
}

// ---------------------------------------------------------------------------
// Direct payment (QR / wallet) — interim; platform never holds money
// ---------------------------------------------------------------------------

export async function getMyPaymentProfile(): Promise<PaymentProfile> {
  try {
    const { data: auth } = await getSupabase().auth.getUser();
    if (!auth.user) throw new Error("يجب تسجيل الدخول أولاً.");
    const { data, error } = await getSupabase().rpc("get_my_payment_profile");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {}) as PaymentProfile;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function savePaymentProfile(patch: PaymentProfile): Promise<void> {
  try {
    const { data: auth } = await getSupabase().auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new Error("يجب تسجيل الدخول أولًا.");
    const { error } = await getSupabase()
      .from("profiles")
      .update({
        wallet_name: patch.wallet_name?.trim() || null,
        payment_qr_path: patch.payment_qr_path || null,
        instagram_handle: patch.instagram_handle?.trim().replace(/^@+/, "") || null,
        whatsapp_phone: patch.whatsapp_phone?.trim() || null,
        payment_note: patch.payment_note?.trim() || null,
      })
      .eq("id", uid);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function uploadPaymentQr(userId: string, file: File): Promise<string> {
  const validation = validateImageFile(file);
  if (validation) throw new Error(validation);
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
  const path = `${userId}/qr-${Date.now()}.${ext}`;
  const { error } = await getSupabase().storage.from("payment-qr").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(toArabicError(error));
  return path;
}

export async function deletePaymentQr(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from("payment-qr").remove([path]);
  if (error) throw new Error(toArabicError(error));
}

export async function getPaymentInstructions(requestId: string): Promise<PaymentInstructions | null> {
  try {
    const { data, error } = await getSupabase().rpc("get_payment_instructions", {
      p_request_id: requestId,
    });
    if (error) throw error;
    const rows = (data ?? []) as PaymentInstructions[];
    return rows[0] ?? null;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function confirmDirectPayment(requestId: string): Promise<DirectPaymentState> {
  try {
    const { data, error } = await getSupabase().rpc("confirm_direct_payment", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return data as DirectPaymentState;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export interface PayableAmount {
  amount: number;
  label: string;
  deposit: number;
}

/** Client-side amount for a direct transfer: sale price, or rent price × period. */
export function requestPayableAmount(r: RequestWithListing): PayableAmount | null {
  const l = r.listing;
  if (!l) return null;
  if (r.request_type === "purchase" && l.sale_price != null) {
    return { amount: l.sale_price, label: "سعر الشراء", deposit: 0 };
  }
  if (r.request_type === "rent" && l.rental_price != null && l.rental_unit) {
    const deposit = l.deposit;
    if (l.rental_unit === "ساعة") {
      return { amount: l.rental_price, label: "السعر المعلن لكل ساعة", deposit };
    }
    if (l.rental_unit === "شهر") {
      const days = r.rent_start && r.rent_end ? diffDays(r.rent_start, r.rent_end) + 1 : 0;
      const months = Math.max(1, Math.round(days / 30));
      return {
        amount: months * l.rental_price,
        label: `${months} ${months === 1 ? "شهر" : "أشهر"} × ${l.rental_price} ج.م`,
        deposit,
      };
    }
    const days = r.rent_start && r.rent_end ? diffDays(r.rent_start, r.rent_end) + 1 : 1;
    return {
      amount: days * l.rental_price,
      label: `${days} ${days === 1 ? "يوم" : "أيام"} × ${l.rental_price} ج.م`,
      deposit,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simulated BADAL escrow wallet (demo)
// ---------------------------------------------------------------------------

export async function getWalletSummary(): Promise<WalletSummary> {
  try {
    const { data: auth } = await getSupabase().auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new Error("يجب تسجيل الدخول أولًا.");
    const [balRes, feeRes, txRes] = await Promise.all([
      getSupabase().rpc("get_wallet_balance", { p_user_id: uid }),
      getSupabase().rpc("get_escrow_fee_percent"),
      getSupabase()
        .from("wallet_transactions")
        .select("id, user_id, amount, kind, request_id, note, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (balRes.error) throw balRes.error;
    if (feeRes.error) throw feeRes.error;
    if (txRes.error) throw txRes.error;
    return {
      balance: Number(balRes.data ?? 0),
      fee_percent: Number(feeRes.data ?? 5),
      transactions: (txRes.data ?? []) as WalletTransaction[],
    };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getEscrowForRequest(requestId: string): Promise<EscrowHold | null> {
  try {
    const { data, error } = await getSupabase().rpc("get_escrow_for_request", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return ((data ?? []) as EscrowHold[])[0] ?? null;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function escrowPay(requestId: string, amount: number): Promise<EscrowPayResult> {
  try {
    const { data, error } = await getSupabase().rpc("wallet_escrow_pay", {
      p_request_id: requestId,
      p_amount: amount,
    });
    if (error) throw error;
    return data as EscrowPayResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function escrowRelease(requestId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("wallet_escrow_release", {
      p_request_id: requestId,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function escrowRefund(requestId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("wallet_escrow_refund", {
      p_request_id: requestId,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getEscrowFeePercent(): Promise<number> {
  try {
    const { data, error } = await getSupabase().rpc("get_escrow_fee_percent");
    if (error) throw error;
    return Number(data ?? 5);
  } catch {
    return 5;
  }
}

export async function getBadalPaymentSettings(): Promise<BadalPaymentSettings> {
  try {
    const { data, error } = await getSupabase().rpc("get_badal_payment_settings");
    if (error) throw error;
    const rows = data as Array<Record<string, unknown>> | null;
    const r = rows?.[0];
    return {
      wallet_name: (r?.wallet_name as string) ?? "بادال",
      qr_path: (r?.qr_path as string) ?? null,
      instagram: (r?.instagram as string) ?? "@badal.egypt",
      fee_percent: Number(r?.fee_percent ?? 5),
    };
  } catch {
    return { wallet_name: "بادال", qr_path: null, instagram: "@badal.egypt", fee_percent: 5 };
  }
}

export async function getBadalQrUrl(qrPath: string): Promise<string> {
  return getPublicUrlForPath(qrPath, "payment-qr");
}

export async function escrowPayExternal(
  requestId: string,
  amount: number,
  method: "wallet_qr" | "instagram",
): Promise<EscrowPayResult> {
  try {
    const { data, error } = await getSupabase().rpc("escrow_pay_external", {
      p_request_id: requestId,
      p_amount: amount,
      p_method: method,
    });
    if (error) throw error;
    return data as EscrowPayResult;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getUserPublicProfile(userId: string): Promise<UserPublicProfile | null> {
  try {
    const { data, error } = await getSupabase().rpc("get_user_public_profile", {
      p_user_id: userId,
    });
    if (error) throw error;
    const rows = data as Array<Record<string, unknown>> | null;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      display_name: r.display_name as string,
      city: (r.city as string) ?? null,
      avatar_url: (r.avatar_url as string) ?? null,
      created_at: r.created_at as string,
      rating_avg: Number(r.rating_avg ?? 0),
      rating_count: Number(r.rating_count ?? 0),
    };
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function getReviewsForUser(userId: string): Promise<Review[]> {
  try {
    const { data, error } = await getSupabase().rpc("get_reviews_for_user", {
      p_user_id: userId,
    });
    if (error) throw error;
    return (data ?? []) as Review[];
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function createReview(input: {
  request_id: string;
  reviewee_id: string;
  rating: number;
  comment: string;
}): Promise<void> {
  try {
    const { data: uid } = await getSupabase().auth.getUser();
    if (!uid.user) throw new Error("يجب تسجيل الدخول أولاً.");
    const { error } = await getSupabase().from("reviews").insert({
      request_id: input.request_id,
      reviewer_id: uid.user.id,
      reviewee_id: input.reviewee_id,
      rating: input.rating,
      comment: input.comment,
    });
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function deleteReview(id: string): Promise<void> {
  try {
    const { error } = await getSupabase().from("reviews").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    throw new Error(toArabicError(e));
  }
}

export async function hasReviewedRequest(requestId: string): Promise<boolean> {
  try {
    const { data: uid } = await getSupabase().auth.getUser();
    if (!uid.user) return false;
    const { data, error } = await getSupabase()
      .from("reviews")
      .select("id")
      .eq("request_id", requestId)
      .eq("reviewer_id", uid.user.id)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } catch {
    return false;
  }
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const err = validateImageFile(file);
  if (err) throw new Error(err);
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await getSupabase()
    .storage.from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { error: upd } = await getSupabase()
    .from("profiles")
    .update({ avatar_url: path })
    .eq("id", userId);
  if (upd) throw upd;
  return path;
}

export function getAvatarPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return getPublicUrlForPath(path, "avatars");
}

export const CATEGORIES = [
  "مناسبات وفعاليات",
  "إلكترونيات",
  "أدوات ومستلزمات",
  "رياضة ورحلات",
  "ملابس وإكسسوارات",
  "أثاث ومفروشات",
] as const;

export const CITIES = [
  "القاهرة",
  "الجيزة",
  "الإسكندرية",
  "الدقهلية",
  "الشرقية",
  "المنوفية",
  "القليوبية",
  "أسيوط",
  "سوهاج",
  "الأقصر",
  "أسوان",
] as const;
