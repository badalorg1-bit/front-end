import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Landmark,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  escrowPay,
  escrowRefund,
  escrowRelease,
  getEscrowFeePercent,
  getEscrowForRequest,
  getWalletSummary,
  requestPayableAmount,
} from "@/lib/api";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import type { EscrowHold, RequestWithListing } from "@/lib/types";

interface Props {
  request: RequestWithListing;
  side: "payer" | "payee";
  onChanged: () => void;
}

/** Simulated BADAL escrow: hold → release with % fee → seller wallet. */
export function EscrowPaymentSection({ request, side, onChanged }: Props) {
  const payable = requestPayableAmount(request);
  const [hold, setHold] = useState<EscrowHold | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [feePercent, setFeePercent] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, fee] = await Promise.all([
        getEscrowForRequest(request.id),
        getEscrowFeePercent(),
      ]);
      setHold(h);
      setFeePercent(fee);
      if (side === "payer") {
        try {
          const s = await getWalletSummary();
          setBalance(s.balance);
        } catch {
          setBalance(null);
        }
      }
    } catch {
      /* keep last state */
    } finally {
      setLoading(false);
    }
  }, [request.id, side]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const feeAmount = payable ? Math.floor(payable.amount * feePercent / 100) : 0;
  const netAmount = payable ? payable.amount - feeAmount : 0;

  const onPay = async () => {
    if (!payable) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await escrowPay(request.id, payable.amount);
      setDone("تم حجز المبلغ في محفظة بادال بانتظار استلام المالك.");
      await refresh();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حجز المبلغ.");
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
      setDone("تم تحويل المبلغ إلى محفظتك بعد خصم عمولة بادال.");
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
      setDone("تمت إعادة المبلغ إلى محفظة المشتري.");
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
        <Loader2 className="inline size-4 animate-spin" /> جارٍ تحميل محفظة بادال…
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-secondary/60 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Landmark className="size-4 text-success" />
        محفظة بادال (توسيط آمن) — عرض تجريبي
      </p>

      <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        بادال تحجز المبلغ مؤقتًا، وتخصم عمولة خدمة {feePercent}% عند تسليم
        المالك، ثم تحوّل الباقي لمحفظته. هذا نموذج تجريبي للمنافسة ولا يتصل ببنك حقيقي.
      </p>

      {payable && (
        <div className="grid gap-2 rounded-md border border-line bg-card p-3 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>المبلغ الإجمالي ({payable.label})</span>
            <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(payable.amount)}</span>
          </div>
          <div className="flex justify-between text-ink-muted">
            <span>عمولة بادال ({feePercent}%)</span>
            <span className="tabular-nums text-gold-deep">{fmtEGP(feeAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <span>يصل للمالك</span>
            <span className="tabular-nums text-success-ink">{fmtEGP(netAmount)}</span>
          </div>
        </div>
      )}

      {hold?.status === "held" && (
        <div className="space-y-2 rounded-md border border-line bg-card p-3 text-sm">
          <p className="font-semibold text-ink">
            المبلغ محجوز لدى بادال منذ {fmtShortDate(hold.held_at)}
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

      {side === "payer" && balance !== null && (
        <p className="text-sm text-ink-muted">
          رصيد محفظتك الآن:{" "}
          <span className="font-semibold tabular-nums text-ink">{fmtEGP(balance)}</span>
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

      {!hold && side === "payer" && payable && (
        <Button size="sm" disabled={busy || (balance !== null && balance < payable.amount)} onClick={onPay}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          <Wallet className="size-4" />
          ادفع {fmtEGP(payable.amount)} عبر محفظة بادال
        </Button>
      )}
      {!hold && side === "payer" && balance !== null && payable && balance < payable.amount && (
        <p className="text-xs text-gold-deep">
          رصيدك غير كافٍ — اطلب من الإدارة إيداعًا تجريبيًا أو استخدم الدفع المباشر.
        </p>
      )}

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
        <p className="text-sm text-ink-muted">
          المبلغ محجوز — بانتظار تسليم المالك ليصل الباقي إلى محفظته.
        </p>
      )}
    </div>
  );
}
