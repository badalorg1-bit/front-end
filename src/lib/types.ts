export type ListingType = "rent" | "sale" | "swap";
export type ListingStatus = "draft" | "published" | "archived" | "blocked";
export type Condition = "جديد" | "ممتاز" | "جيد";
export type RentalUnit = "ساعة" | "يوم" | "شهر";
export type RequestType = "rent" | "purchase" | "swap";
export type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type AdminRole = "user" | "moderator" | "admin" | "super_admin";

export interface Profile {
  id: string;
  display_name: string;
  city: string | null;
  avatar_url: string | null;
  created_at: string;
  role?: AdminRole;
  is_banned?: boolean;
}

export interface ListingRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  listing_type: ListingType;
  category: string;
  city: string;
  district: string | null;
  condition: Condition;
  status: ListingStatus;
  rental_price: number | null;
  rental_unit: RentalUnit | null;
  sale_price: number | null;
  swap_preferences: string | null;
  deposit: number;
  created_at: string;
  updated_at: string;
}

export interface ListingImageRow {
  id: string;
  listing_id: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
}

export interface ListingRequestRow {
  id: string;
  listing_id: string;
  requester_id: string;
  owner_id: string;
  request_type: RequestType;
  status: RequestStatus;
  message: string | null;
  rent_start: string | null;
  rent_end: string | null;
  offered_listing_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListingWithImages extends ListingRow {
  images: string[];
  owner_name?: string | null;
}

export interface RequestWithListing extends ListingRequestRow {
  listing?: ListingWithImages | null;
  requester_name?: string | null;
  owner_name?: string | null;
  offered_title?: string | null;
}

export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  rent: "للإيجار",
  sale: "للبيع",
  swap: "مقايضة",
};

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  rent: "طلب تأجير",
  purchase: "طلب شراء",
  swap: "عرض مقايضة",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "في انتظار الرد",
  accepted: "مقبول",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
  blocked: "محظور",
};

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  user: "مستخدم",
  moderator: "مشرف",
  admin: "مدير",
  super_admin: "مسؤول النظام",
};

export const ADMIN_ROLE_RANK: Record<AdminRole, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  super_admin: 3,
};

export interface AdminUserRow {
  id: string;
  display_name: string;
  city: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  role: AdminRole;
  is_banned: boolean;
}

export interface AdminListingRow extends ListingRow {
  owner_name?: string | null;
  owner?: { display_name?: string } | null;
}

export interface AdminRequestRow extends ListingRequestRow {
  listing?: { title?: string } | null;
  requester?: { display_name?: string } | null;
  owner?: { display_name?: string } | null;
  listing_title?: string | null;
  requester_name?: string | null;
  owner_name?: string | null;
}

export interface MonthPoint {
  month: string;
  count: number;
}

export interface AdminStats {
  totalUsers: number;
  bannedUsers: number;
  staffCount: number;
  totalListings: number;
  publishedListings: number;
  blockedListings: number;
  pendingListings: number;
  totalRequests: number;
  pendingRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
  usersByMonth: MonthPoint[];
  listingsByMonth: MonthPoint[];
}

export interface AdminNotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  created_at: string;
  profile?: { display_name?: string } | null;
  user_name?: string | null;
}

export interface AdminAuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  actor?: { display_name?: string } | null;
  actor_name?: string | null;
}

export interface NotificationInput {
  title: string;
  body?: string;
  kind?: "system" | "moderation" | "broadcast";
}

export const CONDITIONS: Condition[] = ["جديد", "ممتاز", "جيد"];
export const RENTAL_UNITS: RentalUnit[] = ["ساعة", "يوم", "شهر"];

/** Display price for a listing based on type. Integer EGP only. */
export function listingPriceLabel(l: Pick<ListingRow, "listing_type" | "rental_price" | "rental_unit" | "sale_price" | "deposit">): string {
  if (l.listing_type === "rent" && l.rental_price != null && l.rental_unit) {
    return `${l.rental_price} ج.م / ${l.rental_unit}`;
  }
  if (l.listing_type === "sale" && l.sale_price != null) {
    return `${l.sale_price} ج.م`;
  }
  return "مقايضة";
}

export function parseIntegerEgp(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}
