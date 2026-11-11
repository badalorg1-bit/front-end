import { describe, expect, it } from "vitest";
import { normalizeCode } from "@/components/escrow-payment";

describe("normalizeCode (handover code input)", () => {
  it("converts Arabic-Indic and Persian digits to ASCII", () => {
    expect(normalizeCode("١٢٣")).toBe("123");
    expect(normalizeCode("۴۵")).toBe("45");
  });

  it("strips whitespace around and inside the code", () => {
    expect(normalizeCode(" 1 2 3 ")).toBe("123");
    expect(normalizeCode("١ ٢")).toBe("12");
  });

  it("leaves ASCII codes untouched", () => {
    expect(normalizeCode("A1B2")).toBe("A1B2");
  });
});
