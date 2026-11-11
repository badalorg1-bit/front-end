import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_NOTE_MAX,
  AVAILABILITY_REASON_LABEL,
  validateAvailabilityWindow,
} from "@/lib/types";
import { toArabicError } from "@/lib/supabase";
import { addDaysISO, todayISO } from "@/lib/format";

const future = (days: number) => addDaysISO(todayISO(), days);

describe("AVAILABILITY_REASON_LABEL (0032 · check_listing_availability)", () => {
  it("labels every reason the RPC can return", () => {
    expect(Object.keys(AVAILABILITY_REASON_LABEL).sort()).toEqual([
      "conflict",
      "outside_availability",
      "past_dates",
    ]);
    for (const label of Object.values(AVAILABILITY_REASON_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("validateAvailabilityWindow", () => {
  it("accepts a same-day window starting today", () => {
    expect(validateAvailabilityWindow(todayISO(), todayISO())).toBeNull();
  });

  it("accepts a multi-day future window with an optional note", () => {
    expect(validateAvailabilityWindow(future(1), future(7), "متاح مساءً فقط")).toBeNull();
    expect(validateAvailabilityWindow(future(1), future(7), "")).toBeNull();
    expect(validateAvailabilityWindow(future(1), future(7), undefined)).toBeNull();
  });

  it("requires both dates", () => {
    expect(validateAvailabilityWindow("", future(3))).toBe("اختر تاريخي بداية ونهاية التوافر.");
    expect(validateAvailabilityWindow(future(1), "")).toBe("اختر تاريخي بداية ونهاية التوافر.");
    expect(validateAvailabilityWindow("", "")).toBe("اختر تاريخي بداية ونهاية التوافر.");
  });

  it("rejects an end before the start but allows equality", () => {
    expect(validateAvailabilityWindow(future(5), future(4))).toBe(
      "تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه.",
    );
    expect(validateAvailabilityWindow(future(5), future(5))).toBeNull();
  });

  it("rejects a start in the past", () => {
    expect(validateAvailabilityWindow(addDaysISO(todayISO(), -1), future(2))).toBe(
      "لا يمكن تحديد توافر يبدأ في الماضي.",
    );
    // Past END with a future start is already caught by end >= start.
    expect(validateAvailabilityWindow(todayISO(), addDaysISO(todayISO(), -1))).toBe(
      "تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه.",
    );
  });

  it("enforces the 200-char note ceiling (table CHECK mirror)", () => {
    expect(AVAILABILITY_NOTE_MAX).toBe(200);
    expect(validateAvailabilityWindow(future(1), future(2), "x".repeat(200))).toBeNull();
    expect(validateAvailabilityWindow(future(1), future(2), "x".repeat(201))).toBe(
      "الملاحظة أطول من الحد المسموح (200 حرف).",
    );
    // Measured after trim: surrounding spaces don't count toward the ceiling.
    expect(validateAvailabilityWindow(future(1), future(2), `  ${"x".repeat(200)}  `)).toBeNull();
    expect(
      validateAvailabilityWindow(future(1), future(2), `  ${"x".repeat(201)}  `),
    ).toBe("الملاحظة أطول من الحد المسموح (200 حرف).");
  });
});

describe("toArabicError — availability (0032)", () => {
  it("maps both 0032 failure codes to their literal Arabic text", () => {
    expect(toArabicError({ message: "availability_not_found" })).toBe("هذا الإعلان غير موجود.");
    expect(toArabicError({ message: "availability_invalid_range" })).toBe(
      "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.",
    );
  });

  it("keeps the 23P01 overlap translation (the GiST backstop)", () => {
    expect(toArabicError({ code: "23P01" })).toBe(
      "الموعد المختار يتعارض مع فترة إيجار مؤكدة أخرى على هذا الإعلان.",
    );
    expect(toArabicError({ message: "exclusion constraint" })).toBe(
      "الموعد المختار يتعارض مع فترة إيجار مؤكدة أخرى على هذا الإعلان.",
    );
  });

  it("keeps permission denied covered (shared with 0030/0031)", () => {
    expect(toArabicError({ message: "permission denied" })).toBe(
      "ليست لديك صلاحية تنفيذ هذا الإجراء.",
    );
  });
});
