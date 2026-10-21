import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDirectPayment, getBadalPaymentSettings, requestPayableAmount } from "@/lib/api";
import { getPaymentQrPublicUrl } from "@/lib/supabase";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import type { BadalPaymentSettings, RequestWithListing } from "@/lib/types";

interface Props {
  request: RequestWithListing;
  side: "payer" | "payee";
  onChanged: () => void;
}

/** Direct-transfer panel for an accepted rent/purchase request (swap excluded). */
export function DirectPaymentSection({ request, side, onChanged }: Props) {
  const payable = requestPayableAmount(request);
  const [settings, setSettings] = useState<BadalPaymentSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(side === "payer");
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
    getBadalPaymentSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [side]);

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

  const myConfirmed = side === "payer" ? state.payer_confirmed_at : state.payee_confirmed_at;
  const qrUrl = settings?.qr_path ? getPaymentQrPublicUrl(settings.qr_path) : "";

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
        حوّل المبلغ لحساب بادال الرسمي فقط — بادال تحجز المبلغ وتؤمّن الطرفين. لا تحوّل لأي
        حساب آخر.
      </p>

      {side === "payer" &&
        (loadingSettings ? (
          <p className="text-sm text-ink-muted">
            <Loader2 className="inline size-4 animate-spin" /> جارٍ تحميل بيانات الدفع…
          </p>
        ) : !settings || (!qrUrl && !settings.wallet_name && !settings.instagram) ? (
          <p className="rounded-md border border-warn-line bg-warn-soft p-2.5 text-sm text-gold-deep">
            بيانات الدفع غير متاحة حاليًا. حاول مرة أخرى لاحقًا أو تواصل مع الإدارة.
          </p>
        ) : (
          <div className="space-y-2.5">
            {settings.wallet_name && (
              <p className="text-sm text-ink-muted">
                اسم المحفظة:{" "}
                <span className="font-semibold text-ink">{settings.wallet_name}</span>
              </p>
            )}
            {qrUrl && (
              <div className="flex justify-center">
                <img
                  src={qrUrl}
                  alt="رمز QR للدفع — بادال"
                  className="w-52 rounded-lg border border-line bg-card"
                />
              </div>
            )}
            {settings.instagram && (
              <p className="text-sm text-ink-muted">
                إنستجرام:{" "}
                <span className="font-semibold text-ink" dir="ltr">
                  {settings.instagram.startsWith("@") ? settings.instagram : `@${settings.instagram}`}
                </span>
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
