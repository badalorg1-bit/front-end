import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Landmark,
  Loader2,
  QrCode,
  ShieldCheck,
  Upload,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  attachWalletTopupScreenshot,
  createWalletTopup,
  getBaynaPaymentSettings,
  getWalletSummary,
  listMyWalletTopups,
  uploadTopupScreenshot,
  type WalletTopup,
} from "@/lib/api";
import { getPaymentQrPublicUrl, validateImageFile } from "@/lib/supabase";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";
import type { BaynaPaymentSettings } from "@/lib/types";

const STATUS_LABEL: Record<WalletTopup["status"], string> = {
  pending: "قيد المراجعة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
};

function statusBadge(status: WalletTopup["status"]) {
  if (status === "approved")
    return (
      <Badge variant="default" className="bg-success-soft text-success-ink border-success/30">
        <CheckCircle2 className="size-3" /> {STATUS_LABEL.approved}
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" /> {STATUS_LABEL.rejected}
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Clock className="size-3" /> {STATUS_LABEL.pending}
    </Badge>
  );
}

export function TopupPage() {
  const { user, ready: authReady } = useAuth();
  const [settings, setSettings] = useState<BaynaPaymentSettings | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<WalletTopup[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, w, h] = await Promise.all([
          getBaynaPaymentSettings(),
          getWalletSummary().catch(() => null),
          listMyWalletTopups().catch(() => []),
        ]);
        if (cancelled) return;
        setSettings(s);
        if (s.qr_path) setQrUrl(getPaymentQrPublicUrl(s.qr_path));
        setBalance(w?.balance ?? null);
        setHistory(h);
      } catch {
        if (!cancelled) setError("تعذر تحميل البيانات.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authReady]);

  const onFile = (f: File | null) => {
    if (!f) return;
    const err = validateImageFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(URL.createObjectURL(f));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100000) {
      setError("أدخل مبلغًا صحيحًا بين 1 و 100,000 ج.م.");
      return;
    }
    if (!file) {
      setError("ارفع صورة إثبات التحويل.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const { topup_id } = await createWalletTopup(amt);
      const path = await uploadTopupScreenshot(user.id, file);
      await attachWalletTopupScreenshot(topup_id, path);
      setDone(true);
      setAmount("");
      setFile(null);
      if (filePreview) URL.revokeObjectURL(filePreview);
      setFilePreview(null);
      const [w, h] = await Promise.all([
        getWalletSummary().catch(() => null),
        listMyWalletTopups().catch(() => []),
      ]);
      setBalance(w?.balance ?? null);
      setHistory(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  };

  if (authReady && !user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Wallet className="mx-auto mb-3 size-10 text-ink-muted" />
        <h1 className="text-xl font-bold text-ink">شحن المحفظة</h1>
        <p className="mt-2 text-sm text-ink-muted">سجّل الدخول لشحن رصيد محفظتك.</p>
        <Link
          to="/auth"
          className="mt-4 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          تسجيل الدخول
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg bg-secondary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-8">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand">المحفظة</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">شحن المحفظة</h1>
        {balance !== null && (
          <p className="mt-1 text-sm text-ink-muted">
            الرصيد الحالي:{" "}
            <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(balance)}</span>
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-ink">
            <QrCode className="size-5 text-success" />
            حوّل المبلغ ثم ارفع الإيصال
          </CardTitle>
          <CardDescription>
            حوّل المبلغ لحساب بينا الرسمي بالأسفل، ثم ارفع صورة إثبات التحويل. ستُضاف الرصيد بعد
            مراجعة الإدارة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings && (
            <div className="space-y-2 rounded-lg border border-line bg-secondary/50 p-3.5">
              {settings.wallet_name && (
                <p className="text-sm text-ink-muted">
                  اسم المحفظة:{" "}
                  <span className="font-semibold text-ink">{settings.wallet_name}</span>
                </p>
              )}
              {qrUrl && (
                <div className="flex justify-center py-1">
                  <img
                    src={qrUrl}
                    alt="رمز QR لشحن المحفظة — بينا"
                    className="w-56 rounded-lg border border-line bg-card"
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
          )}

          <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2.5 text-xs leading-5 text-gold-deep">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            حوّل المبلغ لحساب بينا الرسمي فقط. لا تحوّل لأي حساب آخر — المنصة غير مسؤولة عن
            التحويلات لحسابات مختلفة.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="amount">المبلغ (ج.م) *</Label>
              <Input
                id="amount"
                type="number"
                min={1}
                max={100000}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثال: 100"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt">صورة إثبات التحويل *</Label>
              <input
                id="receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs file:me-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
              />
              {filePreview && (
                <img
                  src={filePreview}
                  alt="معاينة الإيصال"
                  className="mt-2 h-32 rounded-lg border border-line object-contain"
                />
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            {done && (
              <p className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success-soft p-2.5 text-sm font-semibold text-success-ink">
                <CheckCircle2 className="size-4" />
                تم استلام طلبك — بانتظار مراجعة الإدارة.
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2 className="size-4 animate-spin" />}
              <Upload className="size-4" />
              إرسال طلب الشحن
            </Button>
          </form>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-ink">
              <Landmark className="size-5 text-brand" />
              طلبات الشحن السابقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line">
              {history.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-semibold tabular-nums text-ink">{fmtEGP(t.amount_egp)}</p>
                    <p className="text-xs text-ink-muted">{fmtShortDate(t.created_at)}</p>
                    {t.review_notes && (
                      <p className="mt-0.5 text-xs text-ink-muted">{t.review_notes}</p>
                    )}
                  </div>
                  {statusBadge(t.status)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Link
        to="/owner"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        <ArrowRight className="size-4" />
        العودة للوحة التاجر
      </Link>
    </div>
  );
}
