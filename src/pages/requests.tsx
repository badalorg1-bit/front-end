import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Inbox,
  Loader2,
  MessageCircle,
  Package,
  Repeat,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import { RequestStatusPill } from "@/components/status";
import { EscrowPaymentSection } from "@/components/escrow-payment";
import { ReviewSection } from "@/components/review-section";
import { REQUEST_TYPE_LABEL, type RequestType } from "@/lib/types";
import {
  cancelRequest,
  completeRequest,
  createRequest,
  decideRequest,
  disputeRequest,
  getEscrowFeePercent,
  getListingById,
  getPointValueEgp,
  getRequestById,
  listIncomingRequests,
  listMySwapListings,
  listOutgoingRequests,
  payableAmountFor,
} from "@/lib/api";
import { addDaysISO, diffDays, fmtDate, fmtEGP, fmtPoints, fmtShortDate, todayISO } from "@/lib/format";
import { useAuth } from "@/store/auth";
import type { ListingWithImages, RequestWithListing } from "@/lib/types";

/** One row of the booking summary (SRS §4.10): label right, value left. */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-line px-3 py-2.5 text-sm last:border-b-0">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-w-0 flex-1 text-left text-ink">{children}</span>
    </div>
  );
}

/** New rent / swap request for a published listing. */
export function RequestNewPage() {
  const { id } = useParams<{ id: string }>();
  const { user, configured } = useAuth();
  const navigate = useNavigate();

  const [listing, setListing] = useState<ListingWithImages | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [swapListings, setSwapListings] = useState<ListingWithImages[]>([]);

  const [message, setMessage] = useState("");
  const [rentStart, setRentStart] = useState(todayISO());
  const [rentEnd, setRentEnd] = useState(addDaysISO(todayISO(), 1));
  const [offeredId, setOfferedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // A5: rent requests pass through an explicit booking-summary step first.
  const [step, setStep] = useState<"form" | "summary">("form");
  const [agreed, setAgreed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [summaryFee, setSummaryFee] = useState<number | null>(null);
  const [pointValue, setPointValue] = useState(0.5);

  useEffect(() => {
    if (!id || !configured) return;
    let cancelled = false;
    setLoading(true);
    getListingById(id)
      .then((l) => {
        if (!cancelled) {
          setListing(l);
          setLoadError(l ? null : "الإعلان غير موجود أو غير منشور.");
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "تعذر تحميل الإعلان.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, configured]);

  useEffect(() => {
    if (!user || listing?.listing_type !== "swap") return;
    listMySwapListings(user.id)
      .then(setSwapListings)
      .catch(() => setSwapListings([]));
  }, [user, listing?.listing_type]);

  const requestType: RequestType | null = useMemo(() => {
    if (!listing) return null;
    if (listing.listing_type === "rent") return "rent";
    return "swap";
  }, [listing]);

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="خادم قاعدة البيانات غير مهيأ"
          description="اضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في .env.local أولًا."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={ShieldCheck}
          title="سجّل الدخول لإرسال الطلب"
          description="تحتاج إلى حساب لإجراء طلب تأجير أو مقايضة."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (loadError || !listing || !requestType) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="تعذر فتح طلب جديد"
          description={loadError ?? "الإعلان غير متاح."}
          action={
            <Link to="/search">
              <Button>تصفح الإعلانات</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (listing.owner_id === user.id) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="لا يمكنك طلب إعلانك الخاص"
          description="هذا الإعلان منشور من حسابك."
          action={
            <Link to="/owner">
              <Button variant="outline">لوحة المالك</Button>
            </Link>
          }
        />
      </div>
    );
  }

  /** Same figure the escrow RPC will verify server-side (rent only). */
  const payable =
    requestType === "rent" && listing ? payableAmountFor(listing, rentStart, rentEnd) : null;
  const rentDays = diffDays(rentStart, rentEnd) + 1;
  const rentMonths = Math.max(1, Math.round(rentDays / 30));
  const feeAmount =
    payable && summaryFee != null ? Math.floor((payable.amount * summaryFee) / 100) : 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Rent, step 1 → validate the window and open the summary (A5).
    if (requestType === "rent" && step === "form") {
      if (rentStart < todayISO()) {
        setFormError("لا يمكن اختيار تاريخ في الماضي.");
        return;
      }
      if (rentEnd < rentStart) {
        setFormError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية.");
        return;
      }
      if (!payable) {
        setFormError("هذا الإعلان بلا سعر إيجار — لا يمكن إرسال طلب تأجير.");
        return;
      }
      setReviewing(true);
      try {
        const [fee, pv] = await Promise.all([getEscrowFeePercent(), getPointValueEgp()]);
        setSummaryFee(fee);
        setPointValue(pv);
        setAgreed(false);
        setStep("summary");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "تعذر تجهيز ملخص الحجز.");
      } finally {
        setReviewing(false);
      }
      return;
    }

    // Rent, step 2 → explicit consent is a hard gate (A5).
    if (requestType === "rent" && !agreed) {
      setFormError("يجب قراءة ملخص الحجز والموافقة عليه قبل إرسال الطلب.");
      return;
    }

    setSubmitting(true);
    try {
      if (requestType === "swap" && !offeredId) {
        throw new Error("اختر إعلانك الذي تريد مقايضته.");
      }
      const newId = await createRequest({
        listing_id: listing.id,
        requester_id: user.id,
        request_type: requestType,
        message: message || null,
        rent_start: requestType === "rent" ? rentStart : null,
        rent_end: requestType === "rent" ? rentEnd : null,
        offered_listing_id: requestType === "swap" ? offeredId : null,
      });
      navigate(`/requests/${newId}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر إرسال الطلب.");
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = requestType === "rent" ? CalendarDays : Repeat;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-10">
      <Link
        to={`/listing/${listing.id}`}
        className="mb-5 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted hover:text-success-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowRight className="size-4" />
        العودة إلى الإعلان
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-ink">
            <Icon className="size-5 text-success" />
            {REQUEST_TYPE_LABEL[requestType]} — {listing.title}
          </CardTitle>
          <CardDescription>
            المالك: {listing.owner_name ?? "—"} — {listing.city}
            {listing.district ? ` — ${listing.district}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {step === "summary" ? (
              payable ? (
                /* ── A5: booking summary (SRS §4.10) — eleven literal rows ── */
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-base font-bold text-ink">
                      <ClipboardList className="size-5 text-success" />
                      ملخص الحجز — راجعه قبل الإرسال
                    </p>
                    <p className="text-xs text-ink-muted">
                      الأسعار بالنقاط: 100 نقطة = {fmtEGP(100 * pointValue)} حسب قيمة الوجهة الحالية.
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-line bg-secondary/40">
                    <SummaryRow label="المنتج">
                      {listing.title} — {listing.city}
                      {listing.district ? ` — ${listing.district}` : ""}
                    </SummaryRow>
                    <SummaryRow label="مدة الإيجار">
                      {fmtDate(rentStart)} ← {fmtDate(rentEnd)}
                      {listing.rental_unit === "ساعة"
                        ? " · إيجار بالساعة"
                        : listing.rental_unit === "شهر"
                          ? ` · ${rentMonths} ${rentMonths === 1 ? "شهر" : "أشهر"} (${rentDays} يوم)`
                          : ` · ${rentDays} ${rentDays === 1 ? "يوم" : "أيام"}`}
                    </SummaryRow>
                    <SummaryRow label="قيمة الإيجار">
                      <span className="font-semibold tabular-nums">{fmtPoints(payable.amount)}</span>{" "}
                      <span className="text-xs text-ink-muted">
                        ≈ {fmtEGP(payable.amount * pointValue)}
                      </span>
                      <br />
                      <span className="text-xs text-ink-muted">{payable.label}</span>
                    </SummaryRow>
                    <SummaryRow label="رسوم الخدمة">
                      <span className="tabular-nums">
                        {summaryFee ?? "—"}% من قيمة الإيجار ={" "}
                        <span className="font-semibold">{fmtPoints(feeAmount)}</span>
                      </span>
                      <br />
                      <span className="text-xs text-ink-muted">
                        تُخصم من مستحقات المؤجر عند التحصيل، ولا تتغير بعد تأكيد الحجز.
                      </span>
                    </SummaryRow>
                    <SummaryRow label="تكلفة التوصيل">
                      <span className="text-ink-muted">
                        التوصيل غير مُفعّل حاليًا — الاستلام مباشر من المالك.
                      </span>
                    </SummaryRow>
                    <SummaryRow label="مبلغ التأمين القابل للاسترداد">
                      {listing.deposit > 0 ? (
                        <>
                          <span className="font-semibold tabular-nums">
                            {fmtPoints(listing.deposit)}
                          </span>{" "}
                          <span className="text-xs text-ink-muted">
                            — معلن في الإعلان وغير مُحصَّل حاليًا (لا يُخصم مع الحجز).
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-muted">لا يوجد تأمين معلن على هذا الإعلان.</span>
                      )}
                    </SummaryRow>
                    <SummaryRow label="أي رسوم إضافية معتمدة">
                      <span className="text-ink-muted">لا توجد رسوم إضافية معتمدة.</span>
                    </SummaryRow>
                    <SummaryRow label="إجمالي المبلغ المطلوب دفعه الآن">
                      <span className="text-base font-bold tabular-nums text-brand-deep">
                        {fmtPoints(payable.amount)}
                      </span>
                      <br />
                      <span className="text-xs text-ink-muted">
                        يُخصم من رصيد نقاطك ويُحجز لدى بينا لحظة تأكيد الحجز — لا يُحوَّل للمالك قبل
                        التسليم.
                      </span>
                    </SummaryRow>
                    <SummaryRow label="المبالغ التي قد تُرد لاحقًا">
                      <span className="text-ink-muted">
                        يُعاد المبلغ المحجوز كاملًا إلى رصيد نقاطك إذا ألغى المالك الحجز قبل التسليم أو
                        لم يُسلَّم المنتج (وعبر الإدارة عند النزاع).
                      </span>
                    </SummaryRow>
                    <SummaryRow label="سياسة الإلغاء">
                      <span className="text-ink-muted">
                        إلغاء مجاني من طرفك ما دام الطلب في حالة «قيد الانتظار» فقط — بعد قبول المالك
                        لا يمكن الإلغاء من التطبيق.
                      </span>
                    </SummaryRow>
                    <SummaryRow label="شروط الحجز">
                      <span className="text-ink-muted">
                        التسليم برمزي تسلسل بين الطرفين · تُخصم الكمية لحظة الدفع · لا يُعدّل السعر أو
                        المدة بعد تأكيد الحجز · تُحفظ تفاصيل السعر وقت الحجز.
                      </span>
                    </SummaryRow>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-background p-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-success"
                    />
                    <span>
                      قرأت ملخص الحجز وأوافق على بنوده وأسعاره قبل إرسال الطلب.
                    </span>
                  </label>
                </div>
              ) : null
            ) : (
              <>
            {requestType === "rent" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rs">تاريخ البداية</Label>
                  <Input
                    id="rs"
                    type="date"
                    value={rentStart}
                    min={todayISO()}
                    onChange={(e) => setRentStart(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="re">تاريخ النهاية</Label>
                  <Input
                    id="re"
                    type="date"
                    value={rentEnd}
                    min={rentStart}
                    onChange={(e) => setRentEnd(e.target.value)}
                    required
                  />
                </div>
                {listing.rental_price != null && listing.rental_unit && (
                  <p className="sm:col-span-2 rounded-lg bg-secondary p-3 text-sm text-ink-muted">
                    السعر المعلن:{" "}
                    <span className="font-semibold text-ink">
                      {listing.rental_price} نقطة / {listing.rental_unit}
                    </span>
                    {listing.deposit > 0 && (
                      <>
                        {" "}
                        — تأمين معلن:{" "}
                        <span className="font-semibold text-gold-deep">
                          {listing.deposit} نقطة
                        </span>{" "}
                        (لا يُخصم حاليًا)
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {requestType === "swap" && (
              <div className="space-y-1.5">
                <Label htmlFor="offer">إعلانك المقترح للمقايضة</Label>
                {swapListings.length === 0 ? (
                  <p className="rounded-lg border border-warn-line bg-warn-soft p-3 text-sm text-gold-deep">
                    لا توجد إعلانات مقايضة منشورة من حسابك. أنشئ إعلان مقايضة أولًا من لوحة
                    المالك.
                  </p>
                ) : (
                  <select
                    id="offer"
                    value={offeredId}
                    onChange={(e) => setOfferedId(e.target.value)}
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">اختر إعلانًا…</option>
                    {swapListings.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} — {s.city}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="msg">رسالة للمالك (اختياري)</Label>
              <Textarea
                id="msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="اشرح سبب الطلب أو تفاصيل المقايضة…"
                maxLength={2000}
                rows={3}
              />
            </div>
              </>
            )}

            {formError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {formError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitting || reviewing}>
                {(submitting || reviewing) && <Loader2 className="size-4 animate-spin" />}
                {step === "summary"
                  ? "تأكيد وإرسال الطلب"
                  : requestType === "rent"
                    ? "مراجعة ملخص الحجز"
                    : "إرسال الطلب"}
              </Button>
              {step === "summary" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFormError(null);
                    setStep("form");
                  }}
                >
                  رجوع للتعديل
                </Button>
              ) : (
                <Link to={`/listing/${listing.id}`}>
                  <Button type="button" variant="outline">
                    إلغاء
                  </Button>
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** Single request view — shows payment QR inline once the owner accepts. */
export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, configured } = useAuth();
  const navigate = useNavigate();

  const [request, setRequest] = useState<RequestWithListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id || !configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    getRequestById(id)
      .then((r) => {
        if (cancelled) return;
        setRequest(r);
        setError(r ? null : "الطلب غير موجود.");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل الطلب.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, configured]);

  useEffect(load, [load]);

  const side: "payer" | "payee" | null = !request || !user
    ? null
    : user.id === request.requester_id
      ? "payer"
      : user.id === request.owner_id
        ? "payee"
        : null;

  const onCancel = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await cancelRequest(request.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إلغاء الطلب.");
    } finally {
      setBusy(false);
    }
  };

  const onDecide = async (decision: "accepted" | "rejected") => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await decideRequest(request.id, decision);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(false);
    }
  };

  const onSetStatus = async (status: "completed" | "disputed") => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      if (status === "completed") await completeRequest(request.id);
      else await disputeRequest(request.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث حالة الطلب.");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="خادم قاعدة البيانات غير مهيأ" description="راجع .env.local." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول لعرض الطلب"
          description="تحتاج إلى حساب لعرض تفاصيل الطلب والدفع."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="الطلب غير موجود"
          description={error ?? "ربما تم حذفه أو إلغاؤه."}
          action={
            <Link to="/requests">
              <Button>طلباتي</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const listing = request.listing;
  const canPay = request.status === "accepted" && request.request_type !== "swap" && side === "payer";

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-10">
      <Link
        to="/requests"
        className="mb-5 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted hover:text-success-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowRight className="size-4" />
        طلباتي
      </Link>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-ink">
                <Package className="size-5 text-success" />
                {listing?.title ?? "إعلان"}
              </CardTitle>
              <CardDescription className="mt-1">
                {REQUEST_TYPE_LABEL[request.request_type]} — {request.owner_name ?? "المالك"}
                {listing?.city ? ` — ${listing.city}` : ""}
              </CardDescription>
            </div>
            <RequestStatusPill status={request.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {request.request_type === "rent" && request.rent_start && request.rent_end && (
            <p className="text-sm text-ink-muted">
              الفترة: {fmtDate(request.rent_start)} — {fmtDate(request.rent_end)}
            </p>
          )}
          {request.request_type === "swap" && request.offered_title && (
            <p className="text-sm text-ink-muted">المقترح: {request.offered_title}</p>
          )}
          {request.message && (
            <p className="rounded-lg bg-secondary p-3 text-sm leading-6 text-ink-muted">
              {request.message}
            </p>
          )}

          {request.status === "pending" && side === "payer" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={busy}
                onClick={onCancel}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                إلغاء الطلب
              </Button>
              {listing && (
                <Link to={`/listing/${listing.id}`}>
                  <Button variant="ghost">فتح الإعلان</Button>
                </Link>
              )}
            </div>
          )}

          {request.status === "pending" && side === "payee" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="success" disabled={busy} onClick={() => onDecide("accepted")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                قبول الطلب
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={busy}
                onClick={() => onDecide("rejected")}
              >
                رفض
              </Button>
            </div>
          )}

          {request.status === "accepted" && request.request_type !== "swap" && side && (
            <EscrowPaymentSection request={request} side={side} onChanged={load} />
          )}

          {(request.status === "accepted" ||
            request.status === "completed" ||
            request.status === "disputed") &&
            side && (
              <Link
                to={`/messages/start?with=${
                  side === "payer" ? request.owner_id : request.requester_id
                }&listing=${request.listing_id}`}
                className="block"
              >
                <Button variant="outline" className="w-full">
                  <MessageCircle className="size-4" />
                  مراسلة {side === "payer" ? "المالك" : "المستأجر"}
                </Button>
              </Link>
            )}

          {request.status === "accepted" && side === "payer" && (
            <p className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft p-3 text-sm font-semibold text-success-ink">
              <CheckCircle2 className="size-4" />
              {canPay
                ? "تم قبول الطلب — ادفع الآن عبر بوابة بينا بالأسفل، المبلغ محجوز حتى إتمام الصفقة."
                : "تم قبول الطلب — يمكنك التقييم أدناه."}
            </p>
          )}

          {request.status === "accepted" && (
            <ReviewSection
              request={request}
              revieweeId={side === "payer" ? request.owner_id : request.requester_id}
              onChanged={load}
            />
          )}

          {request.status === "accepted" && side && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button
                variant="success"
                disabled={busy}
                onClick={() => void onSetStatus("completed")}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                تم الاستلام / إتمام الصفقة
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={busy}
                onClick={() => void onSetStatus("disputed")}
              >
                <AlertTriangle className="size-4" />
                الإبلاغ عن مشكلة
              </Button>
            </div>
          )}

          {request.status === "completed" && (
            <p className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft p-3 text-sm font-semibold text-success-ink">
              <CheckCircle2 className="size-4" />
              اكتملت الصفقة. يمكنك الآن ترك تقييم للطرف الآخر.
            </p>
          )}

          {request.status === "disputed" && (
            <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              تم فتح نزاع. ستراجعه الإدارة وستصلك النتيجة.
            </p>
          )}

          {request.status === "completed" && (
            <ReviewSection
              request={request}
              revieweeId={side === "payer" ? request.owner_id : request.requester_id}
              onChanged={load}
            />
          )}

          {listing && (
            <Button
              variant="ghost"
              className="text-success-ink"
              onClick={() => navigate(`/listing/${listing.id}`)}
            >
              فتح الإعلان
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** My requests: outgoing (sent) + incoming (received) in one page. */
export function RequestsPage() {
  const { user, configured } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "incoming" ? "incoming" : "outgoing";

  const [outgoing, setOutgoing] = useState<RequestWithListing[]>([]);
  const [incoming, setIncoming] = useState<RequestWithListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user || !configured) {
      setOutgoing([]);
      setIncoming([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    Promise.all([listOutgoingRequests(user.id), listIncomingRequests(user.id)])
      .then(([o, i]) => {
        if (cancelled) return;
        setOutgoing(o);
        setIncoming(i);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل الطلبات.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, configured]);

  useEffect(load, [load]);

  const onCancel = async (id: string) => {
    setBusyId(id);
    try {
      await cancelRequest(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إلغاء الطلب.");
    } finally {
      setBusyId(null);
    }
  };

  const onDecide = async (id: string, decision: "accepted" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      await decideRequest(id, decision);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث الطلب.");
    } finally {
      setBusyId(null);
    }
  };

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === "outgoing") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="خادم قاعدة البيانات غير مهيأ" description="راجع .env.local." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول لعرض طلباتك"
          description="تحتاج إلى حساب لعرض الطلبات التي أرسلتها أو وردت عليك."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const renderOutgoing = () => {
    if (outgoing.length === 0) {
      return (
        <EmptyState
          icon={Send}
          title="لم ترسل طلبات بعد"
          description="تصفح الإعلانات وأرسل طلب تأجير أو مقايضة."
          action={
            <Link to="/search">
              <Button>تصفح الإعلانات</Button>
            </Link>
          }
        />
      );
    }
    return (
      <ul className="space-y-3">
        {outgoing.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-card p-4 shadow-l1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:text-success-ink">
                  {r.listing?.title ?? "إعلان"}
                </Link>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {REQUEST_TYPE_LABEL[r.request_type]} — {fmtShortDate(r.created_at)}
                </p>
                {r.request_type === "rent" && r.rent_start && r.rent_end && (
                  <p className="mt-1 text-sm text-ink-muted">
                    من {fmtDate(r.rent_start)} إلى {fmtDate(r.rent_end)}
                  </p>
                )}
                {r.request_type === "swap" && r.offered_title && (
                  <p className="mt-1 text-sm text-ink-muted">المقترح: {r.offered_title}</p>
                )}
                {r.message && (
                  <p className="mt-2 rounded-lg bg-secondary p-2.5 text-sm leading-6 text-ink-muted">
                    {r.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <RequestStatusPill status={r.status} />
                {r.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    disabled={busyId === r.id}
                    onClick={() => onCancel(r.id)}
                  >
                    {busyId === r.id ? <Loader2 className="size-4 animate-spin" /> : null}
                    إلغاء
                  </Button>
                )}
                <Link
                  to={`/requests/${r.id}`}
                  className="text-sm text-success-ink hover:text-success-hover"
                >
                  {r.status === "accepted" && r.request_type !== "swap" ? "ادفع الآن" : "فتح الطلب"}
                </Link>
              </div>
            </div>
            {r.status === "accepted" && r.request_type !== "swap" && (
              <EscrowPaymentSection request={r} side="payer" onChanged={load} />
            )}
            {r.status === "accepted" && (
              <ReviewSection request={r} revieweeId={r.owner_id} onChanged={load} />
            )}
          </li>
        ))}
      </ul>
    );
  };

  const renderIncoming = () => {
    if (incoming.length === 0) {
      return (
        <EmptyState
          icon={Inbox}
          title="لا توجد طلبات واردة"
          description="عندما يرسل مستخدمون طلبات على إعلاناتك ستظهر هنا."
        />
      );
    }
    return (
      <ul className="space-y-3">
        {incoming.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-card p-4 shadow-l1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:text-success-ink">
                  {r.listing?.title ?? "إعلان"}
                </Link>
                <p className="mt-0.5 text-sm text-ink-muted">
                  من {r.requester_name ?? "مستخدم"} — {REQUEST_TYPE_LABEL[r.request_type]}
                </p>
                {r.request_type === "rent" && r.rent_start && r.rent_end && (
                  <p className="mt-1 text-sm text-ink-muted">
                    الفترة: {fmtDate(r.rent_start)} — {fmtDate(r.rent_end)}
                  </p>
                )}
                {r.request_type === "swap" && r.offered_title && (
                  <p className="mt-1 text-sm text-ink-muted">يعرض: {r.offered_title}</p>
                )}
                {r.message && (
                  <p className="mt-2 rounded-lg bg-secondary p-2.5 text-sm leading-6 text-ink-muted">
                    {r.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <RequestStatusPill status={r.status} />
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={busyId === r.id}
                      onClick={() => onDecide(r.id, "accepted")}
                    >
                      {busyId === r.id ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      قبول
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={busyId === r.id}
                      onClick={() => onDecide(r.id, "rejected")}
                    >
                      رفض
                    </Button>
                  </div>
                )}
                <Link
                  to={`/requests/${r.id}`}
                  className="text-sm text-success-ink hover:text-success-hover"
                >
                  فتح الطلب
                </Link>
              </div>
            </div>
            {r.status === "accepted" && r.request_type !== "swap" && (
              <EscrowPaymentSection request={r} side="payee" onChanged={load} />
            )}
            {r.status === "accepted" && (
              <ReviewSection request={r} revieweeId={r.requester_id} onChanged={load} />
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-6 py-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink md:text-[28px]">طلباتي</h1>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="outgoing">
              <Send className="size-4" />
              طلباتي ({outgoing.length})
            </TabsTrigger>
            <TabsTrigger value="incoming">
              <Inbox className="size-4" />
              واردة ({incoming.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="outgoing" className="mt-5">
            {renderOutgoing()}
          </TabsContent>
          <TabsContent value="incoming" className="mt-5">
            {renderIncoming()}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** Incoming requests with accept/reject (owner view). */
export function IncomingRequestsPage() {
  const { user, configured } = useAuth();
  const [items, setItems] = useState<RequestWithListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user || !configured) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    listIncomingRequests(user.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل الطلبات.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, configured]);

  useEffect(load, [load]);

  const onDecide = async (id: string, decision: "accepted" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      await decideRequest(id, decision);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث الطلب.");
    } finally {
      setBusyId(null);
    }
  };

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="خادم قاعدة البيانات غير مهيأ" description="راجع .env.local." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول"
          description="تحتاج إلى حساب لعرض الطلبات الواردة على إعلاناتك."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-6 py-10">
      <h1 className="mb-6 text-[22px] font-semibold text-ink md:text-[28px]">الطلبات الواردة</h1>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="لا توجد طلبات واردة"
          description="عندما يرسل مستخدمون طلبات على إعلاناتك ستظهر هنا."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-card p-4 shadow-l1">
              <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:text-success-ink">
                  {r.listing?.title ?? "إعلان"}
                </Link>
                <p className="mt-0.5 text-sm text-ink-muted">
                  من {r.requester_name ?? "مستخدم"} — {REQUEST_TYPE_LABEL[r.request_type]}
                </p>
                {r.request_type === "rent" && r.rent_start && r.rent_end && (
                  <p className="mt-1 text-sm text-ink-muted">
                    الفترة: {fmtDate(r.rent_start)} — {fmtDate(r.rent_end)}
                  </p>
                )}
                {r.request_type === "swap" && r.offered_title && (
                  <p className="mt-1 text-sm text-ink-muted">يعرض: {r.offered_title}</p>
                )}
                {r.message && (
                  <p className="mt-2 rounded-lg bg-secondary p-2.5 text-sm leading-6 text-ink-muted">
                    {r.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <RequestStatusPill status={r.status} />
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={busyId === r.id}
                      onClick={() => onDecide(r.id, "accepted")}
                    >
                      {busyId === r.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      قبول
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={busyId === r.id}
                      onClick={() => onDecide(r.id, "rejected")}
                    >
                      رفض
                    </Button>
                  </div>
                )}
                <Link
                  to={`/requests/${r.id}`}
                  className="text-sm text-success-ink hover:text-success-hover"
                >
                  فتح الطلب
                </Link>
              </div>
              </div>
              {r.status === "accepted" && r.request_type !== "swap" && (
                <EscrowPaymentSection request={r} side="payee" onChanged={load} />
              )}
              {r.status === "accepted" && (
                <ReviewSection request={r} revieweeId={r.requester_id} onChanged={load} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
