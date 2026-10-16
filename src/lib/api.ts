import { getSupabase, getPublicUrlForPath, toArabicError, validateImageFile, MAX_IMAGES_PER_LISTING } from "@/lib/supabase";
import type {
  ListingImageRow,
  ListingRequestRow,
  ListingRow,
  ListingType,
  ListingWithImages,
  Profile,
  RequestStatus,
  RequestType,
  RequestWithListing,
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

export async function listMySwapListings(ownerId: string): Promise<ListingWithImages[]> {
  const all = await listMyListings(ownerId);
  return all.filter((l) => l.listing_type === "swap" && l.status === "published");
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
