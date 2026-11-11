import { describe, expect, it } from "vitest";
import {
  DELIVERED_TO_MAX,
  DELIVERY_ADDRESS_MAX,
  DELIVERY_NOTE_MAX,
  DELIVERY_NOTE_MIN,
  DELIVERY_ORDER_NO_MAX,
  DELIVERY_PROVIDER_MAX,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABEL,
  validateDeliveryOrder,
  validateDeliveryStatusUpdate,
} from "@/lib/types";
import { toArabicError } from "@/lib/supabase";

describe("DELIVERY_STATUS_LABEL (0033 · delivery_orders.status)", () => {
  it("labels every status the RPC can return", () => {
    expect(DELIVERY_STATUSES).toEqual(["assigned", "shipped", "delayed", "delivered", "failed"]);
    expect(Object.keys(DELIVERY_STATUS_LABEL).sort()).toEqual(
      [...DELIVERY_STATUSES].sort(),
    );
    for (const label of Object.values(DELIVERY_STATUS_LABEL)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("validateDeliveryOrder (mirror of admin_create_delivery_order)", () => {
  const valid = {
    provider: "شركة توصيل معتمدة",
    courierOrderNo: "ORD-12345",
    deliveryFee: 25,
    address: "القاهرة — مدينة نصر — شارع مصطفى النحاس 12",
  };

  it("accepts a fully-populated order", () => {
    expect(validateDeliveryOrder(valid)).toBeNull();
    // Optional order number + zero fee are legal.
    expect(
      validateDeliveryOrder({ ...valid, courierOrderNo: "", deliveryFee: 0 }),
    ).toBeNull();
    expect(
      validateDeliveryOrder({ ...valid, courierOrderNo: undefined }),
    ).toBeNull();
  });

  it("requires a provider of at least 2 chars (table CHECK mirror)", () => {
    expect(DELIVERY_PROVIDER_MAX).toBe(120);
    expect(validateDeliveryOrder({ ...valid, provider: "" })).toBe(
      "أدخل اسم شركة التوصيل.",
    );
    expect(validateDeliveryOrder({ ...valid, provider: "  " })).toBe(
      "أدخل اسم شركة التوصيل.",
    );
    expect(validateDeliveryOrder({ ...valid, provider: "أ" })).toBe(
      "أدخل اسم شركة التوصيل.",
    );
    expect(
      validateDeliveryOrder({ ...valid, provider: "س".repeat(DELIVERY_PROVIDER_MAX) }),
    ).toBeNull();
    expect(
      validateDeliveryOrder({ ...valid, provider: "س".repeat(DELIVERY_PROVIDER_MAX + 1) }),
    ).toBe(`اسم شركة التوصيل أطول من الحد المسموح (${DELIVERY_PROVIDER_MAX} حرف).`);
  });

  it("caps the courier order number at 80 chars", () => {
    expect(DELIVERY_ORDER_NO_MAX).toBe(80);
    expect(
      validateDeliveryOrder({ ...valid, courierOrderNo: "x".repeat(80) }),
    ).toBeNull();
    expect(
      validateDeliveryOrder({ ...valid, courierOrderNo: "x".repeat(81) }),
    ).toBe(`رقم طلب الشركة أطول من الحد المسموح (${DELIVERY_ORDER_NO_MAX} حرف).`);
  });

  it("rejects a negative or non-finite fee", () => {
    expect(validateDeliveryOrder({ ...valid, deliveryFee: -1 })).toBe(
      "رسوم التوصيل غير صالحة.",
    );
    expect(validateDeliveryOrder({ ...valid, deliveryFee: NaN })).toBe(
      "رسوم التوصيل غير صالحة.",
    );
    expect(validateDeliveryOrder({ ...valid, deliveryFee: Infinity })).toBe(
      "رسوم التوصيل غير صالحة.",
    );
    // Large but finite fees pass client-side (the RPC has no ceiling).
    expect(validateDeliveryOrder({ ...valid, deliveryFee: 1_000_000 })).toBeNull();
  });

  it("requires an address of 5..300 chars (table CHECK mirror)", () => {
    expect(DELIVERY_ADDRESS_MAX).toBe(300);
    expect(validateDeliveryOrder({ ...valid, address: "" })).toBe(
      "أدخل عنوان التسليم (5 أحرف على الأقل).",
    );
    expect(validateDeliveryOrder({ ...valid, address: "abc" })).toBe(
      "أدخل عنوان التسليم (5 أحرف على الأقل).",
    );
    expect(validateDeliveryOrder({ ...valid, address: "abcde" })).toBeNull();
    // Measured after trim, like the form submits it.
    expect(validateDeliveryOrder({ ...valid, address: "  abcde  " })).toBeNull();
    expect(
      validateDeliveryOrder({ ...valid, address: "م".repeat(DELIVERY_ADDRESS_MAX) }),
    ).toBeNull();
    expect(
      validateDeliveryOrder({ ...valid, address: "م".repeat(DELIVERY_ADDRESS_MAX + 1) }),
    ).toBe("أدخل عنوان التسليم (5 أحرف على الأقل).");
  });
});

describe("validateDeliveryStatusUpdate (mirror of admin_update_delivery_order)", () => {
  it("allows a plain forward move with no note", () => {
    expect(validateDeliveryStatusUpdate("shipped", "", "")).toBeNull();
    expect(validateDeliveryStatusUpdate("assigned", "بدون ملاحظة", "")).toBeNull();
  });

  it("requires a ≥10-char reason for delayed/failed", () => {
    expect(DELIVERY_NOTE_MIN).toBe(10);
    expect(validateDeliveryStatusUpdate("delayed", "", "")).toBe(
      "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).",
    );
    expect(validateDeliveryStatusUpdate("failed", "س", "")).toBe(
      "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).",
    );
    expect(validateDeliveryStatusUpdate("failed", "  قصير  ", "")).toBe(
      "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).",
    );
    expect(
      validateDeliveryStatusUpdate("delayed", "تأخير من الشركة بسبب الأحوال الجوية", ""),
    ).toBeNull();
    expect(validateDeliveryStatusUpdate("failed", "x".repeat(10), "")).toBeNull();
  });

  it("requires proof of delivery for delivered", () => {
    expect(validateDeliveryStatusUpdate("delivered", "", "")).toBe(
      "سجّل اسم مستلم التسليم.",
    );
    expect(validateDeliveryStatusUpdate("delivered", "", "  ")).toBe(
      "سجّل اسم مستلم التسليم.",
    );
    expect(validateDeliveryStatusUpdate("delivered", "", "أ")).toBe(
      "سجّل اسم مستلم التسليم.",
    );
    expect(validateDeliveryStatusUpdate("delivered", "", "محمد أحمد")).toBeNull();
  });

  it("caps the note at 500 and the recipient name at 120", () => {
    expect(DELIVERY_NOTE_MAX).toBe(500);
    expect(DELIVERED_TO_MAX).toBe(120);
    expect(validateDeliveryStatusUpdate("shipped", "م".repeat(500), "")).toBeNull();
    expect(validateDeliveryStatusUpdate("shipped", "م".repeat(501), "")).toBe(
      `ملاحظة التوصيل أطول من الحد المسموح (${DELIVERY_NOTE_MAX} حرف).`,
    );
    expect(validateDeliveryStatusUpdate("delivered", "", "م".repeat(120))).toBeNull();
    expect(validateDeliveryStatusUpdate("delivered", "", "م".repeat(121))).toBe(
      `اسم المستلم أطول من الحد المسموح (${DELIVERED_TO_MAX} حرف).`,
    );
  });
});

describe("toArabicError — delivery (0033)", () => {
  it("maps every 0033 failure code to its literal Arabic text", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ message: "delivery_rent_only" }, "التوصيل متاح مع طلبات الإيجار فقط."],
      [{ message: "delivery_address_required" }, "أدخل عنوان التسليم (5 أحرف على الأقل)."],
      [{ message: "delivery_not_available" }, "هذا الإعلان لا يدعم التوصيل."],
      [{ message: "provider_required" }, "أدخل اسم شركة التوصيل."],
      [
        { message: "provider_too_long" },
        "اسم شركة التوصيل أطول من الحد المسموح (120 حرف).",
      ],
      [
        { message: "courier_order_no_too_long" },
        "رقم طلب الشركة أطول من الحد المسموح (80 حرف).",
      ],
      [{ message: "delivery_fee_invalid" }, "رسوم التوصيل غير صالحة."],
      [{ message: "delivery_order_exists" }, "يوجد طلب توصيل مسجَّل لهذا الحجز."],
      [{ message: "delivery_order_not_found" }, "طلب التوصيل غير موجود."],
      [
        { message: "delivery_requires_accepted_booking" },
        "التوصيل يُسجَّل بعد تأكيد الحجز فقط.",
      ],
      [{ message: "invalid_delivery_status" }, "اختر حالة التوصيل."],
      [
        { message: "delivery_order_closed" },
        "طلب التوصيل مغلق (سُلِّم أو فشل) — لا يمكن تعديله.",
      ],
      [{ message: "invalid_delivery_transition" }, "لا يُمكن هذا الانتقال بين حالات التوصيل."],
      [
        { message: "delivery_note_too_long" },
        "ملاحظة التوصيل أطول من الحد المسموح (500 حرف).",
      ],
      [{ message: "delivery_note_required" }, "اكتب سبب التأخير/الفشل (10 أحرف على الأقل)."],
      [{ message: "delivered_to_required" }, "سجّل اسم مستلم التسليم."],
    ];
    for (const [input, expected] of cases) {
      expect(toArabicError(input), JSON.stringify(input)).toBe(expected);
    }
  });

  it("keeps permission denied and non-participant covered (shared gates)", () => {
    expect(toArabicError({ message: "permission denied" })).toBe(
      "ليست لديك صلاحية تنفيذ هذا الإجراء.",
    );
    expect(toArabicError({ message: "not a participant" })).toBe(
      "أنت لست طرفًا في هذا الحجز.",
    );
    expect(toArabicError({ message: "not authenticated" })).toBe("سجّل الدخول أولاً.");
  });

  it("orders long-code checks before their short prefixes", () => {
    // provider_too_long must not be swallowed by provider_required, and
    // delivery_note_too_long must win over delivery_note_required.
    expect(toArabicError({ message: "provider_too_long" })).not.toBe(
      "أدخل اسم شركة التوصيل.",
    );
    expect(toArabicError({ message: "delivery_note_too_long" })).not.toBe(
      "اكتب سبب التأخير/الفشل (10 أحرف على الأقل).",
    );
  });
});
