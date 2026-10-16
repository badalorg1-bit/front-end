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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export function getPublicUrlForPath(path: string): string {
  if (!isSupabaseConfigured) return "";
  return getSupabase().storage.from("listing-images").getPublicUrl(path).data.publicUrl;
}

/** Arabic error message for a thrown Supabase/pg error. Never logs secrets. */
export function toArabicError(err: unknown): string {
  const anyErr = err as { message?: string; code?: string; error_description?: string } | null;
  const code = anyErr?.code ?? "";
  const msg = (anyErr?.error_description ?? anyErr?.message ?? "").toLowerCase();

  if (code === "23P01" || msg.includes("exclusion") || msg.includes("overlap")) {
    return "الموعد المختار يتعارض مع فترة إيجار مؤكدة أخرى على هذا الإعلان.";
  }
  if (code === "23505" || msg.includes("unique")) {
    return "يوجد سجل مماثل بالفعل.";
  }
  if (code === "23514" || msg.includes("check constraint") || msg.includes("constraint")) {
    return "البيانات المدخلة غير مكتملة أو غير صالحة لنوع هذا الإعلان.";
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission")) {
    return "ليست لديك صلاحية تنفيذ هذا الإجراء.";
  }
  if (code === "409" || msg.includes("conflict")) {
    return "تعارض في الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.";
  }
  if (msg.includes("cannot request own")) {
    return "لا يمكنك إرسال طلب على إعلانك الخاص.";
  }
  if (msg.includes("invalid status transition") || msg.includes("only the")) {
    return "لا يمكن تنفيذ هذا التغيير في الحالة الحالية.";
  }
  if (msg.includes("invalid login credentials")) {
    return "بيانات الدخول غير صحيحة.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.";
  }
  if (msg.includes("email not confirmed")) {
    return "يرجى تأكيد البريد الإلكتروني قبل الدخول.";
  }
  if (msg.includes("password should be at least")) {
    return "كلمة المرور يجب ألا تقل عن 6 أحرف.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "تعذر الاتصال بالخادم. تحقق من الاتصال والتكوين.";
  }
  if (code === "22001") {
    return "أحد الحقول أطول من الحد المسموح.";
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
