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
  payer_confirmed_at: string | null;
  payee_confirmed_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentProfile {
  wallet_name: string | null;
  payment_qr_path: string | null;
  instagram_handle: string | null;
  whatsapp_phone: string | null;
  payment_note: string | null;
}

export interface PaymentInstructions extends PaymentProfile {
  owner_name: string | null;
}

export interface DirectPaymentState {
  role: "payer" | "payee";
  payer_confirmed_at: string | null;
  payee_confirmed_at: string | null;
  paid_at: string | null;
}

export type EscrowStatus = "held" | "released" | "refunded";

export interface EscrowHold {
  id: string;
  status: EscrowStatus;
  amount: number;
  fee_percent: number;
  fee_amount: number;
  net_amount: number;
  held_at: string;
  released_at: string | null;
  refunded_at: string | null;
}

export interface EscrowPayResult {
  hold_id: string;
  amount: number;
  fee_percent: number;
  fee_amount: number;
  net_amount: number;
  status: EscrowStatus;
  payment_method?: string;
}

export interface BadalPaymentSettings {
  wallet_name: string | null;
  qr_path: string | null;
  instagram: string | null;
  fee_percent: number;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  amount: number;
  kind: "deposit" | "escrow_hold" | "escrow_release" | "escrow_refund" | "fee" | "admin_adjust";
  request_id: string | null;
  note: string | null;
  created_at: string;
}

export interface WalletSummary {
  balance: number;
  fee_percent: number;
  transactions: WalletTransaction[];
}

export interface Review {
  id: string;
  request_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string;
  created_at: string;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
}

export interface UserPublicProfile {
  id: string;
  display_name: string;
  city: string | null;
  avatar_url: string | null;
  created_at: string;
  rating_avg: number;
  rating_count: number;
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
