import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Package,
  Repeat,
  ShieldCheck,
  Tag,
  UserRound,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import { RealListingCard } from "@/components/real-listing-card";
import {
  LISTING_TYPE_LABEL,
  listingPriceLabel,
  type ListingWithImages,
} from "@/lib/types";
import { getListingById, getRelatedListings } from "@/lib/api";
import { fmtDate, isSupabaseConfiguredSafe } from "@/lib/page-utils";
import { useAuth } from "@/store/auth";

const typeIcon = {
  rent: CalendarDays,
  sale: Tag,
  swap: Repeat,
} as const;

export function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [listing, setListing] = useState<ListingWithImages | null>(null);
  const [related, setRelated] = useState<ListingWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    if (!id || !isSupabaseConfiguredSafe()) return;
    let cancelled = false;
    setLoading(true);
    getListingById(id)
      .then(async (l) => {
        if (cancelled) return;
        setListing(l);
        if (l) {
          const rel = await getRelatedListings(l);
          if (!cancelled) setRelated(rel);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل الإعلان.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!isSupabaseConfiguredSafe()) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={Database}
          title="قاعدة البيانات غير مهيأة"
          description="راجع .env.local لإعداد Supabase."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-12">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title={error ?? "هذا الإعلان غير موجود"}
          description={error ?? "ربما حُذف الإعلان أو تغيّر رابطه."}
          action={
            <Link to="/search">
              <Button>العودة إلى التصفح</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const Icon = typeIcon[listing.listing_type];
  const images = listing.images.length ? listing.images : [""];
  const isOwner = user?.id === listing.owner_id;

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-10 py-8">
      <nav
        aria-label="مسار التنقل"
        className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted"
      >
        <Link to="/" className="rounded hover:text-success-ink outline-none focus-visible:ring-2 focus-visible:ring-ring">
          الرئيسية
        </Link>
        <ChevronLeft className="size-3.5" />
        <Link to="/search" className="rounded hover:text-success-ink outline-none focus-visible:ring-2 focus-visible:ring-ring">
          التصفح
        </Link>
        <ChevronLeft className="size-3.5" />
        <span className="text-ink" aria-current="page">
          {listing.title}
        </span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-line bg-card shadow-l1">
            <div className="relative aspect-[16/10] bg-muted">
              {images[imgIdx] ? (
                <img
                  src={images[imgIdx]}
                  alt={`${listing.title} — صورة ${imgIdx + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-ink-muted">
                  <Package className="size-12" />
                </div>
              )}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)}
                    aria-label="الصورة السابقة"
                    className="absolute start-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-paper transition-colors hover:bg-ink focus-visible:ring-2 focus-visible:ring-white outline-none"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setImgIdx((i) => (i + 1) % images.length)}
                    aria-label="الصورة التالية"
                    className="absolute end-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-paper transition-colors hover:bg-ink focus-visible:ring-2 focus-visible:ring-white outline-none"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                </>
              )}
            </div>
            {images.filter(Boolean).length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-3">
                {images.map(
                  (src, i) =>
                    src && (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setImgIdx(i)}
                        aria-label={`صورة ${i + 1}`}
                        className={`size-16 shrink-0 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          i === imgIdx ? "border-success" : "border-line"
                        }`}
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </button>
                    ),
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-card p-5 shadow-l1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Icon className="size-3" />
                {LISTING_TYPE_LABEL[listing.listing_type]}
              </Badge>
              <Badge variant="outline">{listing.condition}</Badge>
              <Badge variant="outline">{listing.category}</Badge>
            </div>
            <h1 className="mt-3 text-xl font-semibold text-ink md:text-2xl">{listing.title}</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" />
                {listing.city}
                {listing.district ? ` — ${listing.district}` : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-4" />
                {listing.owner_name ?? "مالك"}
              </span>
            </div>
            <Separator className="my-4" />
            <p className="whitespace-pre-wrap text-sm leading-7 text-ink-muted">
              {listing.description || "لا يوجد وصف."}
            </p>
            {listing.listing_type === "swap" && listing.swap_preferences && (
              <>
                <Separator className="my-4" />
                <div>
                  <h2 className="text-sm font-semibold text-ink">تفضيلات المقايضة</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                    {listing.swap_preferences}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-5 shadow-l2 lg:sticky lg:top-24">
            <p className="text-3xl font-bold tabular-nums text-ink">{listingPriceLabel(listing)}</p>
            {listing.listing_type === "rent" && listing.deposit > 0 && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-warn-line bg-warn-soft p-2.5 text-sm text-gold-deep">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                تأمين قابل للاسترداد: {listing.deposit} ج.م — يُسترجع عند التسليم.
              </p>
            )}
            {listing.listing_type === "rent" && listing.rental_unit && (
              <p className="mt-2 text-sm text-ink-muted">وحدة الإيجار: {listing.rental_unit}</p>
            )}

            <Separator className="my-4" />

            {isOwner ? (
              <Link to="/owner" className="block">
                <Button variant="outline" className="w-full">
                  إدارة إعلاناتي
                </Button>
              </Link>
            ) : (
              <Link to={`/request/${listing.id}`} className="block">
                <Button className="w-full">
                  <ArrowRight className="size-4" />
                  {listing.listing_type === "rent"
                    ? "اطلب تأجيرًا"
                    : listing.listing_type === "sale"
                      ? "أرسل طلب شراء"
                      : "اقترح مقايضة"}
                </Button>
              </Link>
            )}

            <ul className="mt-4 space-y-2 text-xs leading-5 text-ink-muted">
              <li>يظهر رد المالك في صفحة «طلباتي» بعد إرسال الطلب.</li>
              <li>الدفع يدوي خارج المنصة في هذه المرحلة — لا مدفوعات إلكترونية بعد.</li>
            </ul>
          </div>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-ink">إعلانات مشابهة</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <RealListingCard key={r.id} listing={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// re-export for fmtDate use in related components if needed
export { fmtDate };
