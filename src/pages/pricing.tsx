import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Crown, Loader2, Megaphone, Store, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listPricingPlans, type PricingPlan } from "@/lib/saas";
import { fmtEGP } from "@/lib/format";
import { useAuth } from "@/store/auth";

const PLAN_ICONS: Record<string, typeof Crown> = {
  free: Zap,
  starter: Store,
  growth: Crown,
  business: BadgeCheck,
};

export function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const p = await listPricingPlans();
        setPlans(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذر تحميل الباقات.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSubscribe = (plan: PricingPlan) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    navigate(`/subscribe/${plan.id}`);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-ink-muted">
        <Loader2 className="mx-auto size-6 animate-spin" />
        <p className="mt-2">جارٍ تحميل الباقات…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-ink">باقات بادال للتجّار</h1>
        <p className="mt-2 text-ink-muted">
          اختر الباقة المناسبة لحجم نشاطك — كل باقة تشمل حصص إعلانات وأرصدة ترويج.
        </p>
        <p className="mt-1 text-xs text-gold-deep">
          وضع تجريبي للمنافسة — الدفع غير متصل ببوابة حقيقية.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const Icon = PLAN_ICONS[plan.id] ?? Crown;
          const isFree = plan.price_egp <= 0;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border bg-card p-5 ${
                plan.id === "growth" ? "border-brand shadow-md" : "border-line"
              }`}
            >
              {plan.id === "growth" && (
                <Badge className="mb-2 w-fit bg-brand text-xs text-white">الأكثر شيوعًا</Badge>
              )}
              <Icon className={`mb-2 size-6 ${isFree ? "text-ink-muted" : "text-brand"}`} />
              <h2 className="text-lg font-bold text-ink">{plan.name}</h2>
              <p className="mt-1 min-h-10 text-xs text-ink-muted">{plan.description}</p>
              <p className="mt-3 text-2xl font-bold tabular-nums text-brand-deep">
                {isFree ? "مجانًا" : fmtEGP(plan.price_egp)}
                {!isFree && <span className="text-sm font-normal text-ink-muted"> / شهريًا</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink">
                <li className="flex items-center gap-1.5">
                  <BadgeCheck className="size-4 shrink-0 text-success" />
                  {isFree ? "3 إعلانات / 30 يوم" : `${plan.listing_quota} إعلان شهريًا`}
                </li>
                <li className="flex items-center gap-1.5">
                  <BadgeCheck className="size-4 shrink-0 text-success" />
                  {plan.promo_credits > 0 ? `${plan.promo_credits} رصيد ترويج` : "بدون أرصدة ترويج"}
                </li>
                {plan.has_store_page && (
                  <li className="flex items-center gap-1.5">
                    <BadgeCheck className="size-4 shrink-0 text-success" />
                    صفحة متجر خاصة
                  </li>
                )}
                {plan.has_stats && (
                  <li className="flex items-center gap-1.5">
                    <BadgeCheck className="size-4 shrink-0 text-success" />
                    إحصائيات أساسية
                  </li>
                )}
              </ul>
              <Button
                className="mt-4 w-full"
                variant={isFree ? "outline" : "default"}
                disabled={isFree}
                onClick={() => onSubscribe(plan)}
              >
                {isFree ? "الخطة الافتراضية" : "اشترك الآن"}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-xl border border-line bg-secondary/50 p-5 text-sm text-ink-muted">
        <p className="flex items-center gap-1.5 font-semibold text-ink">
          <Megaphone className="size-4 text-brand" />
          خدمات ترويج الإعلانات
        </p>
        <p className="mt-1">
          Featured Ad — 15 ج لمدة 7 أيام · Top of Category — 25 ج لمدة 7 أيام · Bump — 5 ج للعملية.
          يمكن استخدام رصيد الترويج من الباقة بدل الدفع النقدي.
        </p>
      </div>
    </div>
  );
}
