// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequestNewPage } from "@/pages/requests";
import type { ListingWithImages } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getListingById: vi.fn(),
  listMySwapListings: vi.fn(),
  getEscrowFeePercent: vi.fn(),
  getPointValueEgp: vi.fn(),
  createRequest: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ...mocks };
});

vi.mock("@/store/auth", () => ({
  useAuth: () => ({ configured: true, user: { id: "user-tenant" } }),
}));

const LISTING: ListingWithImages = {
  id: "l1",
  owner_id: "user-owner",
  title: "كرسي مكتب",
  description: "كرسي بحالة جيدة",
  listing_type: "rent",
  category: "أثاث",
  city: "القاهرة",
  district: "مدينة نصر",
  condition: "جيد",
  status: "published",
  rental_price: 100,
  rental_unit: "يوم",
  swap_preferences: null,
  quantity: 1,
  deposit: 50,
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-01T00:00:00+00:00",
  images: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/request/l1"]}>
      <Routes>
        <Route path="/request/:id" element={<RequestNewPage />} />
        <Route path="/requests/:id" element={<p>detail</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getListingById.mockResolvedValue(LISTING);
  mocks.listMySwapListings.mockResolvedValue([]);
  mocks.getEscrowFeePercent.mockResolvedValue(5);
  mocks.getPointValueEgp.mockResolvedValue(0.5);
  mocks.createRequest.mockResolvedValue("req-1");
});

// RTL's auto-cleanup only registers when the framework exposes a global
// `afterEach`; this project runs vitest without globals.
afterEach(cleanup);

describe("A5 booking summary (SRS §4.10)", () => {
  const ROW_LABELS = [
    "المنتج",
    "مدة الإيجار",
    "قيمة الإيجار",
    "رسوم الخدمة",
    "تكلفة التوصيل",
    "مبلغ التأمين القابل للاسترداد",
    "أي رسوم إضافية معتمدة",
    "إجمالي المبلغ المطلوب دفعه الآن",
    "المبالغ التي قد تُرد لاحقًا",
    "سياسة الإلغاء",
    "شروط الحجز",
  ];

  it("shows all eleven literal rows with the computed figures", async () => {
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "مراجعة ملخص الحجز" }));
    expect(await screen.findByText("ملخص الحجز — راجعه قبل الإرسال")).toBeTruthy();

    for (const label of ROW_LABELS) {
      expect(screen.getByText(label), `missing row: ${label}`).toBeTruthy();
    }
    expect(ROW_LABELS).toHaveLength(11);

    // 2 inclusive days × 100 points, service fee 5% = 10 points, deposit 50.
    expect(screen.getByText("2 أيام × 100 نقطة")).toBeTruthy();
    expect(screen.getByText("10 نقطة")).toBeTruthy();
    expect(screen.getByText("50 نقطة")).toBeTruthy();
    expect(screen.getByText("التوصيل غير مُفعّل حاليًا — الاستلام مباشر من المالك.")).toBeTruthy();
    expect(mocks.getEscrowFeePercent).toHaveBeenCalledTimes(1);
    expect(mocks.getPointValueEgp).toHaveBeenCalledTimes(1);
  });

  it("blocks submission until the summary consent box is checked", async () => {
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "مراجعة ملخص الحجز" }));
    expect(await screen.findByText("ملخص الحجز — راجعه قبل الإرسال")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال الطلب" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "يجب قراءة ملخص الحجز والموافقة عليه قبل إرسال الطلب.",
    );
    expect(mocks.createRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال الطلب" }));
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledTimes(1));
    expect(mocks.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ listing_id: "l1", request_type: "rent" }),
    );
  });

  it("rejects an end date earlier than the start date", async () => {
    const { container } = renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("تاريخ البداية"), { target: { value: "2027-01-10" } });
    fireEvent.change(screen.getByLabelText("تاريخ النهاية"), { target: { value: "2027-01-05" } });
    // Submit directly: the browser's native `min` guard would otherwise stop
    // the click before the app-level validation runs.
    fireEvent.submit(container.querySelector("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.",
    );
    expect(mocks.getEscrowFeePercent).not.toHaveBeenCalled();
  });
});
