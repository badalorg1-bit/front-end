import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  KeyRound,
  Landmark,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  escrowPayExternal,
  escrowRefund,
  escrowRelease,
  getEscrowFeePercent,
  getEscrowForRequest,
  getHandoverCodes,
  getHandoverPhotoUrl,
  getPointValueEgp,
  getWalletBalance,
  requestPayableAmount,
  uploadHandoverPhoto,
  verifyHandoverCode,
} from "@/lib/api";
import { fmtEGP, fmtPoints, fmtPointsEgp, fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";
import type {
  EscrowHold,
  HandoverCodeRow,
  HandoverPurpose,
  RequestWithListing,
} from "@/lib/types";

interface Props {
  request: RequestWithListing;
  /** payer = the tenant (requester) · payee = the owner. */
  side: "payer" | "payee";
  onChanged: () => void;
}

const MAX_PHOTOS = 6;
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

/** ASCII-normalize what the user typed (the server does the same). */
export function normalizeCode(raw: string): string {
  return raw
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .replace(/\s+/g, "");
}

/**
 * Bayna payment gateway (0029): the booking is paid from the POINTS wallet —
 * deduct → escrow 'held' → handover codes (0028) → release with % fee.
 * QR / Instagram transfers now exist only one level earlier, at top-up.
 */
export function EscrowPaymentSection({ request, side, onChanged }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const payable = requestPayableAmount(request);

  const [hold, setHold] = useState<EscrowHold | null>(null);
  const [balance, setBalance] = useState(0);
  const [pointValue, setPointValue] = useState(0.5);
  const [feePercent, setFeePercent] = useState(5);
  const [codes, setCodes] = useState<HandoverCodeRow[]>([]);
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // A2 verification form — for the code this caller does NOT get to read.
  const [codeInput, setCodeInput] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<{ key: string; paths: string[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, bal, pv, fee, cs] = await Promise.all([
        getEscrowForRequest(request.id),
        getWalletBalance(),
        getPointValueEgp(),
        getEscrowFeePercent(),
        // Not a participant (e.g. a moderator without the RPC grant path) →
        // keep the last state instead of failing the whole section.
        getHandoverCodes(request.id).catch(() => [] as HandoverCodeRow[]),
      ]);
      setHold(h);
      setBalance(bal);
      setPointValue(pv);
      setFeePercent(fee);
      setCodes(cs);

      // Condition evidence lives in a PRIVATE bucket → resolve signed URLs.
      const withPhotos = cs.filter((c) => c.used_at && c.photos.length > 0);
      if (withPhotos.length > 0) {
        const map: Record<string, string[]> = {};
        await Promise.all(
          withPhotos.map(async (c) => {
            map[c.purpose] = await Promise.all(
              c.photos.map((p) => getHandoverPhotoUrl(p).catch(() => "")),
            );
          }),
        );
        setEvidence(map);
      }
    } catch {
      /* keep last state */
    } finally {
      setLoading(false);
    }
  }, [request.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Object-URL previews for locally picked photos (revoked on change/unmount).
  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  const feeAmount = payable ? Math.floor((payable.amount * feePercent) / 100) : 0;
  const netAmount = payable ? payable.amount - feeAmount : 0;

  // The tenant reads/keeps the RETURN code and types the DELIVERY code;
  // the owner is the mirror image (0028 enforces the same mapping).
  const myPurpose: HandoverPurpose = side === "payer" ? "return" : "delivery";
  const verifyPurpose: HandoverPurpose = side === "payer" ? "delivery" : "return";
  const myCodeRow = codes.find((c) => c.purpose === myPurpose) ?? null;
  const verifyRow = codes.find((c) => c.purpose === verifyPurpose) ?? null;
  const deliveryVerified = codes.find((c) => c.purpose === "delivery")?.used_at != null;
  const returnVerified = codes.find((c) => c.purpose === "return")?.used_at != null;

  const onPay = async () => {
    if (!payable) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await escrowPayExternal(request.id, payable.amount);
      setDone(
        `تم خصم ${fmtPoints(payable.amount)} من رصيدك وحجزها لدى بينا — بانتظار تسليم المالك.`,
      );
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام الدفع.");
    } finally {
      setBusy(false);
    }
  };

  const onRelease = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await escrowRelease(request.id);
      setDone("تم تحويل المبلغ إلى محفظة نقاطك بعد خصم عمولة بينا.");
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحويل المبلغ.");
    } finally {
      setBusy(false);
    }
  };

  const onRefund = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await escrowRefund(request.id);
      setDone("تمت إعادة المبلغ المحجوز إلى رصيد نقاط المستأجر.");
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إعادة المبلغ.");
    } finally {
      setBusy(false);
    }
  };

  const onPickPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setVerifyError(null);
    setUploaded(null);
    setPhotos((prev) => [...prev, ...files].slice(0, MAX_PHOTOS));
  };

  const dropPhoto = (index: number) => {
    setUploaded(null);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    if (!user || !verifyRow) return;

    const code = normalizeCode(codeInput);
    if (!/^\d{6}$/.test(code)) {
      setVerifyError("أدخل الرمز المكوّن من 6 أرقام كما سمعته من الطرف الآخر.");
      return;
    }
    if (!note.trim()) {
      setVerifyError("أدخل ملاحظة عن حالة المنتج.");
      return;
    }
    if (photos.length < 1) {
      setVerifyError("أرفق صورة واحدة على الأقل لحالة المنتج.");
      return;
    }

    setVerifying(true);
    try {
      // Upload once per selection: a wrong code must not re-upload on retry.
      const key = photos.map((f) => `${f.name}:${f.size}`).join("|");
      let paths: string[];
      if (uploaded && uploaded.key === key) {
        paths = uploaded.paths;
      } else {
        paths = [];
        for (const f of photos) {
          paths.push(await uploadHandoverPhoto(request.id, verifyPurpose, user.id, f));
        }
        setUploaded({ key, paths });
      }

      const res = await verifyHandoverCode({
        requestId: request.id,
        purpose: verifyPurpose,
        code,
        note: note.trim(),
        photos: paths,
      });
      if (!res.ok) {
        setVerifyError(
          res.error === "code_mismatch"
            ? `الرمز غير صحيح — محاولات متبقية: ${res.attempts_remaining ?? 0}`
            : "تعذر تأكيد الرمز.",
        );
        return;
      }
      setCodeInput("");
      setNote("");
      setPhotos([]);
      setUploaded(null);
      await refresh();
      onChanged();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "تعذر تأكيد الرمز.");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-secondary/50 p-3.5 text-sm text-ink-muted">
        <Loader2 className="inline size-4 animate-spin" /> جارٍ تحميل بوابة الدفع…
      </div>
    );
  }

  const chip = (ok: boolean, label: string) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        ok
          ? "border-success/30 bg-success-soft text-success-ink"
          : "border-warn-line bg-warn-soft text-gold-deep"
      }`}
    >
      {ok && <CheckCircle2 className="size-3.5" />}
      {label}: {ok ? "مُؤكَّد" : "بانتظار الطرف الآخر"}
    </span>
  );

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-secondary/60 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Landmark className="size-4 text-success" />
        بوابة دفع بينا — بالنقاط
      </p>

      <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        يُخصم مبلغ الإيجار من رصيد نقاطك ويُحجز لدى بينا حتى التسليم. عمولة الخدمة{" "}
        <span className="font-bold">{feePercent}%</span> تُخصم من مستحقات المؤجر عند التحصيل ولا تتغير
        بعد تأكيد الحجز. النقاط داخل المنصة فقط ولا تُسحب نقدًا.
      </p>

      {payable && (
        <div className="grid gap-2 rounded-md border border-line bg-card p-3 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>المبلغ الإجمالي ({payable.label})</span>
            <span className="font-bold tabular-nums text-brand-deep">
              {fmtPoints(payable.amount)}
            </span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>عمولة خدمة بينا ({feePercent}%) — من مستحقات المؤجر</span>
            <span className="tabular-nums text-gold-deep">{fmtPoints(feeAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <span>يصل للمالك</span>
            <span className="tabular-nums text-success-ink">{fmtPoints(netAmount)}</span>
          </div>
        </div>
      )}

      {hold?.status === "pending_confirmation" && (
        <div className="space-y-2 rounded-md border border-warn-line bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-gold-deep">
            بانتظار اعتماد الإدارة — {fmtPoints(hold.amount)}
          </p>
          <p className="text-xs leading-5 text-ink-muted">
            مسار قديم: سجّلنا تأكيد دفعتك وتراجع الإدارة التحويل. بعد الاعتماد يظهر المبلغ كمحجوز
            حتى التسليم.
          </p>
        </div>
      )}

      {hold?.status === "held" && (
        <div className="space-y-3 rounded-md border border-line bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-ink">
              المبلغ محجوز لدى بينا منذ {fmtShortDate(hold.held_at)}
            </p>
            <span className="rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-ink">
              مدفوع بالنقاط
            </span>
          </div>
          <p className="text-ink-muted">
            المحجوز:{" "}
            <span className="font-semibold tabular-nums">
              {fmtPointsEgp(hold.amount, pointValue)}
            </span>{" "}
            — يصل للمالك{" "}
            <span className="font-semibold tabular-nums">{fmtPoints(hold.net_amount)}</span> بعد
            تأكيد الإرجاع وتوثيق الحالة.
          </p>

          <div className="flex flex-wrap gap-2">
            {chip(deliveryVerified, "الاستلام")}
            {chip(returnVerified, "الإرجاع")}
          </div>

          {/* ── My own code (0028): read it aloud, never type it in chat ── */}
          {myCodeRow?.code && !myCodeRow.used_at && (
            <div className="rounded-md border border-brand-line bg-brand-soft/40 p-3 text-center">
              <p className="text-xs text-ink-muted">
                {myPurpose === "return"
                  ? "كود الإرجاع — تقرأه للمالك شفهيًا عند إعادة المنتج"
                  : "كود الاستلام — تقرأه للمستأجر شفهيًا عند التسليم"}
              </p>
              <p
                className="mt-1.5 text-3xl font-bold tracking-[0.3em] text-brand-deep"
                dir="ltr"
              >
                {myCodeRow.code}
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">
                صالح حتى {fmtShortDate(myCodeRow.valid_until)} — لا ترسله في المحادثات.
                {myCodeRow.is_expired && (
                  <span className="font-semibold text-destructive"> (منتهي الصلاحية)</span>
                )}
                {myCodeRow.is_locked && (
                  <span className="font-semibold text-destructive"> (مغلق بعد محاولات خاطئة)</span>
                )}
              </p>
            </div>
          )}
          {myCodeRow?.used_at && (
            <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-xs font-semibold text-success-ink">
              <CheckCircle2 className="size-4" />
              تم استخدام كود {myPurpose === "return" ? "الإرجاع" : "الاستلام"} وتوثيق الحالة.
            </p>
          )}

          {/* ── Verify the other party's code + record the condition (A2) ── */}
          {verifyRow && !verifyRow.used_at && (
            <form onSubmit={onVerify} className="space-y-3 rounded-md border border-line bg-secondary/40 p-3">
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <KeyRound className="size-4 text-success" />
                  {verifyPurpose === "delivery"
                    ? "تأكيد استلام المنتج"
                    : "تأكيد إرجاع المنتج"}
                </p>
                <p className="text-xs leading-5 text-ink-muted">
                  {verifyPurpose === "delivery"
                    ? "المالك يقرأ لك كود الاستلام شفهيًا — أدخله هنا مع ملاحظة وصور حالة المنتج."
                    : "المستأجر يقرأ لك كود الإرجاع شفهيًا — أدخله هنا مع ملاحظة وصور حالة المنتج."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="handover-code">رمز التأكيد (6 أرقام)</Label>
                <Input
                  id="handover-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                  placeholder="······"
                  className="text-center text-lg tracking-[0.4em]"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setVerifyError(null);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="handover-note">ملاحظة حالة المنتج *</Label>
                <Textarea
                  id="handover-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="وصف حالة المنتج عند التسليم أو الإرجاع…"
                  maxLength={1000}
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  صور حالة المنتج * — {photos.length} من {MAX_PHOTOS}
                </Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line bg-card px-3 py-2.5 text-sm text-ink-muted transition hover:border-success hover:text-ink">
                  <Camera className="size-4" />
                  إضافة صور (صورة واحدة على الأقل)
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={onPickPhotos}
                  />
                </label>
                {previews.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {previews.map((src, i) => (
                      <div key={`${src}-${i}`} className="relative">
                        <img
                          src={src}
                          alt={`صورة حالة المنتج ${i + 1}`}
                          className="size-16 rounded-md border border-line object-cover"
                        />
                        <button
                          type="button"
                          aria-label={`حذف الصورة ${i + 1}`}
                          onClick={() => dropPhoto(i)}
                          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-card text-xs text-destructive"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {verifyError && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {verifyError}
                </p>
              )}

              <Button type="submit" size="sm" className="w-full" disabled={verifying}>
                {verifying && <Loader2 className="size-4 animate-spin" />}
                <CheckCircle2 className="size-4" />
                تأكيد وتوثيق الحالة
              </Button>
            </form>
          )}

          {/* ── Evidence once verified (note + photos are permanent) ── */}
          {verifyRow?.used_at && (
            <div className="rounded-md border border-success/30 bg-success-soft p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-success-ink">
                <CheckCircle2 className="size-4" />
                {verifyPurpose === "delivery" ? "تم تأكيد الاستلام" : "تم تأكيد الإرجاع"} —{" "}
                {fmtShortDate(verifyRow.used_at)}
              </p>
              {verifyRow.condition_note && (
                <p className="mt-1.5 text-xs leading-5 text-ink">
                  ملاحظة الحالة: {verifyRow.condition_note}
                </p>
              )}
              {(evidence[verifyPurpose] ?? []).filter(Boolean).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(evidence[verifyPurpose] ?? [])
                    .filter(Boolean)
                    .map((url, i) => (
                      <img
                        key={url}
                        src={url}
                        alt={`صورة موثقة ${i + 1}`}
                        className="size-16 rounded-md border border-line object-cover"
                      />
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {done && (
        <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="size-4" />
          {done}
        </p>
      )}

      {/* ── Payer: pay from the points wallet → 'held' + codes, immediately ── */}
      {!hold && side === "payer" && payable && (
        <div className="space-y-3 rounded-lg border border-line bg-card p-3.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Wallet className="size-4 text-success" />
            الدفع من محفظة نقاطك
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/60 p-3 text-sm">
            <span className="text-ink-muted">
              رصيدك:{" "}
              <span className="font-bold tabular-nums text-ink">{fmtPoints(balance)}</span>{" "}
              <span className="text-xs">({fmtEGP(balance * pointValue)})</span>
            </span>
            <span className="text-ink-muted">
              المطلوب:{" "}
              <span className="font-bold tabular-nums text-brand-deep">
                {fmtPoints(payable.amount)}
              </span>
            </span>
          </div>

          {balance >= payable.amount ? (
            <Button className="w-full" disabled={busy} onClick={onPay}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              <CheckCircle2 className="size-4" />
              ادفع {fmtPoints(payable.amount)} وأؤكد الحجز
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
                رصيدك ينقص {fmtPoints(payable.amount - balance)} — اشحن محفظتك أولًا (100 نقطة ={" "}
                {fmtEGP(100 * pointValue)}).
              </p>
              <Button className="w-full" variant="success" onClick={() => navigate("/topup")}>
                <Wallet className="size-4" />
                شحن المحفظة
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Payee: release only after the return code is verified (0028) ── */}
      {hold?.status === "held" && side === "payee" && (
        <div className="space-y-2">
          {!returnVerified && (
            <p className="rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
              التحصيل موقوف حتى يؤكد المستأجر كود الإرجاع ويوثق حالة المنتج.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={busy || !returnVerified}
              onClick={onRelease}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              <CheckCircle2 className="size-4" />
              استلمت وأؤكد التحويل ({fmtPoints(hold.net_amount)})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              disabled={busy}
              onClick={onRefund}
            >
              <RotateCcw className="size-4" />
              إرجاع المبلغ للمستأجر
            </Button>
          </div>
        </div>
      )}

      {hold?.status === "held" && side === "payer" && (
        <p className="flex items-start gap-1.5 text-sm text-ink-muted">
          <Wallet className="mt-0.5 size-4 shrink-0" />
          المبلغ محجوز — لا يُحوَّل للمالك إلا بعد تأكيد الإرجاع وتوثيق حالة المنتج.
        </p>
      )}

      {hold?.status === "released" && (
        <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="size-4" />
          تم التحويل للمالك ({fmtPoints(hold.net_amount)}) —{" "}
          {fmtShortDate(hold.released_at ?? hold.held_at)}
        </p>
      )}
      {hold?.status === "refunded" && (
        <p className="flex items-center gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-sm text-gold-deep">
          <RotateCcw className="size-4" />
          تمت إعادة المبلغ المحجوز إلى رصيد المستأجر
        </p>
      )}
    </div>
  );
}
