import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Crown,
  Clock,
  Loader2,
  Megaphone,
  Package,
  Store,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMerchantAccount, listMySubscriptionOrders, type MerchantAccount, type SubscriptionOrder } from "@/lib/saas";
import { fmtEGP, fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";

export function MerchantPage() {
  const { user } = useAuth();
  const [acct, setAcct] = useState<MerchantAccount | null>(null);
  const [pendingOrders, setPendingOrders] = useState<SubscriptionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const [a, orders] = await Promise.all([
        getMerchantAccount(),
        listMySubscriptionOrders(),
      ]);
      setAcct(a);
      setPendingOrders(orders.filter((o) => o.status === "pending"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل حساب التاجر.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-ink-muted">سجّل دخولك لعرض حساب التاجر.</p>
        <Button className="mt-4" asChild>
          <Link to="/auth">تسجيل الدخول</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-muted">
        <Loader2 className="mx-auto size-6 animate-spin" />
        <p className="mt-2">جارٍ تحميل حساب التاجر…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!acct) return null;

  const hasSub = acct.status === "active";
  const quotaPct =
    acct.listing_quota > 0 ? Math.min(100, Math.round((acct.listings_used / acct.listing_quota) * 100)) : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">حساب التاجر</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/pricing">
            <Crown className="size-4" />
            {hasSub ? "ترقية الباقة" : "اشترك في باقة"}
          </Link>
        </Button>
      </div>

      {/* Pending orders alert */}
      {pendingOrders.length > 0 && (
        <div className="mb-4 rounded-xl border border-warn-line bg-warn-soft p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gold-deep">
            <Clock className="size-4" />
            {pendingOrders.length} طلب اشتراك بانتظار المراجعة
          </p>
          <p className="mt-1 text-xs text-gold-deep">
            راجع سكرين شوت التحويل وتابع الحالة — سيتم التفعيل فور التأكيد من الإدارة.
          </p>
          {pendingOrders.map((o) => (
            <div key={o.id} className="mt-2 flex items-center justify-between rounded-md border border-line bg-card p-2.5 text-xs">
              <span className="font-semibold text-ink">{o.plan_id} — {fmtEGP(o.amount_egp)}</span>
              <span className="text-ink-muted">{fmtShortDate(o.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Plan card */}
      <div className="rounded-xl border border-line bg-card p-5">
        {hasSub ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-muted">الباقة الحالية</p>
                <p className="text-xl font-bold text-ink">{acct.plan_name}</p>
              </div>
              <Badge variant={acct.status === "active" ? "default" : "secondary"}>
                {acct.status === "active" ? "فعّالة" : acct.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{acct.plan_description}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-ink-muted">السعر</p>
                <p className="font-bold tabular-nums text-ink">{fmtEGP(acct.price_egp)} / شهر</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">الحصة المستهلكة</p>
                <p className="font-bold tabular-nums text-ink">
                  {acct.listings_used} / {acct.listing_quota}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">أرصدة الترويج</p>
                <p className="font-bold tabular-nums text-brand-deep">
                  {acct.promo_credits_remaining} / {acct.promo_credits}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">تنتهي في</p>
                <p className="font-bold text-ink">
                  {acct.expires_at ? fmtShortDate(acct.expires_at) : "—"}
                </p>
              </div>
            </div>
            {/* quota bar */}
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-ink-muted">
                <span>استهلاك الحصة</span>
                <span>{quotaPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className={`h-2 rounded-full transition-all ${
                    quotaPct >= 90 ? "bg-destructive" : quotaPct >= 70 ? "bg-gold-deep" : "bg-success"
                  }`}
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
            </div>
            {acct.listings_remaining <= 5 && acct.listing_quota > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-gold-deep">
                <AlertTriangle className="size-3.5" />
                تبقّى {acct.listings_remaining} إعلانات فقط — فكّر في الترقية.
              </p>
            )}
          </>
        ) : (
          <div className="text-center">
            <Store className="mx-auto size-8 text-ink-muted" />
            <p className="mt-2 font-semibold text-ink">لا توجد باقة فعّالة</p>
            <p className="mt-1 text-sm text-ink-muted">
              أنت الآن على الخطة المجانية — {acct.listings_used} من {acct.listing_quota} إعلانات.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/pricing">استعرض الباقات</Link>
            </Button>
          </div>
        )}
      </div>

      {/* Free tier usage */}
      {!hasSub && (
        <div className="mt-4 rounded-xl border border-line bg-card p-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Package className="size-4 text-ink-muted" />
            استخدام الخطة المجانية
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-muted">المستهلك</p>
              <p className="font-bold tabular-nums text-ink">{acct.listings_used}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">الحد</p>
              <p className="font-bold tabular-nums text-ink">{acct.listing_quota}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">المتبقي</p>
              <p className="font-bold tabular-nums text-ink">{acct.listings_remaining}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link
          to="/owner"
          className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 text-sm font-semibold text-ink transition hover:border-brand"
        >
          <Store className="size-5 text-brand" />
          لوحة المالك — إدارة إعلاناتي
        </Link>
        <Link
          to="/pricing"
          className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 text-sm font-semibold text-ink transition hover:border-brand"
        >
          <Ticket className="size-5 text-brand" />
          الباقات والأسعار
        </Link>
      </div>

      {/* Note */}
      <div className="mt-4 flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-3 text-xs text-gold-deep">
        <Megaphone className="mt-0.5 size-3.5 shrink-0" />
        للاشتراك: اختر باقة ← ادفع عبر QR ← ارفع سكرين شوت التحويل ← تفعيل بعد مراجعة الإدارة.
      </div>
    </div>
  );
}
