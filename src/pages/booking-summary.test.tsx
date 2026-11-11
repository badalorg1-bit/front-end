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
  // 0032 · §4.9 — checked in parallel with the fee before the summary opens.
  checkListingAvailability: vi.fn(),
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
  delivery_available: false,
  delivery_fee: 0,
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
  mocks.checkListingAvailability.mockResolvedValue({
    available: true,
    reason: null,
    conflicts: [],
    windows: [],
    booked: [],
  });
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
    // §4.9: the server check runs in parallel before the summary opens.
    expect(mocks.checkListingAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.checkListingAvailability).toHaveBeenCalledWith(
      "l1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("rejects the booking when the server says the period is unavailable (0032)", async () => {
    mocks.checkListingAvailability.mockResolvedValue({
      available: false,
      reason: "conflict",
      conflicts: [{ starts_on: "2027-01-10", ends_on: "2027-01-12" }],
      windows: [],
      booked: [],
    });
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "مراجعة ملخص الحجز" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تتعارض الفترة مع حجز مؤكّد أو نزاع قائم");
    // The summary must NOT open, and nothing gets written.
    expect(screen.queryByText("ملخص الحجز — راجعه قبل الإرسال")).toBeNull();
    expect(mocks.createRequest).not.toHaveBeenCalled();
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

describe("A6 delivery in the booking flow (SRS §9.2 · 0033)", () => {
  const DELIVERABLE: ListingWithImages = {
    ...LISTING,
    delivery_available: true,
    delivery_fee: 25,
  };

  it("hides the delivery block when the listing does not offer delivery", async () => {
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    expect(screen.queryByText(/أريد توصيلًا لهذا الحجز/)).toBeNull();
    expect(screen.queryByLabelText("عنوان التسليم")).toBeNull();
  });

  it("shows the opt-in + address field only when the listing offers delivery", async () => {
    mocks.getListingById.mockResolvedValue(DELIVERABLE);
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    expect(screen.getByText(/أريد توصيلًا لهذا الحجز/)).toBeTruthy();
    // Address input stays hidden until the box is checked.
    expect(screen.queryByLabelText("عنوان التسليم")).toBeNull();

    fireEvent.click(screen.getByLabelText(/أريد توصيلًا لهذا الحجز/));
    expect(screen.getByLabelText("عنوان التسليم")).toBeTruthy();
  });

  it("requires an address before the summary opens when delivery is checked", async () => {
    mocks.getListingById.mockResolvedValue(DELIVERABLE);
    const { container } = renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/أريد توصيلًا لهذا الحجز/));
    // Submit the form directly: jsdom's native `required` guard on the empty
    // address input would otherwise swallow the button click.
    fireEvent.submit(container.querySelector("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "أدخل عنوان التسليم (5 أحرف على الأقل).",
    );
    expect(screen.queryByText("ملخص الحجز — راجعه قبل الإرسال")).toBeNull();
    expect(mocks.checkListingAvailability).not.toHaveBeenCalled();
  });

  it("prices the delivery row from the listing fee and submits the choice (0033)", async () => {
    mocks.getListingById.mockResolvedValue(DELIVERABLE);
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/أريد توصيلًا لهذا الحجز/));
    fireEvent.change(screen.getByLabelText("عنوان التسليم"), {
      target: { value: "القاهرة — مدينة نصر — شارع مصطفى النحاس 12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "مراجعة ملخص الحجز" }));
    expect(await screen.findByText("ملخص الحجز — راجعه قبل الإرسال")).toBeTruthy();

    // The row now carries the advertised fee + the address the tenant typed.
    expect(screen.getByText(/تُسدَّد لشركة التوصيل وفق اتفاق الطرفين/)).toBeTruthy();
    expect(
      screen.getByText("عنوان التسليم: القاهرة — مدينة نصر — شارع مصطفى النحاس 12"),
    ).toBeTruthy();
    expect(screen.queryByText("التوصيل غير مُفعّل حاليًا — الاستلام مباشر من المالك.")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال الطلب" }));
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledTimes(1));
    expect(mocks.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_requested: true,
        delivery_address: "القاهرة — مدينة نصر — شارع مصطفى النحاس 12",
      }),
    );
  });

  it("offers an available-but-not-requested delivery row without blocking checkout", async () => {
    mocks.getListingById.mockResolvedValue(DELIVERABLE);
    renderPage();
    expect(await screen.findByText("تاريخ البداية")).toBeTruthy();

    // No opt-in → summary still opens and the row reports the advertised fee.
    fireEvent.click(screen.getByRole("button", { name: "مراجعة ملخص الحجز" }));
    expect(await screen.findByText("ملخص الحجز — راجعه قبل الإرسال")).toBeTruthy();
    // The matcher hits both the leaf span and its SummaryRow wrapper.
    expect(
      screen.getAllByText(
        (_, el) =>
          el?.textContent === "التوصيل متاح (25 نقطة) ولم تطلبه — الاستلام مباشر من المالك.",
      ).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال الطلب" }));
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledTimes(1));
    expect(mocks.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_requested: false, delivery_address: null }),
    );
  });
});
