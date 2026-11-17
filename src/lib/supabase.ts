import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (see .env.example).",
    );
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export function getPublicUrlForPath(path: string, bucket: string = "listing-images"): string {
  if (!isSupabaseConfigured) return "";
  return getSupabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function getPaymentQrPublicUrl(path: string): string {
  if (!isSupabaseConfigured) return "";
  return getSupabase().storage.from("payment-qr").getPublicUrl(path).data.publicUrl;
}

/** Strip PostgREST filter-structure characters so user/DB text can't break .or() parsing. */
export function sanitizeFilterValue(s: string): string {
  return s.replace(/[,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Arabic error message for a thrown Supabase/pg error. Never logs secrets. */
export function toArabicError(err: unknown): string {
  const anyErr = err as {
    message?: string;
    code?: string | number;
    error_code?: string;
    error_description?: string;
    msg?: string;
    status?: number;
  } | null;
  const code = String(anyErr?.code ?? "");
  const errorCode = (anyErr?.error_code ?? "").toLowerCase();
  const msg = (
    anyErr?.error_description ??
    anyErr?.msg ??
    anyErr?.message ??
    ""
  ).toLowerCase();
  const status = anyErr?.status;

  if (
    code === "429" ||
    status === 429 ||
    errorCode === "over_email_send_rate_limit" ||
    msg.includes("rate limit")
  ) {
    return "تم تجاوز حد محاولات التسجيل مؤقتًا. انتظر دقيقة ثم حاول مرة أخرى، أو استخدم بريدًا آخر.";
  }
  if (code === "23P01" || msg.includes("exclusion") || msg.includes("overlap")) {
    return "الموعد المختار يتعارض مع فترة إيجار مؤكدة أخرى على هذا الإعلان.";
  }
  if (msg.includes("listing_quantity_exhausted")) {
    return "نفدت كمية هذا الإعلان — لم يعد متاحًا للحجز.";
  }
  if (msg.includes("chat_requires_accepted_request")) {
    return "تُفتح المحادثة بعد قبول طلب الحجز فقط.";
  }
  if (msg.includes("sale_listings_retired")) {
    return "البيع لم يعد مدعومًا — بينا للإيجار والمقايضة فقط.";
  }
  if (msg.includes("purchase_requests_retired")) {
    return "طلبات الشراء لم تعد مدعومة — بينا للإيجار والمقايضة فقط.";
  }
  // ── Points wallet (0029) ────────────────────────────────────────────────
  if (msg.includes("insufficient_points")) {
    return "رصيد نقاطك لا يكفي لهذا الحجز. اشحن محفظتك ثم حاول مرة أخرى.";
  }
  if (msg.includes("amount does not match the rental price")) {
    return "المبلغ لا يطابق السعر المعلن لهذا الإعلان.";
  }
  if (msg.includes("escrow pay only allowed on accepted requests")) {
    return "الدفع متاح بعد قبول طلب الحجز فقط.";
  }
  if (msg.includes("only the requester can pay into escrow")) {
    return "يمكن للمستأجر فقط دفع مبلغ الحجز.";
  }
  if (msg.includes("escrow already exists for this request")) {
    return "يوجد حجز مدفوع لهذا الطلب بالفعل.";
  }
  if (msg.includes("listing has no rental price")) {
    return "هذا الإعلان بلا سعر إيجار — راجع المالك.";
  }
  if (msg.includes("amount must be a positive integer")) {
    return "أدخل مبلغًا صحيحًا.";
  }
  // ── Handover codes (0028 / A2) ─────────────────────────────────────────
  if (msg.includes("return_code_required")) {
    return "لا يمكن التحصيل قبل تأكيد الطرف الآخر لرمز الإرجاع.";
  }
  if (msg.includes("only the tenant can verify delivery")) {
    return "يمكن للمستأجر فقط تأكيد استلام المنتج.";
  }
  if (msg.includes("only the owner can verify return")) {
    return "يمكن للمالك فقط تأكيد إرجاع المنتج.";
  }
  if (msg.includes("only the seller can release escrow")) {
    return "يمكن للمؤجر فقط تحصيل مبلغ الحجز.";
  }
  if (msg.includes("handover_code_already_used")) {
    return "تم استخدام هذا الرمز بالفعل.";
  }
  if (msg.includes("handover_code_expired")) {
    return "انتهت صلاحية هذا الرمز.";
  }
  if (msg.includes("handover_code_locked")) {
    return "أُغلق الرمز بعد محاولات خاطئة كثيرة — راجع الطرف الآخر.";
  }
  if (msg.includes("handover code not found")) {
    return "لا يوجد رمز مسجّل لهذا الحجز بعد.";
  }
  if (msg.includes("condition note required")) {
    return "أدخل ملاحظة عن حالة المنتج قبل التأكيد.";
  }
  if (msg.includes("condition photo required")) {
    return "أرفق صورة واحدة على الأقل لحالة المنتج.";
  }
  if (msg.includes("condition note too long")) {
    return "ملاحظة الحالة أطول من الحد المسموح (1000 حرف).";
  }
  if (msg.includes("too many photos")) {
    return "الحد الأقصى 6 صور للتسليم.";
  }
  if (msg.includes("invalid photo path")) {
    return "مسار الصورة غير صالح.";
  }
  if (msg.includes("not a participant")) {
    return "أنت لست طرفًا في هذا الحجز.";
  }
  if (msg.includes("escrow is not held")) {
    return "الحجز غير مُثبت حاليًا.";
  }
  // ── Complaints (0030 / A3) ───────────────────────────────────────────────
  if (msg.includes("complaint_type_invalid")) {
    return "اختر نوع المشكلة من القائمة.";
  }
  if (msg.includes("complaint_details_required")) {
    return "أدخل تفاصيل المشكلة (10 أحرف على الأقل).";
  }
  if (msg.includes("complaint_details_too_long")) {
    return "تفاصيل المشكلة أطول من الحد المسموح (5000 حرف).";
  }
  if (msg.includes("complaint not found")) {
    return "الشكوى غير موجودة.";
  }
  if (msg.includes("resolution_required")) {
    return "اكتب سبب القرار (10 أحرف على الأقل) قبل إغلاق الشكوى.";
  }
  if (msg.includes("resolution_too_long")) {
    return "سبب القرار أطول من الحد المسموح (2000 حرف).";
  }
  if (msg.includes("not the reporter")) {
    return "هذه الشكوى ليست لك.";
  }
  if (msg.includes("open_complaint_limit")) {
    return "لديك 20 شكوى مفتوحة كحد أقصى — انتظر إغلاق بعضها أولًا.";
  }
  if (msg.includes("complaint_status_invalid")) {
    return "حالة الشكوى غير صالحة.";
  }
  if (msg.includes("invalid_status_filter")) {
    return "تصفية الحالة غير صالحة.";
  }
  if (msg.includes("not authenticated")) {
    return "سجّل الدخول أولاً.";
  }
  if (msg.includes("account banned")) {
    return "هذا الحساب محظور.";
  }
  // ── Dispute resolution (0031 / A7) ────────────────────────────────────────
  if (msg.includes("invalid_dispute_outcome")) {
    return "اختر نتيجة حسم النزاع.";
  }
  if (msg.includes("reason_required")) {
    return "اكتب سبب القرار (10 أحرف على الأقل).";
  }
  if (msg.includes("reason_too_long")) {
    return "سبب القرار أطول من الحد المسموح (2000 حرف).";
  }
  if (msg.includes("request is not disputed")) {
    return "هذا الطلب ليس في حالة نزاع.";
  }
  if (msg.includes("only moderators can cancel a disputed booking")) {
    return "إلغاء حجز متنازع عليه متاح لإدارة المنصة فقط.";
  }
  if (msg.includes("only participants can resolve a dispute")) {
    return "يحل الطرفان نزاعهما مباشرة، أو تديره الإدارة.";
  }
  // ── Availability (0032 / A4) ──────────────────────────────────────────────
  if (msg.includes("availability_not_found")) {
    return "هذا الإعلان غير موجود.";
  }
  if (msg.includes("availability_invalid_range")) {
    return "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.";
  }
  // ── Delivery (0033 / A6) ──────────────────────────────────────────────────
  if (msg.includes("delivery_rent_only")) {
    return "التوصيل متاح مع طلبات الإيجار فقط.";
  }
  if (msg.includes("delivery_address_required")) {
    return "أدخل عنوان التسليم (5 أحرف على الأقل).";
  }
  if (msg.includes("delivery_not_available")) {
    return "هذا الإعلان لا يدعم التوصيل.";
  }
  if (msg.includes("provider_too_long")) {
    return "اسم شركة التوصيل أطول من الحد المسموح (120 حرف).";
  }
  if (msg.includes("provider_required")) {
    return "أدخل اسم شركة التوصيل.";
  }
  if (msg.includes("courier_order_no_too_long")) {
    return "رقم طلب الشركة أطول من الحد المسموح (80 حرف).";
  }
  if (msg.includes("delivery_fee_invalid")) {
    return "رسوم التوصيل غير صالحة.";
  }
  if (msg.includes("delivery_order_exists")) {
    return "يوجد طلب توصيل مسجَّل لهذا الحجز.";
  }
  if (msg.includes("delivery_order_not_found")) {
    return "طلب التوصيل غير موجود.";
  }
  if (msg.includes("delivery_requires_accepted_booking")) {
    return "التوصيل يُسجَّل بعد تأكيد الحجز فقط.";
  }
  if (msg.includes("invalid_delivery_status")) {
    return "اختر حالة التوصيل.";
  }
  if (msg.includes("delivery_order_closed")) {
    return "طلب التوصيل مغلق (سُلِّم أو فشل) — لا يمكن تعديله.";
  }
  if (msg.includes("invalid_delivery_transition")) {
    return "لا يُمكن هذا الانتقال بين حالات التوصيل.";
  }
  if (msg.includes("delivery_note_too_long")) {
    return "ملاحظة التوصيل أطول من الحد المسموح (500 حرف).";
  }
  if (msg.includes("delivery_note_required")) {
    return "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).";
  }
  if (msg.includes("delivered_to_required")) {
    return "سجّل اسم مستلم التسليم.";
  }
  // ── Top-ups (0018 / 0029) ──────────────────────────────────────────────
  if (msg.includes("topup_already_reviewed")) {
    return "تمت مراجعة طلب الشحن بالفعل.";
  }
  if (msg.includes("topup_not_found")) {
    return "طلب الشحن غير موجود.";
  }
  if (msg.includes("invalid_amount")) {
    return "أدخل مبلغًا صحيحًا بين 1 و 100,000 ج.م.";
  }
  if (msg.includes("invalid_method")) {
    return "طريقة الدفع غير صالحة.";
  }
  if (msg.includes("pending_topup_exists")) {
    return "لديك طلب شحن قيد المراجعة بالفعل — انتظر حتى تنتهي مراجعته ثم أعد المحاولة.";
  }
  if (msg.includes("quota_exceeded")) {
    return "استنفدت رصيدك المجاني من الإعلانات لهذه الدورة — جرّب باقة مدفوعة أو انتظر تجديد الدورة.";
  }
  if (msg.includes("not_owner")) {
    return "هذا العنصر لا يخصك.";
  }
  if (msg.includes("request not found")) {
    return "الطلب غير موجود.";
  }
  if (code === "23505" || errorCode === "user_already_exists" || msg.includes("unique")) {
    return "يوجد سجل مماثل بالفعل.";
  }
  if (code === "23514" || msg.includes("check constraint") || msg.includes("constraint")) {
    return "البيانات المدخلة غير مكتملة أو غير صالحة لنوع هذا الإعلان.";
  }
  // ── Permissions matrix (0034 / A9) — must precede the generic
  //    `permission` catch-all below: every refusal code contains it.
  if (msg.includes("permission_grant_exceeds")) {
    return "لا يمكنك منح صلاحية لا تملكها بنفسك.";
  }
  if (msg.includes("permission_self_edit")) {
    return "لا يمكنك تعديل صلاحيات دورك — اطلب من مسؤول أعلى منك.";
  }
  if (msg.includes("permission_rank")) {
    return "لا يمكنك تعديل صلاحيات دور يساوي رتبتك أو يفوقها.";
  }
  if (msg.includes("permission_grant_invalid")) {
    return "قيمة الصلاحية غير صالحة.";
  }
  if (msg.includes("permission_unknown")) {
    return "صلاحية غير معروفة.";
  }
  if (msg.includes("role_invalid")) {
    return "دور غير صالح.";
  }
  if (msg.includes("لا يمكنك منح صلاحية أعلى من صلاحيتك")) {
    return "لا يمكنك منح صلاحية أعلى من صلاحيتك.";
  }
  if (msg.includes("لا يمكنك تعديل دور يساوي صلاحيتك أو يفوقها")) {
    return "لا يمكنك تعديل دور يساوي صلاحيتك أو يفوقها.";
  }
  if (msg.includes("ليست لديك صلاحية تعديل الأدوار")) {
    return "ليست لديك صلاحية تعديل الأدوار.";
  }
  if (msg.includes("منح مسؤول نظام يتطلب")) {
    return "منح دور مسؤول النظام يتطلب أن تكون مسؤول نظام بنفسك.";
  }
  if (msg.includes("لا يمكن تخفيض صلاحية آخر مالك")) {
    return "لا يمكن سحب صلاحية آخر مالك في المنصة.";
  }
  if (msg.includes("لا يمكن تخفيض صلاحية آخر مسؤول نظام")) {
    return "لا يمكن سحب صلاحية آخر مسؤول نظام في المنصة.";
  }
  if (code === "42501" || errorCode === "not_authorized" || msg.includes("row-level security") || msg.includes("permission")) {
    return "ليست لديك صلاحية تنفيذ هذا الإجراء.";
  }
  if (code === "409" || msg.includes("conflict")) {
    return "تعارض في الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.";
  }
  if (msg.includes("cannot request own")) {
    return "لا يمكنك إرسال طلب على إعلانك الخاص.";
  }
  if (errorCode === "user_already_exists" || msg.includes("already registered") || msg.includes("already been registered")) {
    return "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.";
  }
  if (msg.includes("invalid login credentials") || errorCode === "invalid_credentials") {
    return "بيانات الدخول غير صحيحة.";
  }
  if (msg.includes("email not confirmed") || errorCode === "email_not_confirmed") {
    return "يرجى تأكيد البريد الإلكتروني قبل الدخول.";
  }
  if (msg.includes("password should be at least") || errorCode === "weak_password") {
    return "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل تضم حروفًا وأرقامًا.";
  }
  if (msg.includes("invalid email") || errorCode === "validation_failed" || msg.includes("valid email")) {
    return "صيغة البريد الإلكتروني غير صحيحة.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "تعذر الاتصال بالخادم. تحقق من الاتصال والتكوين.";
  }
  if (code === "22001") {
    return "أحد الحقول أطول من الحد المسموح.";
  }
  if (msg.includes("invalid status transition") || msg.includes("only the")) {
    return "لا يمكن تنفيذ هذا التغيير في الحالة الحالية.";
  }

  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_LISTING = 6;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export function validateImageFile(file: File): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "الصيغة المسموحة: JPEG أو PNG أو WebP أو GIF فقط.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "حجم الصورة يتجاوز 5 ميجابايت.";
  }
  return null;
}
