import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  countLabel,
  diffDays,
  fmtDate,
  fmtEGP,
  fmtPoints,
  fmtPointsEgp,
  normalizeAr,
  toISO,
} from "@/lib/format";

describe("normalizeAr", () => {
  it("unifies alef variants, yaa and taa marbuta", () => {
    expect(normalizeAr("أحمد")).toBe("احمد");
    expect(normalizeAr("إسكندرية")).toBe("اسكندريه");
    expect(normalizeAr("آمنة")).toBe("امنه");
    expect(normalizeAr("مصطفى")).toBe("مصطفي");
  });

  it("trims, lowercases and collapses whitespace", () => {
    expect(normalizeAr("  كرسي مكتب  ")).toBe("كرسي مكتب");
    expect(normalizeAr("CHAIR")).toBe("chair");
  });
});

describe("date helpers", () => {
  it("diffDays counts whole days between two dates", () => {
    expect(diffDays("2026-01-01", "2026-01-01")).toBe(0);
    expect(diffDays("2026-01-01", "2026-01-02")).toBe(1);
    expect(diffDays("2026-01-01", "2026-02-01")).toBe(31);
  });

  it("addDaysISO rolls over month and year boundaries", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("toISO zero-pads month and day", () => {
    expect(toISO(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("fmtDate falls back to an em dash for junk input", () => {
    expect(fmtDate("not-a-date")).toBe("—");
  });
});

describe("labels and money", () => {
  it("countLabel picks the unit wording", () => {
    expect(countLabel("ساعة")).toBe("عدد الساعات");
    expect(countLabel("شهر")).toBe("عدد الأشهر");
    expect(countLabel("يوم")).toBe("عدد الأيام");
  });

  it("fmtPoints renders rounded integer points", () => {
    expect(fmtPoints(100)).toBe("100 نقطة");
    expect(fmtPoints(99.6)).toBe("100 نقطة");
  });

  it("fmtEGP prefixes the currency", () => {
    expect(fmtEGP(200)).toBe("ج.م 200");
  });

  it("fmtPointsEgp shows points first with the EGP equivalent", () => {
    expect(fmtPointsEgp(100, 0.5)).toBe("100 نقطة (≈ ج.م 50)");
  });
});
