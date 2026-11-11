import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, sanitizeFilterValue, toArabicError, validateImageFile } from "@/lib/supabase";

describe("toArabicError", () => {
  it("maps escrow and handover messages to their literal Arabic text", () => {
    expect(toArabicError(new Error("escrow pay only allowed on accepted requests"))).toBe(
      "الدفع متاح بعد قبول طلب الحجز فقط.",
    );
    expect(toArabicError({ message: "insufficient_points" })).toBe(
      "رصيد نقاطك لا يكفي لهذا الحجز. اشحن محفظتك ثم حاول مرة أخرى.",
    );
    expect(toArabicError({ message: "return_code_required" })).toBe(
      "لا يمكن التحصيل قبل تأكيد الطرف الآخر لرمز الإرجاع.",
    );
    expect(toArabicError({ message: "condition photo required" })).toBe(
      "أرفق صورة واحدة على الأقل لحالة المنتج.",
    );
    expect(toArabicError({ message: "listing_quantity_exhausted" })).toBe(
      "نفدت كمية هذا الإعلان — لم يعد متاحًا للحجز.",
    );
  });

  it("maps permission, conflict and unknown errors", () => {
    expect(toArabicError({ code: "42501" })).toBe("ليست لديك صلاحية تنفيذ هذا الإجراء.");
    expect(toArabicError({ code: "409" })).toBe("تعارض في الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.");
    expect(toArabicError({ message: "boom" })).toBe("حدث خطأ غير متوقع. حاول مرة أخرى.");
  });

  it("maps the availability exclusion constraint (23P01)", () => {
    expect(toArabicError({ code: "23P01" })).toBe(
      "الموعد المختار يتعارض مع فترة إيجار مؤكدة أخرى على هذا الإعلان.",
    );
  });
});

describe("sanitizeFilterValue", () => {
  it("strips PostgREST filter-structure characters", () => {
    expect(sanitizeFilterValue("a,b(c)d\\e")).toBe("a b c d e");
  });

  it("collapses whitespace and truncates at 200 chars", () => {
    expect(sanitizeFilterValue("  x   y  ")).toBe("x y");
    expect(sanitizeFilterValue("z".repeat(300))).toHaveLength(200);
  });
});

describe("validateImageFile", () => {
  it("accepts a small png", () => {
    expect(validateImageFile(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
  });

  it("rejects a disallowed type with the literal message", () => {
    expect(validateImageFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(
      "الصيغة المسموحة: JPEG أو PNG أو WebP أو GIF فقط.",
    );
  });

  it("rejects files above 5 MB", () => {
    const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "big.jpg", { type: "image/jpeg" });
    expect(validateImageFile(big)).toBe("حجم الصورة يتجاوز 5 ميجابايت.");
  });
});
