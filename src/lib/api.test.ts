import { describe, expect, it } from "vitest";
import { payableAmountFor, requestPayableAmount } from "@/lib/api";
import type { RequestWithListing } from "@/lib/types";

describe("payableAmountFor", () => {
  it("returns null without a price or a unit", () => {
    expect(payableAmountFor({ rental_price: null, rental_unit: "يوم", deposit: 0 }, "2026-01-01", "2026-01-02")).toBeNull();
    expect(payableAmountFor({ rental_price: 100, rental_unit: null, deposit: 0 }, null, null)).toBeNull();
  });

  it("charges the hourly price as announced", () => {
    expect(payableAmountFor({ rental_price: 25, rental_unit: "ساعة", deposit: 10 }, null, null)).toEqual({
      amount: 25,
      label: "السعر المعلن لكل ساعة",
      deposit: 10,
    });
  });

  it("multiplies the daily price by the inclusive day count", () => {
    const p = payableAmountFor({ rental_price: 100, rental_unit: "يوم", deposit: 50 }, "2026-05-01", "2026-05-03");
    expect(p?.amount).toBe(300);
    expect(p?.label).toBe("3 أيام × 100 نقطة");
    expect(p?.deposit).toBe(50);
  });

  it("defaults to one day when the rent window is missing", () => {
    const p = payableAmountFor({ rental_price: 100, rental_unit: "يوم", deposit: 0 }, null, null);
    expect(p?.amount).toBe(100);
    expect(p?.label).toBe("1 يوم × 100 نقطة");
  });

  it("rounds monthly rentals to whole months with a floor of one", () => {
    // 30 inclusive days → exactly 1 month.
    const oneMonth = payableAmountFor({ rental_price: 1000, rental_unit: "شهر", deposit: 0 }, "2026-05-01", "2026-05-30");
    expect(oneMonth?.amount).toBe(1000);
    expect(oneMonth?.label).toContain("1 شهر");
    // A 5-day window still bills one full month.
    const short = payableAmountFor({ rental_price: 1000, rental_unit: "شهر", deposit: 0 }, "2026-05-01", "2026-05-05");
    expect(short?.amount).toBe(1000);
    // 60 inclusive days → 2 months.
    const twoMonths = payableAmountFor({ rental_price: 1000, rental_unit: "شهر", deposit: 0 }, "2026-05-01", "2026-06-29");
    expect(twoMonths?.amount).toBe(2000);
    expect(twoMonths?.label).toContain("2 أشهر");
  });
});

describe("requestPayableAmount", () => {
  const base = {
    listing: { rental_price: 100, rental_unit: "يوم", deposit: 0 },
    rent_start: "2026-05-01",
    rent_end: "2026-05-02",
  };

  it("derives the figure from a rent request row", () => {
    const p = requestPayableAmount({ ...base, request_type: "rent" } as RequestWithListing);
    expect(p?.amount).toBe(200);
  });

  it("returns null for swap requests", () => {
    expect(requestPayableAmount({ ...base, request_type: "swap" } as RequestWithListing)).toBeNull();
  });
});
