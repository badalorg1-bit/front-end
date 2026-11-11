import { describe, expect, it } from "vitest";
import {
  DISPUTE_OUTCOMES,
  DISPUTE_OUTCOME_LABEL,
  DISPUTE_REASON_MAX,
  DISPUTE_REASON_MIN,
  validateDisputeResolution,
} from "@/lib/types";
import { toArabicError } from "@/lib/supabase";

describe("DISPUTE_OUTCOMES (0031 · admin_resolve_dispute)", () => {
  it("offers exactly the two server-accepted outcomes", () => {
    expect([...DISPUTE_OUTCOMES]).toEqual(["completed", "cancelled"]);
  });

  it("labels both outcomes in Arabic (same text the notifications use)", () => {
    expect(DISPUTE_OUTCOME_LABEL.completed).toBe("أُكملت الصفقة");
    expect(DISPUTE_OUTCOME_LABEL.cancelled).toBe("أُلغيت الصفقة");
  });
});

describe("validateDisputeResolution", () => {
  it("accepts both outcomes with a valid reason", () => {
    for (const outcome of DISPUTE_OUTCOMES) {
      expect(validateDisputeResolution(outcome, "حُسم بعد مراجعة الرسائل والمرفقات.")).toBeNull();
    }
  });

  it("rejects a missing or unknown outcome", () => {
    expect(validateDisputeResolution("", "سبب كافٍ لحسم النزاع.")).toBe("اختر نتيجة حسم النزاع.");
    expect(validateDisputeResolution("refunded", "سبب كافٍ لحسم النزاع.")).toBe(
      "اختر نتيجة حسم النزاع.",
    );
  });

  it("requires at least 10 characters of reason", () => {
    expect(validateDisputeResolution("completed", "قصير")).toBe(
      "اكتب سبب القرار (10 أحرف على الأقل).",
    );
    // Exactly the server bound passes.
    expect(validateDisputeResolution("completed", "1234567890")).toBeNull();
  });

  it("trims before measuring and enforces the 2000-char ceiling", () => {
    expect(validateDisputeResolution("cancelled", "   قصير   ")).toBe(
      "اكتب سبب القرار (10 أحرف على الأقل).",
    );
    expect(validateDisputeResolution("completed", "x".repeat(DISPUTE_REASON_MAX))).toBeNull();
    expect(validateDisputeResolution("completed", "x".repeat(DISPUTE_REASON_MAX + 1))).toBe(
      `سبب القرار أطول من الحد المسموح (${DISPUTE_REASON_MAX} حرف).`,
    );
    expect(DISPUTE_REASON_MIN).toBe(10);
    expect(DISPUTE_REASON_MAX).toBe(2000);
  });
});

describe("toArabicError — disputes (0031)", () => {
  it("maps every 0031 failure code to its literal Arabic text", () => {
    expect(toArabicError({ message: "invalid_dispute_outcome" })).toBe(
      "اختر نتيجة حسم النزاع.",
    );
    expect(toArabicError({ message: "reason_required" })).toBe(
      "اكتب سبب القرار (10 أحرف على الأقل).",
    );
    expect(toArabicError({ message: "reason_too_long" })).toBe(
      "سبب القرار أطول من الحد المسموح (2000 حرف).",
    );
    expect(toArabicError({ message: "request is not disputed" })).toBe(
      "هذا الطلب ليس في حالة نزاع.",
    );
    expect(toArabicError({ message: "only moderators can cancel a disputed booking" })).toBe(
      "إلغاء حجز متنازع عليه متاح لإدارة المنصة فقط.",
    );
    expect(toArabicError({ message: "only participants can resolve a dispute" })).toBe(
      "يحل الطرفان نزاعهما مباشرة، أو تديره الإدارة.",
    );
  });

  it("maps permission denied (shared by every admin RPC, 0030 + 0031)", () => {
    expect(toArabicError({ message: "permission denied" })).toBe(
      "ليست لديك صلاحية تنفيذ هذا الإجراء.",
    );
  });

  it("keeps request-not-found and not-authenticated intact", () => {
    expect(toArabicError({ message: "request not found" })).toBe("الطلب غير موجود.");
    expect(toArabicError({ message: "not authenticated" })).toBe("سجّل الدخول أولاً.");
  });
});
