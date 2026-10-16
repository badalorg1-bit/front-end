import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Database, Package, Repeat, Tag, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CardSkeleton, EmptyState } from "@/components/states";
import { RealListingCard } from "@/components/real-listing-card";
import { searchPublishedListings } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { ListingWithImages } from "@/lib/types";
import { useAuth } from "@/store/auth";

export function HomePage() {
  const { user, profile } = useAuth();
  const [featured, setFeatured] = useState<ListingWithImages[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    searchPublishedListings({})
      .then((all) => {
        if (!cancelled) setFeatured(all.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setFeatured([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-10 py-8">
      <section className="rounded-2xl border border-line bg-brand-deep px-6 py-10 text-paper shadow-l2 md:px-10 md:py-14">
        <p className="text-sm font-medium text-paper/70">
          {user ? `أهلاً ${profile?.display_name ?? ""} — ` : ""}منصة تأجير وبيع ومقايضة
        </p>
        <h1 className="mt-2 max-w-2xl text-[26px] font-bold leading-tight md:text-4xl">
          بدّال: استأجر أو بِع أو بادل ما تحتاجه من أشخاص موثوقين
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-paper/75 md:text-base">
          انشر إعلانك خلال دقائق، تصفّح عروض حقيقية من ملّاك، وأرسل طلب تأجير أو شراء أو مقايضة
          مباشرة.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/search">
            <Button className="bg-paper text-ink hover:bg-white">
              تصفح الإعلانات
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <Link to={user ? "/owner?tab=add" : "/auth"}>
            <Button
              variant="outline"
              className="border-white/30 bg-transparent text-paper hover:bg-white/10 hover:text-white"
            >
              أضف إعلانك
            </Button>
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-ink">تصفّح حسب النوع</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { to: "/search?type=rent", label: "للإيجار", desc: "معدات، أثاث، إلكترونيات بالساعة أو اليوم", Icon: CalendarDays },
            { to: "/search?type=sale", label: "للبيع", desc: "منتجات جديدة ومستعملة بأسعار واضحة", Icon: Tag },
            { to: "/search?type=swap", label: "مقايضة", desc: "بدّل أغراضك مع آخرين بدون نقد", Icon: Repeat },
          ].map(({ to, label, desc, Icon }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-xl border border-line bg-card p-5 shadow-l1 transition-colors hover:border-brand/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-success-ink">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-3 font-semibold text-ink group-hover:text-success-ink">{label}</h3>
              <p className="mt-1 text-sm leading-6 text-ink-muted">{desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">أحدث الإعلانات</h2>
          <Link to="/search" className="text-sm text-success-ink hover:text-success-hover">
            عرض الكل
          </Link>
        </div>

        {!isSupabaseConfigured ? (
          <EmptyState
            icon={Database}
            title="اربط Supabase لعرض الإعلانات الحقيقية"
            description="انسخ .env.example إلى .env.local وضع VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY ثم أعد تشغيل الخادم."
            action={
              <Link to="/auth">
                <Button variant="outline">إعداد الدخول</Button>
              </Link>
            }
          />
        ) : loading ? (
          <CardSkeleton count={4} />
        ) : featured.length === 0 ? (
          <EmptyState
            icon={Package}
            title="لا توجد إعلانات منشورة بعد"
            description="كن أول من ينشر إعلانًا في بدّال."
            action={
              <Link to={user ? "/owner?tab=add" : "/auth"}>
                <Button>ابدأ الآن</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((l) => (
              <RealListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          {
            title: "إعلان واضح",
            body: "اختر إيجارًا أو بيعًا أو مقايضة، وحدد السعر والتأمين بالجنيه المصري.",
          },
          {
            title: "طلب مباشر",
            body: "المستأجر أو المشتري أو صاحب المقايضة يرسل طلبًا للمالك مع رسالة وتاريخ.",
          },
          {
            title: "رد المالك",
            body: "المالك يقبل أو يرفض من لوحته، والحالة تُحدَّث فورًا في قاعدة البيانات.",
          },
        ].map((s) => (
          <Card key={s.title}>
            <CardContent className="pt-5">
              <h3 className="font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-muted">{s.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
