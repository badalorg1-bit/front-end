import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  Landmark,
  Loader2,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  escrowPayExternal,
  escrowRefund,
  escrowRelease,
  getBaynaPaymentSettings,
  getBaynaQrUrl,
  getEscrowForRequest,
  requestPayableAmount,
} from "@/lib/api";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import type { BaynaPaymentSettings, EscrowHold, RequestWithListing } from "@/lib/types";

interface Props {
  request: RequestWithListing;
  side: "payer" | "payee";
  onChanged: () => void;
}

type Method = "wallet_qr" | "instagram";

/** Bayna payment gateway: buyer pays via QR or Instagram → escrow hold → release with % fee. */
export function EscrowPaymentSection({ request, side, onChanged }: Props) {
  const payable = requestPayableAmount(request);
  const [hold, setHold] = useState<EscrowHold | null>(null);
  const [settings, setSettings] = useState<BaynaPaymentSettings | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        getEscrowForRequest(request.id),
        getBaynaPaymentSettings(),
      ]);
      setHold(h);
      setSettings(s);
      if (s.qr_path) {
        const url = await getBaynaQrUrl(s.qr_path);
        setQrUrl(url);
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

  const feePercent = settings?.fee_percent ?? 5;
  const feeAmount = payable ? Math.floor((payable.amount * feePercent) / 100) : 0;
  const netAmount = payable ? payable.amount - feeAmount : 0;

  const onPay = async () => {
    if (!payable || !method) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await escrowPayExternal(request.id, payable.amount, method);
      setDone(
        method === "wallet_qr"
          ? "تم إرسال تأكيد الدفع عبر QR — بانتظار مراجعة الإدارة لاعتماد المبلغ."
          : "تم إرسال تأكيد الدفع عبر إنستا — بانتظار مراجعة الإدارة لاعتماد المبلغ.",
      );
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تأكيد الدفع.");
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
      setDone("تم تحويل المبلغ إلى محفظتك بعد خصم عمولة بينا.");
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
      setDone("تمت إعادة المبلغ إلى المشتري.");
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إعادة المبلغ.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-secondary/50 p-3.5 text-sm text-ink-muted">
        <Loader2 className="inline size-4 animate-spin" /> جارٍ تحميل بوابة الدفع…
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-secondary/60 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Landmark className="size-4 text-success" />
        بوابة دفع بينا — عرض تجريبي
      </p>

      <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        ادفع لبينا مباشرة عبر QR أو إنستا. بينا تحجز المبلغ وتخصم عمولة خدمة{" "}
        <span className="font-bold">{feePercent}%</span> عند التسليم، ثم تحوّل الباقي للمالك.
        نموذج تجريبي للمنافسة ولا يتصل ببنك حقيقي.
      </p>

      {payable && (
        <div className="grid gap-2 rounded-md border border-line bg-card p-3 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>المبلغ الإجمالي ({payable.label})</span>
            <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(payable.amount)}</span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>عمولة خدمة بينا ({feePercent}%)</span>
            <span className="tabular-nums text-gold-deep">{fmtEGP(feeAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <span>يصل للمالك</span>
            <span className="tabular-nums text-success-ink">{fmtEGP(netAmount)}</span>
          </div>
        </div>
      )}

      {hold?.status === "pending_confirmation" && (
        <div className="space-y-2 rounded-md border border-warn-line bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-gold-deep">
            بانتظار اعتماد الإدارة — {fmtEGP(hold.amount)}
          </p>
          <p className="text-xs leading-5 text-ink-muted">
            سجّلنا تأكيد دفعتك. تراجع الإدارة التحويل وتعتمده، ثم يظهر المبلغ كمحجوز حتى
            التسليم. لن يُحوَّل لأي طرف قبل الاعتماد.
          </p>
        </div>
      )}
      {hold?.status === "held" && (
        <div className="space-y-2 rounded-md border border-line bg-card p-3 text-sm">
          <p className="font-semibold text-ink">
            المبلغ محجوز لدى بينا منذ {fmtShortDate(hold.held_at)}
          </p>
          <p className="text-ink-muted">
            المحجوز: {fmtEGP(hold.amount)} — يُحوَّل للمالك {fmtEGP(hold.net_amount)} بعد التسليم
          </p>
        </div>
      )}
      {hold?.status === "released" && (
        <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="size-4" />
          تم التحويل للمالك ({fmtEGP(hold.net_amount)}) — {fmtShortDate(hold.released_at ?? hold.held_at)}
        </p>
      )}
      {hold?.status === "refunded" && (
        <p className="flex items-center gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-sm text-gold-deep">
          <RotateCcw className="size-4" />
          تمت إعادة المبلغ للمشتري
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
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

      {/* ── Payer: choose method → show QR / Instagram → confirm ── */}
      {!hold && side === "payer" && payable && (
        <div className="space-y-3">
          {!method && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod("wallet_qr")}
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-line bg-card p-4 text-sm font-semibold text-ink transition hover:border-success hover:bg-success-soft/30"
              >
                <QrCode className="size-8 text-success" />
                دفع عبر QR
                <span className="text-xs font-normal text-ink-muted">امسح الكود بتطبيقك</span>
              </button>
              <button
                type="button"
                onClick={() => setMethod("instagram")}
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-line bg-card p-4 text-sm font-semibold text-ink transition hover:border-brand hover:bg-brand/5"
              >
                <AtSign className="size-8 text-brand" />
                دفع عبر إنستا
                <span className="text-xs font-normal text-ink-muted">حوّل على حساب بينا</span>
              </button>
            </div>
          )}

          {method === "wallet_qr" && (
            <div className="space-y-3 rounded-lg border border-line bg-card p-4 text-center">
              <p className="text-sm font-semibold text-ink">امسح الكود وادفع {fmtEGP(payable.amount)}</p>
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR الدفع — بينا"
                  className="mx-auto size-48 rounded-lg border border-line"
                />
              ) : (
                <div className="mx-auto flex size-48 items-center justify-center rounded-lg border border-dashed border-line bg-secondary/50 text-ink-muted">
                  <QrCode className="size-12" />
                </div>
              )}
              <p className="text-xs text-ink-muted">
                المحفظة: <span className="font-semibold text-ink">{settings?.wallet_name ?? "بينا"}</span>
              </p>
              <p className="text-xs text-ink-muted">
                المبلغ المطلوب: <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(payable.amount)}</span>
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setMethod(null)}>
                  تغيير الطريقة
                </Button>
                <Button size="sm" disabled={busy} onClick={onPay}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  <CheckCircle2 className="size-4" />
                  أدفع {fmtEGP(payable.amount)} وأؤكد
                </Button>
              </div>
            </div>
          )}

          {method === "instagram" && (
            <div className="space-y-3 rounded-lg border border-line bg-card p-4 text-center">
              <p className="text-sm font-semibold text-ink">حوّل على إنستا بينا</p>
              <div className="mx-auto flex size-48 items-center justify-center rounded-lg border border-dashed border-line bg-secondary/50">
                <AtSign className="size-12 text-brand" />
              </div>
              <p className="text-lg font-bold text-brand-deep">{settings?.instagram ?? "@bayna.egypt"}</p>
              <p className="text-xs text-ink-muted">
                أرسل <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(payable.amount)}</span> على
                هذا الحساب ثم أكّد هنا.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setMethod(null)}>
                  تغيير الطريقة
                </Button>
                <Button size="sm" disabled={busy} onClick={onPay}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  <CheckCircle2 className="size-4" />
                  حوّلت وأؤكد
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Payee: release / refund ── */}
      {hold?.status === "held" && side === "payee" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="success" disabled={busy} onClick={onRelease}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            <CheckCircle2 className="size-4" />
            استلمت وأؤكد التحويل ({fmtEGP(netAmount)})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            disabled={busy}
            onClick={onRefund}
          >
            <RotateCcw className="size-4" />
            إعادة للمشتري
          </Button>
        </div>
      )}

      {hold?.status === "held" && side === "payer" && (
        <p className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Wallet className="size-4" />
          المبلغ محجوز — بانتظار تسليم المالك ليصل الباقي إلى محفظته.
        </p>
      )}
    </div>
  );
}
