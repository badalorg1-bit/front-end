import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDirectPayment, getPaymentInstructions, requestPayableAmount } from "@/lib/api";
import { getPaymentQrPublicUrl } from "@/lib/supabase";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import type { PaymentInstructions, RequestWithListing } from "@/lib/types";

interface Props {
  request: RequestWithListing;
  side: "payer" | "payee";
  onChanged: () => void;
}

/** Direct-transfer panel for an accepted rent/purchase request (swap excluded). */
export function DirectPaymentSection({ request, side, onChanged }: Props) {
  const payable = requestPayableAmount(request);
  const [instructions, setInstructions] = useState<PaymentInstructions | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(side === "payer");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState({
    payer_confirmed_at: request.payer_confirmed_at ?? null,
    payee_confirmed_at: request.payee_confirmed_at ?? null,
    paid_at: request.paid_at ?? null,
  });

  useEffect(() => {
    if (side !== "payer") return;
    let cancelled = false;
    getPaymentInstructions(request.id)
      .then((i) => {
        if (!cancelled) setInstructions(i);
      })
      .catch(() => {
        if (!cancelled) setInstructions(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingInstructions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request.id, side]);

  const onConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await confirmDirectPayment(request.id);
      setState({
        payer_confirmed_at: res.payer_confirmed_at,
        payee_confirmed_at: res.payee_confirmed_at,
        paid_at: res.paid_at,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تأكيد العملية.");
    } finally {
      setConfirming(false);
    }
  };

  const hasWallet = Boolean(
    instructions &&
      (instructions.wallet_name ||
        instructions.payment_qr_path ||
        instructions.instagram_handle ||
        instructions.whatsapp_phone),
  );
  const myConfirmed = side === "payer" ? state.payer_confirmed_at : state.payee_confirmed_at;
  const qrUrl = instructions?.payment_qr_path
    ? getPaymentQrPublicUrl(instructions.payment_qr_path)
    : "";

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-secondary/60 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <QrCode className="size-4 text-success" />
        الدفع المباشر
      </p>

      {payable && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-card px-3 py-2">
          <span className="text-sm text-ink-muted">المبلغ ({payable.label})</span>
          <span className="text-lg font-bold tabular-nums text-brand-deep">
            {fmtEGP(payable.amount)}
          </span>
        </div>
      )}
      {payable && payable.deposit > 0 && (
        <p className="text-xs text-gold-deep">
          تأمين قابل للاسترداد عند الاستلام: {fmtEGP(payable.deposit)} — يُسلَّم نقدًا ولا يُحوَّل
          عبر المحفظة.
        </p>
      )}

      <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        الدفع مباشر بين الطرفين — بادال لا تحجز المبلغ ولا تتحمل مسؤولية التحويل. حوّل فقط بعد
        مراجعة تفاصيل الإعلان.
      </p>

      {side === "payer" &&
        (loadingInstructions ? (
          <p className="text-sm text-ink-muted">
            <Loader2 className="inline size-4 animate-spin" /> جارٍ تحميل بيانات الدفع…
          </p>
        ) : !hasWallet ? (
          <p className="rounded-md border border-warn-line bg-warn-soft p-2.5 text-sm text-gold-deep">
            لم يضبط المالك محفظته بعد. انتظر أو تواصل معه لترتيب طريقة الدفع.
          </p>
        ) : (
          <div className="space-y-2.5">
            {instructions?.wallet_name && (
              <p className="text-sm text-ink-muted">
                اسم المحفظة:{" "}
                <span className="font-semibold text-ink">{instructions.wallet_name}</span>
              </p>
            )}
            {qrUrl && (
              <div className="flex justify-center">
                <img
                  src={qrUrl}
                  alt="رمز QR للدفع"
                  className="w-52 rounded-lg border border-line bg-card"
                />
              </div>
            )}
            {instructions?.instagram_handle && (
              <p className="text-sm text-ink-muted">
                إنستجرام:{" "}
                <span className="font-semibold text-ink" dir="ltr">
                  @{instructions.instagram_handle}
                </span>
              </p>
            )}
            {instructions?.whatsapp_phone && (
              <p className="text-sm text-ink-muted">
                واتساب:{" "}
                <span className="font-semibold text-ink" dir="ltr">
                  {instructions.whatsapp_phone}
                </span>
              </p>
            )}
            {instructions?.payment_note && (
              <p className="rounded-md border border-line bg-card p-2.5 text-sm leading-6 text-ink-muted">
                {instructions.payment_note}
              </p>
            )}
          </div>
        ))}

      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`rounded-full border px-2.5 py-1 ${
            state.payer_confirmed_at
              ? "border-success/30 bg-success-soft text-success-ink"
              : "border-line bg-card text-ink-muted"
          }`}
        >
          المستأجر:{" "}
          {state.payer_confirmed_at
            ? `أكّد ${fmtShortDate(state.payer_confirmed_at)}`
            : "لم يؤكد بعد"}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 ${
            state.payee_confirmed_at
              ? "border-success/30 bg-success-soft text-success-ink"
              : "border-line bg-card text-ink-muted"
          }`}
        >
          المالك:{" "}
          {state.payee_confirmed_at
            ? `أكّد ${fmtShortDate(state.payee_confirmed_at)}`
            : "لم يؤكد بعد"}
        </span>
      </div>

      {state.paid_at && (
        <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="size-4" />
          تم تأكيد الدفع من الطرفين ✓
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {!state.paid_at && !myConfirmed && (
        <Button
          size="sm"
          disabled={confirming}
          onClick={onConfirm}
          variant={side === "payer" ? "default" : "success"}
        >
          {confirming && <Loader2 className="size-4 animate-spin" />}
          {side === "payer" ? "أكدت أنني حوّلت المبلغ" : "استلمت المبلغ"}
        </Button>
      )}

      {myConfirmed && !state.paid_at && (
        <p className="text-sm text-success-ink">
          {side === "payer"
            ? "تم تأكيد حوّالتك — بانتظار تأكيد استلام المالك."
            : "تم تأكيد استلامك — بانتظار تأكيد المستأجر أنه حوّل."}
        </p>
      )}
    </div>
  );
}
