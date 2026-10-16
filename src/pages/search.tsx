import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Search, SlidersHorizontal, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardSkeleton, EmptyState } from "@/components/states";
import { RealListingCard } from "@/components/real-listing-card";
import { CATEGORIES, CITIES, searchPublishedListings } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { ListingType, ListingWithImages } from "@/lib/types";

const TYPE_OPTIONS: { value: ListingType | "all"; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "rent", label: "للإيجار" },
  { value: "sale", label: "للبيع" },
  { value: "swap", label: "مقايضة" },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "all");
  const [city, setCity] = useState(params.get("city") ?? "all");
  const [listingType, setListingType] = useState<ListingType | "all">(
    (params.get("type") as ListingType | "all") || "all",
  );
  const [minPrice, setMinPrice] = useState(params.get("min") ?? "");
  const [maxPrice, setMaxPrice] = useState(params.get("max") ?? "");

  const [items, setItems] = useState<ListingWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncParams = useCallback(() => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (category !== "all") next.set("category", category);
    if (city !== "all") next.set("city", city);
    if (listingType !== "all") next.set("type", listingType);
    if (minPrice) next.set("min", minPrice);
    if (maxPrice) next.set("max", maxPrice);
    setParams(next, { replace: true });
  }, [q, category, city, listingType, minPrice, maxPrice, setParams]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchPublishedListings({
        q: q || undefined,
        category: category !== "all" ? category : undefined,
        city: city !== "all" ? city : undefined,
        listingType: listingType !== "all" ? listingType : undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
      });
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر البحث.");
    } finally {
      setLoading(false);
    }
  }, [q, category, city, listingType, minPrice, maxPrice]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      syncParams();
      void load();
    }, 300);
    return () => window.clearTimeout(t);
  }, [load, syncParams]);

  const resetFilters = () => {
    setQ("");
    setCategory("all");
    setCity("all");
    setListingType("all");
    setMinPrice("");
    setMaxPrice("");
  };

  const hasFilters =
    q || category !== "all" || city !== "all" || listingType !== "all" || minPrice || maxPrice;

  const summary = useMemo(() => {
    if (loading) return "جارٍ التحميل…";
    return `${items.length} إعلانًا`;
  }, [items.length, loading]);

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={Database}
          title="قاعدة البيانات غير مهيأة"
          description="انسخ .env.example إلى .env.local وضع مفاتيح Supabase ثم أعد تشغيل الخادم لعرض الإعلانات الحقيقية."
          action={
            <Link to="/auth">
              <Button variant="outline">صفحة الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-10 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-8 text-ink md:text-[28px] md:leading-10">
            تصفح الإعلانات
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{summary}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-line bg-card p-4 shadow-l1">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Label htmlFor="q" className="sr-only">
              بحث
            </Label>
            <Input
              id="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث بالعنوان أو الوصف…"
              className="ps-9"
            />
          </div>

          <div>
            <Label htmlFor="cat" className="sr-only">
              الفئة
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="cat" className="w-full">
                <SelectValue placeholder="الفئة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفئات</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="city" className="sr-only">
              المدينة
            </Label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger id="city" className="w-full">
                <SelectValue placeholder="المدينة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المدن</SelectItem>
                {CITIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="type" className="sr-only">
              النوع
            </Label>
            <Select
              value={listingType}
              onValueChange={(v) => setListingType(v as ListingType | "all")}
            >
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Label htmlFor="min" className="text-xs text-ink-muted">
              أقل سعر (ج.م)
            </Label>
            <Input
              id="min"
              type="number"
              min={0}
              step={1}
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div className="w-36">
            <Label htmlFor="max" className="text-xs text-ink-muted">
              أعلى سعر (ج.م)
            </Label>
            <Input
              id="max"
              type="number"
              min={0}
              step={1}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="أي"
              className="mt-1"
            />
          </div>
          {hasFilters && (
            <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
              <SlidersHorizontal className="size-4" />
              مسح الفلاتر
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CardSkeleton count={8} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="لا توجد نتائج"
          description="جرّب كلمات بحث أو فلاتر أخرى، أو كن أول من ينشر إعلانًا."
          action={
            <Link to="/owner?tab=add">
              <Button>
                <Loader2 className="hidden" />
                أضف إعلانك
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((l) => (
            <RealListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
