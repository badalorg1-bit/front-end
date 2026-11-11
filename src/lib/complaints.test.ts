import { describe, expect, it } from "vitest";
import { validateComplaintFile, MAX_COMPLAINT_FILE_BYTES, ALLOWED_COMPLAINT_FILE_TYPES } from "@/lib/api";
import {
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_TYPES,
  MAX_COMPLAINT_ATTACHMENTS,
  validateComplaintInput,
} from "@/lib/types";
import { toArabicError } from "@/lib/supabase";

/** SRS §10.3 lists ELEVEN literal complaint types — the list must match verbatim. */
const SRS_10_3 = [
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
];

describe("COMPLAINT_TYPES (SRS §10.3)", () => {
  it("carries exactly the eleven spec types in spec order", () => {
    expect([...COMPLAINT_TYPES]).toEqual(SRS_10_3);
    expect(COMPLAINT_TYPES).toHaveLength(11);
  });

  it("labels every status", () => {
    for (const s of ["open", "in_review", "resolved", "rejected"] as const) {
      expect(COMPLAINT_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it("caps attachments at six (§10.2)", () => {
    expect(MAX_COMPLAINT_ATTACHMENTS).toBe(6);
  });
});

describe("validateComplaintInput", () => {
  it("accepts every one of the eleven types with valid details", () => {
    for (const t of COMPLAINT_TYPES) {
      expect(validateComplaintInput(t, "تفاصيل كافية للمشكلة هنا")).toBeNull();
    }
  });

  it("rejects a type outside the list", () => {
    expect(validateComplaintInput("نوع غير معروف", "تفاصيل كافية للمشكلة هنا")).toBe(
      "اختر نوع المشكلة من القائمة.",
    );
    expect(validateComplaintInput("", "تفاصيل كافية للمشكلة هنا")).toBe(
      "اختر نوع المشكلة من القائمة.",
    );
  });

  it("requires at least 10 characters of details", () => {
    expect(validateComplaintInput(COMPLAINT_TYPES[0], "قصير")).toBe(
      "أدخل تفاصيل المشكلة (10 أحرف على الأقل).",
    );
    // Exactly 10 passes (server bound is 10..5000).
    expect(validateComplaintInput(COMPLAINT_TYPES[0], "1234567890")).toBeNull();
  });

  it("trims before measuring and enforces the 5000-char ceiling", () => {
    expect(validateComplaintInput(COMPLAINT_TYPES[0], "   قصير   ")).toBe(
      "أدخل تفاصيل المشكلة (10 أحرف على الأقل).",
    );
    expect(validateComplaintInput(COMPLAINT_TYPES[0], "x".repeat(5000))).toBeNull();
    expect(validateComplaintInput(COMPLAINT_TYPES[0], "x".repeat(5001))).toBe(
      "التفاصيل أطول من الحد المسموح (5000 حرف).",
    );
  });
});

describe("validateComplaintFile", () => {
  it("accepts images AND pdf (§10.2 «الصور أو المستندات»)", () => {
    for (const type of ALLOWED_COMPLAINT_FILE_TYPES) {
      expect(validateComplaintFile(new File(["x"], "evidence", { type }))).toBeNull();
    }
    expect(ALLOWED_COMPLAINT_FILE_TYPES).toContain("application/pdf");
  });

  it("rejects other formats with the literal message", () => {
    expect(validateComplaintFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(
      "الصيغة المسموحة: JPEG أو PNG أو WebP أو GIF أو PDF فقط.",
    );
  });

  it("rejects files above 5 MB", () => {
    const big = new File([new Uint8Array(MAX_COMPLAINT_FILE_BYTES + 1)], "big.jpg", {
      type: "image/jpeg",
    });
    expect(validateComplaintFile(big)).toBe("حجم الملف يتجاوز 5 ميجابايت.");
  });
});

describe("toArabicError — complaints (0030)", () => {
  it("maps every 0030 failure code to its literal Arabic text", () => {
    expect(toArabicError({ message: "complaint_type_invalid" })).toBe(
      "اختر نوع المشكلة من القائمة.",
    );
    expect(toArabicError({ message: "complaint_details_required" })).toBe(
      "أدخل تفاصيل المشكلة (10 أحرف على الأقل).",
    );
    expect(toArabicError({ message: "complaint_details_too_long" })).toBe(
      "تفاصيل المشكلة أطول من الحد المسموح (5000 حرف).",
    );
    expect(toArabicError({ message: "complaint not found" })).toBe("الشكوى غير موجودة.");
    expect(toArabicError({ message: "resolution_required" })).toBe(
      "اكتب سبب القرار (10 أحرف على الأقل) قبل إغلاق الشكوى.",
    );
    expect(toArabicError({ message: "resolution_too_long" })).toBe(
      "سبب القرار أطول من الحد المسموح (2000 حرف).",
    );
    expect(toArabicError({ message: "not the reporter" })).toBe("هذه الشكوى ليست لك.");
    expect(toArabicError({ message: "open_complaint_limit" })).toBe(
      "لديك 20 شكوى مفتوحة كحد أقصى — انتظر إغلاق بعضها أولًا.",
    );
    expect(toArabicError({ message: "complaint_status_invalid" })).toBe(
      "حالة الشكوى غير صالحة.",
    );
    expect(toArabicError({ message: "invalid_status_filter" })).toBe(
      "تصفية الحالة غير صالحة.",
    );
    expect(toArabicError({ message: "account banned" })).toBe("هذا الحساب محظور.");
  });
});
