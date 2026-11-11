export type ListingType = "rent" | "swap";
export type ListingStatus = "draft" | "published" | "archived" | "blocked";
export type Condition = "جديد" | "ممتاز" | "جيد";
export type RentalUnit = "ساعة" | "يوم" | "شهر";
export type RequestType = "rent" | "swap";
export type RequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "completed"
  | "disputed";
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
  swap_preferences: string | null;
  /** M2: units available to rent at once (decremented on payment, restored on settlement). */
  quantity: number;
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

export type EscrowStatus = "pending_confirmation" | "held" | "released" | "refunded";

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
  amount_egp?: number;
  fee_percent: number;
  fee_amount: number;
  net_amount: number;
  status: EscrowStatus;
  payment_method?: string;
  delivery_valid_until?: string;
  return_valid_until?: string;
}

// ── Booking handover codes (SRS §7.4 / A2) ────────────────────────────────

export type HandoverPurpose = "delivery" | "return";

/** Row of get_handover_codes — `code` is null unless this caller may read it. */
export interface HandoverCodeRow {
  purpose: HandoverPurpose;
  code: string | null;
  valid_until: string;
  attempts: number;
  max_attempts: number;
  used_at: string | null;
  used_by: string | null;
  condition_note: string | null;
  photos: string[];
  is_expired: boolean;
  is_locked: boolean;
}

/** verify_handover_code result: ok:false is a wrong code, not an exception. */
export interface HandoverVerifyResult {
  ok: boolean;
  error?: string;
  attempts_remaining?: number;
  purpose?: HandoverPurpose;
  used_at?: string;
}

export interface BaynaPaymentSettings {
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
  /** Points balance (the platform's currency since 0029). */
  balance: number;
  /** EGP value of one point — display only (default 0.5 => 100 نقطة = 50 ج.م). */
  point_value_egp: number;
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
  swap: "مقايضة",
};

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  rent: "طلب تأجير",
  swap: "عرض مقايضة",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "في انتظار الرد",
  accepted: "مقبول",
  rejected: "مرفوض",
  cancelled: "ملغي",
  completed: "مكتمل",
  disputed: "نزاع",
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

export interface AdminAiWarningRow {
  id: string;
  user_id: string | null;
  message: string;
  ip: string;
  detected_type: string;
  conversation: Array<{ role: string; text: string }>;
  reviewed: boolean;
  created_at: string;
}

export interface NotificationInput {
  title: string;
  body?: string;
  kind?: "system" | "moderation" | "broadcast";
}

export const CONDITIONS: Condition[] = ["جديد", "ممتاز", "جيد"];
export const RENTAL_UNITS: RentalUnit[] = ["ساعة", "يوم", "شهر"];

/** Display price for a listing based on type. Denominated in POINTS (0029). */
export function listingPriceLabel(l: Pick<ListingRow, "listing_type" | "rental_price" | "rental_unit" | "deposit">): string {
  if (l.listing_type === "rent" && l.rental_price != null && l.rental_unit) {
    return `${l.rental_price} نقطة / ${l.rental_unit}`;
  }
  return "مقايضة";
}

export function parseIntegerEgp(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

// ── Customer-support complaints (SRS §10.2 · §10.3 / 0030 · A3) ─────────────

export type ComplaintStatus = "open" | "in_review" | "resolved" | "rejected";

/** The ELEVEN literal types of SRS §10.3, in spec order. Stored verbatim. */
export const COMPLAINT_TYPES = [
  "مشكلة في الحجز",
  "مشكلة في الدفع",
  "عدم تسليم المنتج",
  "اختلاف المنتج عن الوصف",
  "تلف المنتج",
  "تأخير الإرجاع",
  "خلاف حول التأمين",
  "مشكلة في التوصيل",
  "مشكلة في الحساب",
  "الإبلاغ عن إعلان مخالف",
  "الاشتباه في احتيال",
] as const;

export type ComplaintType = (typeof COMPLAINT_TYPES)[number];

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: "مفتوحة",
  in_review: "قيد المراجعة",
  resolved: "محلولة",
  rejected: "مرفوضة",
};

/** Row of list_my_complaints (0030). */
export interface ComplaintRow {
  id: string;
  reference: string;
  complaint_type: ComplaintType;
  details: string;
  status: ComplaintStatus;
  resolution: string | null;
  request_id: string | null;
  listing_id: string | null;
  attachments: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** Row of admin_list_complaints (0030) — adds reporter + resolver names. */
export interface AdminComplaintRow extends ComplaintRow {
  reporter_id: string;
  reporter_name: string;
  resolver_name: string | null;
}

export const COMPLAINT_DETAILS_MIN = 10;
export const COMPLAINT_DETAILS_MAX = 5000;
export const MAX_COMPLAINT_ATTACHMENTS = 6;

/**
 * Client-side mirror of open_complaint's validation (0030) so the form can
 * fail fast; the server enforces the same bounds regardless.
 * Returns an Arabic error message, or null when valid.
 */
export function validateComplaintInput(type: string, details: string): string | null {
  if (!(COMPLAINT_TYPES as readonly string[]).includes(type)) {
    return "اختر نوع المشكلة من القائمة.";
  }
  const d = details.trim();
  if (d.length < COMPLAINT_DETAILS_MIN) {
    return "أدخل تفاصيل المشكلة (10 أحرف على الأقل).";
  }
  if (d.length > COMPLAINT_DETAILS_MAX) {
    return `التفاصيل أطول من الحد المسموح (${COMPLAINT_DETAILS_MAX} حرف).`;
  }
  return null;
}
