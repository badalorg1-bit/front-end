import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  Landmark,
  Loader2,
  QrCode,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listPricingPlans, createSubscriptionOrder, attachOrderScreenshot, uploadSubscriptionScreenshot, type PricingPlan } from "@/lib/saas";
import { getBadalPaymentSettings, getBadalQrUrl } from "@/lib/api";
import { fmtEGP } from "@/lib/format";
import { useAuth } from "@/store/auth";
import type { BadalPaymentSettings } from "@/lib/types";

export function SubscribePage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [settings, setSettings] = useState<BadalPaymentSettings | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    void (async () => {
      try {
        const [plans, s] = await Promise.all([listPricingPlans(), getBadalPaymentSettings()]);
        const found = plans.find((p) => p.id === planId) ?? null;
        if (!found || found.price_egp <= 0) {
          setError("الباقة غير موجودة أو مجانية.");
          return;
        }
        setPlan(found);
        setSettings(s);
        if (s.qr_path) {
          const url = await getBadalQrUrl(s.qr_path);
          setQrUrl(url);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذر تحميل البيانات.");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId, user, navigate]);

  const onSubmit = async () => {
    if (!plan || !file) return;
    setBusy(true);
    setError(null);
    try {
      // 1. create pending order
      const orderRes = await createSubscriptionOrder(plan.id);
      const oid = orderRes.order_id;
      if (!oid) throw new Error("تعذر إنشاء الطلب.");

      // 2. upload screenshot
      const path = await uploadSubscriptionScreenshot(file, oid);

      // 3. attach screenshot to order
      await attachOrderScreenshot(oid, path);

      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-ink-muted">
        <Loader2 className="mx-auto size-6 animate-spin" />
        <p className="mt-2">جارٍ تحميل صفحة الدفع…</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-destructive">{error ?? "الباقة غير موجودة."}</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate("/pricing")}>
          عودة للباقات
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" />
        <h1 className="mt-4 text-xl font-bold text-ink">تم استلام طلبك</h1>
        <p className="mt-2 text-ink-muted">
          طلب الاشتراك بباقة <span className="font-semibold text-ink">{plan.name}</span> ({fmtEGP(plan.price_egp)})
          في انتظار مراجعة الإدارة.
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          سيتم تفعيل الباقة فور التحقق من التحويل — تقدر تتابع الحالة من حساب التاجر.
        </p>
        <Button className="mt-6" onClick={() => navigate("/merchant")}>
          الانتقال لحساب التاجر
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-6 text-center">
        <Badge className="mb-2 bg-brand text-xs text-white">اشتراك باقة</Badge>
        <h1 className="text-2xl font-bold text-ink">{plan.name}</h1>
        <p className="mt-1 text-ink-muted">{plan.description}</p>
      </div>

      {/* Amount */}
      <div className="mb-4 rounded-xl border border-line bg-card p-4 text-center">
        <p className="text-sm text-ink-muted">المبلغ المطلوب</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-brand-deep">{fmtEGP(plan.price_egp)}</p>
        <p className="mt-1 text-xs text-ink-muted">اشتراك شهري — {plan.listing_quota} إعلان + {plan.promo_credits} رصيد ترويج</p>
      </div>

      {/* Warning */}
      <p className="mb-4 flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-3 text-xs leading-5 text-gold-deep">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        ادفع عبر QR أو إنستا ثم ارفع سكرين شوت التحويل. الباقة تُفعّل فقط بعد مراجعة الإدارة والتأكد من التحويل.
      </p>

      {/* QR Code */}
      <div className="mb-4 rounded-xl border border-line bg-card p-5 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ink">
          <Landmark className="size-4 text-success" />
          بوابة دفع بادال
        </p>
        {qrUrl ? (
          <img src={qrUrl} alt="QR الدفع — بادال" className="mx-auto mt-3 size-52 rounded-lg border border-line" />
        ) : (
          <div className="mx-auto mt-3 flex size-52 items-center justify-center rounded-lg border border-dashed border-line bg-secondary/50 text-ink-muted">
            <QrCode className="size-12" />
          </div>
        )}
        <p className="mt-3 text-sm font-semibold text-ink">امسح الكود وادفع {fmtEGP(plan.price_egp)}</p>
        {settings?.wallet_name && (
          <p className="mt-1 text-xs text-ink-muted">اسم المحفظة: {settings.wallet_name}</p>
        )}
        {settings?.instagram && (
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-muted">
            <AtSign className="size-3" /> {settings.instagram}
          </p>
        )}
      </div>

      {/* Upload screenshot */}
      <div className="rounded-xl border border-line bg-card p-5">
        <p className="text-sm font-semibold text-ink">ارفع سكرين شوت التحويل</p>
        <p className="mt-1 text-xs text-ink-muted">
          بعد التحويل، خد سكرين شوت من تطبيق المحفظة وارفعه هنا.
        </p>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <label className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-secondary/40 p-6 text-sm text-ink-muted transition hover:border-brand hover:bg-brand/5">
          <Upload className="size-6" />
          {file ? file.name : "اضغط لاختيار صورة التحويل"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {file && (
          <img
            src={URL.createObjectURL(file)}
            alt="سكرين التحويل"
            className="mt-3 mx-auto max-h-48 rounded-lg border border-line object-contain"
          />
        )}

        <Button className="mt-4 w-full" disabled={!file || busy} onClick={() => void onSubmit()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "جارٍ الإرسال…" : "إرسال طلب الاشتراك"}
        </Button>
      </div>
    </div>
  );
}
