import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Loader2,
  Megaphone,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMerchantAccount, listPromoServices, purchasePromo, type MerchantAccount, type PromoService } from "@/lib/saas";
import { fmtEGP } from "@/lib/format";
import { useAuth } from "@/store/auth";

const SERVICE_ICONS: Record<string, typeof Sparkles> = {
  featured: Sparkles,
  top_category: TrendingUp,
  bump: Upload,
};

export function PromoPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const listingId = params.get("listing");

  const [services, setServices] = useState<PromoService[]>([]);
  const [acct, setAcct] = useState<MerchantAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("trial");

  const load = useCallback(async () => {
    try {
      const [svcs, a] = await Promise.all([
        listPromoServices(),
        user ? getMerchantAccount().catch(() => null) : Promise.resolve(null),
      ]);
      setServices(svcs);
      setAcct(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الخدمات.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const onBuy = async (svc: PromoService) => {
    if (!listingId) {
      setError("لا يوجد إعلان محدد — افتح صفحة الإعلان ثم اضغط «روّج لهذا الإعلان».");
      return;
    }
    setBusyId(svc.id);
    setError(null);
    setFlash(null);
    try {
      const useCredits = selected === "credits" && acct && acct.promo_credits_remaining >= svc.promo_credits_cost && svc.promo_credits_cost > 0;
      const method = useCredits ? "credits" : "trial";
      const res = await purchasePromo(listingId, svc.id, method);
      if (res.status === "active") {
        setFlash(
          useCredits
            ? `تم تفعيل الترويج (${svc.name}) باستخدام رصيدك — تبقّى ${res.credits_remaining} رصيد.`
            : `تم تفعيل الترويج (${svc.name}) — وضع تجريبي.`,
        );
      } else {
        setFlash(res.message ?? "تم إنشاء الطلب — بانتظار تأكيد الدفع.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام طلب الترويج.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-muted">
        <Loader2 className="mx-auto size-6 animate-spin" />
        <p className="mt-2">جارٍ تحميل خدمات الترويج…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-ink">ترويج الإعلانات</h1>
      <p className="mt-1 text-sm text-ink-muted">
        اختر خدمة الترويج المناسبة — يمكنك الدفع نقدًا أو باستخدام رصيد اشتراكك.
      </p>

      {!listingId && (
        <p className="mt-4 flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-gold-deep">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          لا يوجد إعلان محدد — افتح إعلانك ثم اضغط «روّج لهذا الإعلان».
        </p>
      )}

      {acct?.has_subscription && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-line bg-card p-3 text-sm text-ink">
          <Crown className="size-4 text-brand" />
          باقتك: {acct.plan_name} — أرصدة ترويج متبقّية:{" "}
          <span className="font-bold tabular-nums text-brand-deep">{acct.promo_credits_remaining}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {flash && (
        <p className="mt-4 rounded-md border border-success/30 bg-success-soft p-3 text-sm font-semibold text-success-ink">
          <CheckCircle2 className="inline size-4" /> {flash}
        </p>
      )}

      {/* Payment method toggle */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setSelected("trial")}
          className={`rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition ${
            selected === "trial" ? "border-brand bg-brand/5 text-brand-deep" : "border-line text-ink-muted"
          }`}
        >
          دفع تجريبي
        </button>
        <button
          type="button"
          onClick={() => setSelected("credits")}
          disabled={!acct?.has_subscription || acct.promo_credits_remaining <= 0}
          className={`rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
            selected === "credits" ? "border-brand bg-brand/5 text-brand-deep" : "border-line text-ink-muted"
          }`}
        >
          رصيد الباقة ({acct?.promo_credits_remaining ?? 0})
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {services.map((svc) => {
          const Icon = SERVICE_ICONS[svc.promo_type] ?? Sparkles;
          const canCredits =
            selected === "credits" &&
            acct?.has_subscription &&
            svc.promo_credits_cost > 0 &&
            acct.promo_credits_remaining >= svc.promo_credits_cost;
          return (
            <div key={svc.id} className="flex items-center gap-4 rounded-xl border border-line bg-card p-4">
              <Icon className="size-8 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{svc.name}</p>
                <p className="text-xs text-ink-muted">{svc.description}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-muted">
                  <span className="font-bold tabular-nums text-brand-deep">{fmtEGP(svc.price_egp)}</span>
                  <span>· {svc.duration_days} يوم</span>
                  {svc.promo_credits_cost > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      أو {svc.promo_credits_cost} رصيد
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                disabled={busyId === svc.id || !listingId}
                onClick={() => void onBuy(svc)}
              >
                {busyId === svc.id && <Loader2 className="size-4 animate-spin" />}
                {canCredits ? `استخدم رصيد (${svc.promo_credits_cost})` : `فعّل (${fmtEGP(svc.price_egp)})`}
              </Button>
            </div>
          );
        })}
      </div>

      {!user && (
        <p className="mt-6 text-center text-sm text-ink-muted">
          <Link to="/auth" className="text-brand underline">
            سجّل دخولك
          </Link>{" "}
          للبدء.
        </p>
      )}

      <p className="mt-6 flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-3 text-xs text-gold-deep">
        <Megaphone className="mt-0.5 size-3.5 shrink-0" />
        وضع تجريبي — الترويج يُفعّل فورًا بدون دفع حقيقي. في الإنتاج، يُفعّل فقط بعد تأكيد موثوق من بوابة الدفع.
      </p>
    </div>
  );
}
