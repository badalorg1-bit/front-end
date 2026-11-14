import { todayISO } from "@/lib/format";

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
/** The eight §5.2 account roles — mirrors profiles_role_check (0034). */
export type AdminRole =
  | "user"
  | "merchant"
  | "support"
  | "operations"
  | "moderator"
  | "admin"
  | "super_admin"
  | "owner";

/** Every AdminRole, in rank order — drives the role selects and filters. */
export const ADMIN_ROLES: readonly AdminRole[] = [
  "user",
  "merchant",
  "support",
  "operations",
  "moderator",
  "admin",
  "super_admin",
  "owner",
] as const;

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
  /** §9.2 — can this listing be delivered, and at what fee (owner-set, rent only). */
  delivery_available: boolean;
  delivery_fee: number;
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
  /** §9.2 — the tenant asked for delivery and gave an address (rent only, server-enforced). */
  delivery_requested: boolean;
  delivery_address: string | null;
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
  /** Instagram QR (legacy column name kept for compatibility). */
  qr_path: string | null;
  /** Scan-to-transfer wallet QR — the primary payment source. */
  wallet_qr_path: string | null;
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
  merchant: "تاجر",
  support: "الدعم",
  operations: "العمليات",
  moderator: "مشرف",
  admin: "مدير",
  super_admin: "مسؤول النظام",
  owner: "المالك",
};

/** Rank on the server's app_role_rank scale (0034): the old four keep their
 *  relative order, so every threshold comparison keeps its meaning. */
export const ADMIN_ROLE_RANK: Record<AdminRole, number> = {
  user: 0,
  merchant: 0,
  support: 1,
  operations: 1,
  moderator: 2,
  admin: 3,
  super_admin: 4,
  owner: 5,
};

/** The twelve permissions of the role_permissions matrix (0034). */
export const PERMISSIONS = [
  "reports.view",
  "listings.review",
  "requests.view",
  "complaints.view",
  "complaints.manage",
  "disputes.manage",
  "delivery.manage",
  "notifications.broadcast",
  "users.manage",
  "settings.manage",
  "audit.view",
  "permissions.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  "reports.view": "التقارير",
  "listings.review": "مراجعة الإعلانات",
  "requests.view": "الطلبات",
  "complaints.view": "عرض الشكاوى",
  "complaints.manage": "إدارة الشكاوى",
  "disputes.manage": "إدارة النزاعات",
  "delivery.manage": "إدارة التوصيل",
  "notifications.broadcast": "إرسال الإشعارات",
  "users.manage": "إدارة المستخدمين",
  "settings.manage": "إدارة الإعدادات",
  "audit.view": "سجل الإجراءات",
  "permissions.manage": "إدارة الصلاحيات",
};

/** Client-side mirror of the 49 seeded role_permissions rows (0034 §5).
 *  The admin gates below derive from this seed so the UI hides what the
 *  server would refuse; the «الصلاحيات» tab itself shows the SERVER truth
 *  (admin_list_role_permissions) once loaded. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  user: [],
  merchant: [],
  support: ["requests.view", "complaints.view", "complaints.manage"],
  operations: ["reports.view", "listings.review", "requests.view"],
  moderator: [
    "reports.view",
    "listings.review",
    "requests.view",
    "complaints.view",
    "complaints.manage",
    "disputes.manage",
    "delivery.manage",
    "notifications.broadcast",
  ],
  admin: [
    "reports.view",
    "listings.review",
    "requests.view",
    "complaints.view",
    "complaints.manage",
    "disputes.manage",
    "delivery.manage",
    "notifications.broadcast",
    "users.manage",
    "settings.manage",
    "audit.view",
  ],
  super_admin: [...PERMISSIONS],
  owner: [...PERMISSIONS],
};

/** Back-office staff: everything except the two end-user accounts.
 *  Drives stats.staffCount and the فريق الإدارة list (merchant excluded). */
export function isStaffRole(role: AdminRole): boolean {
  return role !== "user" && role !== "merchant";
}

/** Does this role hold `permission`? (local mirror of has_permission) */
export function roleHasPermission(
  role: AdminRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** May the actor edit `targetRole`'s cell in the permissions matrix?
 *  Mirrors admin_set_role_permission's structural gates: needs
 *  permissions.manage, never your own role, strictly lower rank. */
export function canEditRolePermission(
  actorRole: AdminRole | null | undefined,
  targetRole: AdminRole,
): boolean {
  if (!actorRole) return false;
  return (
    roleHasPermission(actorRole, "permissions.manage") &&
    actorRole !== targetRole &&
    ADMIN_ROLE_RANK[targetRole] < ADMIN_ROLE_RANK[actorRole]
  );
}

/** One cell-row of admin_list_role_permissions (0034) — 96 rows, granted=seed. */
export interface RolePermissionRow {
  role: AdminRole;
  permission: Permission;
  granted: boolean;
  role_rank: number;
}

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

// ── Dispute resolution (SRS §10.4 · 0031 · A7) ──────────────────────────────

export const DISPUTE_OUTCOMES = ["completed", "cancelled"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const DISPUTE_OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  completed: "أُكملت الصفقة",
  cancelled: "أُلغيت الصفقة",
};

/** One delivery/return row of admin_list_disputes (0031) — codes never sent. */
export interface DisputeHandoverRow {
  purpose: HandoverPurpose;
  valid_until: string;
  attempts: number;
  used_at: string | null;
  used_by_name: string | null;
  condition_note: string | null;
  photos: string[];
  is_expired: boolean;
}

export interface DisputeMessageRow {
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

/** Linked complaint (0030) as shown inside the dispute panel. */
export interface DisputeComplaintRow {
  reference: string;
  complaint_type: ComplaintType;
  status: ComplaintStatus;
  attachments: number;
}

export interface DisputeEscrowInfo {
  amount: number;
  status: "held" | "released" | "refunded";
  held_at: string;
  released_at: string | null;
  refunded_at: string | null;
}

/** One open dispute of admin_list_disputes — the whole §10.4 review panel. */
export interface DisputeRow {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_city: string | null;
  request_type: RequestType;
  requester_id: string;
  requester_name: string;
  owner_id: string;
  owner_name: string;
  message: string | null;
  rent_start: string | null;
  rent_end: string | null;
  created_at: string;
  updated_at: string;
  escrow: DisputeEscrowInfo | null;
  handover: DisputeHandoverRow[];
  messages: DisputeMessageRow[];
  complaints: DisputeComplaintRow[];
}

/** One recorded resolution from admin_audit_log (decision + reason). */
export interface DisputeResolutionRow {
  request_id: string;
  listing_title: string;
  outcome: DisputeOutcome;
  reason: string;
  decided_by: string;
  decided_at: string;
}

export interface DisputeListResult {
  open: DisputeRow[];
  history: DisputeResolutionRow[];
}

export const DISPUTE_REASON_MIN = 10;
export const DISPUTE_REASON_MAX = 2000;

/**
 * Client-side mirror of admin_resolve_dispute's validation (0031) so the
 * form fails fast; the server enforces the same bounds regardless.
 * Returns an Arabic error message, or null when valid.
 */
export function validateDisputeResolution(outcome: string, reason: string): string | null {
  if (!(DISPUTE_OUTCOMES as readonly string[]).includes(outcome)) {
    return "اختر نتيجة حسم النزاع.";
  }
  const r = reason.trim();
  if (r.length < DISPUTE_REASON_MIN) {
    return "اكتب سبب القرار (10 أحرف على الأقل).";
  }
  if (r.length > DISPUTE_REASON_MAX) {
    return `سبب القرار أطول من الحد المسموح (${DISPUTE_REASON_MAX} حرف).`;
  }
  return null;
}

// ── Availability (SRS §4.9 · 0032 · A4) ─────────────────────────────────────

/** One owner window of listing_availability (§6.1 «مواعيد التوافر»). */
export interface AvailabilityWindow {
  id: string;
  listing_id: string;
  starts_on: string;
  ends_on: string;
  note: string | null;
  created_at: string;
}

/** A date range as returned by check_listing_availability (dates only). */
export interface AvailabilityRange {
  starts_on: string;
  ends_on: string;
}

export type AvailabilityReason = "conflict" | "outside_availability" | "past_dates";

/** Result of check_listing_availability — calendar payload + §4.9 verdict. */
export interface AvailabilityCheck {
  available: boolean;
  reason: AvailabilityReason | null;
  conflicts: AvailabilityRange[];
  windows: AvailabilityRange[];
  booked: AvailabilityRange[];
}

export const AVAILABILITY_REASON_LABEL: Record<AvailabilityReason, string> = {
  conflict: "تتعارض الفترة مع حجز مؤكّد أو نزاع قائم على نفس الإعلان.",
  outside_availability: "الفترة خارج مواعيد التوافر التي حدّدها المالك.",
  past_dates: "اختر فترة تبدأ من تاريخ اليوم.",
};

export const AVAILABILITY_NOTE_MAX = 200;

/**
 * Client-side mirror of the window rules (table CHECK + date sanity) so the
 * owner form fails fast; the DB enforces the same bounds regardless.
 * Returns an Arabic error message, or null when valid.
 */
export function validateAvailabilityWindow(
  startsOn: string,
  endsOn: string,
  note?: string,
): string | null {
  if (!startsOn || !endsOn) {
    return "اختر تاريخي بداية ونهاية التوافر.";
  }
  if (endsOn < startsOn) {
    return "تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه.";
  }
  if (startsOn < todayISO()) {
    return "لا يمكن تحديد توافر يبدأ في الماضي.";
  }
  if ((note ?? "").trim().length > AVAILABILITY_NOTE_MAX) {
    return `الملاحظة أطول من الحد المسموح (${AVAILABILITY_NOTE_MAX} حرف).`;
  }
  return null;
}

// ── Delivery (SRS §9 · 0033 · A6) ────────────────────────────────────────────

export type DeliveryStatus = "assigned" | "shipped" | "delayed" | "delivered" | "failed";

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "assigned",
  "shipped",
  "delayed",
  "delivered",
  "failed",
];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  assigned: "سُجِّل التوصيل",
  shipped: "في الطريق",
  delayed: "متأخر",
  delivered: "تم التسليم",
  failed: "فشل التوصيل",
};

/** The live order as returned by get_delivery_order / admin_list_delivery_orders. */
export interface DeliveryOrder {
  request_id: string;
  provider: string;
  courier_order_no: string | null;
  delivery_fee: number;
  address: string;
  status: DeliveryStatus;
  status_note: string | null;
  delivered_to: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  // admin list extras
  listing_title?: string;
  listing_city?: string | null;
  requester_name?: string | null;
  owner_name?: string | null;
  complaints?: { reference: string; complaint_type: string; status: string }[];
}

/** An accepted booking with no order yet — the manual-entry candidates (§9.3). */
export interface DeliveryEligible {
  request_id: string;
  listing_title: string;
  listing_city: string | null;
  requester_name: string | null;
  owner_name: string | null;
  rent_start: string | null;
  rent_end: string | null;
  delivery_requested: boolean;
  delivery_address: string | null;
  listing_delivery_fee: number;
}

export interface DeliveryListResult {
  orders: DeliveryOrder[];
  eligible: DeliveryEligible[];
}

export const DELIVERY_PROVIDER_MIN = 2;
export const DELIVERY_PROVIDER_MAX = 120;
export const DELIVERY_ORDER_NO_MAX = 80;
export const DELIVERY_ADDRESS_MIN = 5;
export const DELIVERY_ADDRESS_MAX = 300;
export const DELIVERY_NOTE_MIN = 10;
export const DELIVERY_NOTE_MAX = 500;
export const DELIVERED_TO_MAX = 120;

/**
 * Client-side mirror of admin_create_delivery_order's rules so the admin
 * form fails fast; the RPC enforces the same bounds regardless.
 * Returns an Arabic error message, or null when valid.
 */
export function validateDeliveryOrder(input: {
  provider: string;
  courierOrderNo?: string;
  deliveryFee: number;
  address: string;
}): string | null {
  const provider = input.provider.trim();
  if (provider.length < DELIVERY_PROVIDER_MIN) return "أدخل اسم شركة التوصيل.";
  if (provider.length > DELIVERY_PROVIDER_MAX) {
    return `اسم شركة التوصيل أطول من الحد المسموح (${DELIVERY_PROVIDER_MAX} حرف).`;
  }
  if ((input.courierOrderNo ?? "").trim().length > DELIVERY_ORDER_NO_MAX) {
    return `رقم طلب الشركة أطول من الحد المسموح (${DELIVERY_ORDER_NO_MAX} حرف).`;
  }
  if (!Number.isFinite(input.deliveryFee) || input.deliveryFee < 0) {
    return "رسوم التوصيل غير صالحة.";
  }
  const address = input.address.trim();
  if (address.length < DELIVERY_ADDRESS_MIN || address.length > DELIVERY_ADDRESS_MAX) {
    return `أدخل عنوان التسليم (${DELIVERY_ADDRESS_MIN} أحرف على الأقل).`;
  }
  return null;
}

/**
 * Client-side mirror of admin_update_delivery_order's rules: delay/failure
 * need a reason, delivery needs proof of who received it.
 */
export function validateDeliveryStatusUpdate(
  status: DeliveryStatus,
  note: string,
  deliveredTo: string,
): string | null {
  const n = note.trim();
  if (n.length > DELIVERY_NOTE_MAX) {
    return `ملاحظة التوصيل أطول من الحد المسموح (${DELIVERY_NOTE_MAX} حرف).`;
  }
  if (status === "delayed" || status === "failed") {
    if (n.length < DELIVERY_NOTE_MIN) {
      return "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).";
    }
  }
  if (status === "delivered") {
    if (deliveredTo.trim().length < 2) return "سجّل اسم مستلم التسليم.";
    if (deliveredTo.trim().length > DELIVERED_TO_MAX) {
      return `اسم المستلم أطول من الحد المسموح (${DELIVERED_TO_MAX} حرف).`;
    }
  }
  return null;
}
