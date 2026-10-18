import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Database,
  ImagePlus,
  LayoutDashboard,
  ListPlus,
  Loader2,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import { ListingStatusPill, RequestStatusPill } from "@/components/status";
import { DirectPaymentSection } from "@/components/direct-payment";
import { WalletTab } from "@/components/wallet-tab";
import {
  CATEGORIES,
  CITIES,
  createListingWithImages,
  listIncomingRequests,
  listMyListings,
  setListingStatus,
} from "@/lib/api";
import {
  CONDITIONS,
  LISTING_TYPE_LABEL,
  REQUEST_TYPE_LABEL,
  RENTAL_UNITS,
  type Condition,
  type ListingType,
  type ListingWithImages,
  type RequestWithListing,
  type RentalUnit,
} from "@/lib/types";
import { MAX_IMAGES_PER_LISTING, validateImageFile } from "@/lib/supabase";
import { decideRequest, fmtDate, fmtShortDate } from "@/lib/requests-shared";
import { useAuth } from "@/store/auth";

const OWNER_TABS = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "listings", label: "إعلاناتي", icon: ClipboardList },
  { id: "incoming", label: "طلبات واردة", icon: CalendarClock },
  { id: "wallet", label: "محفظتي", icon: Wallet },
  { id: "add", label: "إضافة إعلان", icon: ListPlus },
] as const;

export function OwnerPage() {
  const { user, profile, configured } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "overview") as (typeof OWNER_TABS)[number]["id"];

  const [myListings, setMyListings] = useState<ListingWithImages[]>([]);
  const [incoming, setIncoming] = useState<RequestWithListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user || !configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([listMyListings(user.id), listIncomingRequests(user.id)])
      .then(([l, r]) => {
        setMyListings(l);
        setIncoming(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "تعذر تحميل البيانات."))
      .finally(() => setLoading(false));
  }, [user, configured]);

  useEffect(load, [load]);

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true });
  };

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={Database}
          title="قاعدة البيانات غير مهيأة"
          description="انسخ .env.example إلى .env.local وضع مفاتيح Supabase ثم أعد التشغيل."
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول للوحة المالك"
          description="تحتاج حسابًا لنشر الإعلانات وعرض الطلبات الواردة."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const pending = incoming.filter((r) => r.status === "pending");
  const publishedCount = myListings.filter((l) => l.status === "published").length;

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-10 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">مرحبًا، {profile?.display_name ?? "المالك"}</p>
          <h1 className="text-[22px] font-semibold leading-8 text-ink md:text-[28px] md:leading-10">
            لوحة المالك
          </h1>
        </div>
        <Link to="/owner?tab=add">
          <Button>
            <ListPlus className="size-4" />
            أضف إعلانًا
          </Button>
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-secondary p-1 sm:w-auto">
          {OWNER_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5 text-sm">
              <t.icon className="size-4" />
              {t.label}
              {t.id === "incoming" && pending.length > 0 && (
                <span className="rounded-full border border-warn-line bg-warn-soft px-1.5 text-[11px] font-semibold text-gold-deep">
                  {pending.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-ink-muted">إعلاناتي</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-brand-deep">
                  {myListings.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-ink-muted">منشورة</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-success-ink">
                  {publishedCount}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-ink-muted">طلبات بانتظار الرد</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gold-deep">
                  {pending.length}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="listings" className="mt-5">
          {loading ? (
            <LoadingSkeleton />
          ) : myListings.length === 0 ? (
            <EmptyState
              title="لا توجد إعلانات"
              description="ابدأ بنشر أول إعلان: إيجار أو بيع أو مقايضة."
              action={
                <Button onClick={() => setTab("add")}>إضافة إعلان</Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {myListings.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-card p-3.5"
                >
                  <div className="size-14 shrink-0 overflow-hidden rounded-md border border-line bg-muted">
                    {l.images[0] ? (
                      <img src={l.images[0]} alt="" className="size-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-44 flex-1">
                    <Link
                      to={`/listing/${l.id}`}
                      className="font-semibold text-ink hover:text-success-ink rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {l.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {LISTING_TYPE_LABEL[l.listing_type]} — {l.city} — {fmtShortDate(l.created_at)}
                    </p>
                  </div>
                  <ListingStatusPill status={l.status} />
                  <div className="flex gap-2">
                    {l.status === "published" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        disabled={busyId === l.id}
                        onClick={async () => {
                          setBusyId(l.id);
                          try {
                            await setListingStatus(l.id, "archived");
                            load();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        أرشفة
                      </Button>
                    )}
                    {l.status !== "published" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === l.id}
                        onClick={async () => {
                          setBusyId(l.id);
                          try {
                            await setListingStatus(l.id, "published");
                            load();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        إعادة النشر
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="incoming" className="mt-5">
          {loading ? (
            <LoadingSkeleton />
          ) : incoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="لا توجد طلبات واردة"
              description="عندما يرسل مستخدمون طلبات على إعلاناتك ستظهر هنا."
            />
          ) : (
            <ul className="space-y-3">
              {incoming.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-card p-4 shadow-l1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{r.listing?.title ?? "إعلان"}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        من {r.requester_name ?? "مستخدم"} — {REQUEST_TYPE_LABEL[r.request_type]}
                      </p>
                      {r.request_type === "rent" && r.rent_start && r.rent_end && (
                        <p className="mt-1 text-sm text-ink-muted">
                          الفترة: {fmtDate(r.rent_start)} — {fmtDate(r.rent_end)}
                        </p>
                      )}
                      {r.request_type === "swap" && r.offered_title && (
                        <p className="mt-1 text-sm text-ink-muted">يعرض: {r.offered_title}</p>
                      )}
                      {r.message && (
                        <p className="mt-2 rounded-lg bg-secondary p-2.5 text-sm leading-6 text-ink-muted">
                          {r.message}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <RequestStatusPill status={r.status} />
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="success"
                            disabled={busyId === r.id}
                            onClick={async () => {
                              setBusyId(r.id);
                              try {
                                await decideRequest(r.id, "accepted");
                                load();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "تعذر القبول.");
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            قبول
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10"
                            disabled={busyId === r.id}
                            onClick={async () => {
                              setBusyId(r.id);
                              try {
                                await decideRequest(r.id, "rejected");
                                load();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "تعذر الرفض.");
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            رفض
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {r.status === "accepted" && r.request_type !== "swap" && (
                    <DirectPaymentSection request={r} side="payee" onChanged={load} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="wallet" className="mt-5">
          <WalletTab userId={user.id} />
        </TabsContent>

        <TabsContent value="add" className="mt-5">
          <PublishListingForm userId={user.id} onDone={() => { load(); setTab("listings"); }} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PublishListingForm({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}) {
  const [listingType, setListingType] = useState<ListingType>("rent");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [city, setCity] = useState<string>(CITIES[0]);
  const [district, setDistrict] = useState("");
  const [condition, setCondition] = useState<Condition>("جيد");
  const [rentalPrice, setRentalPrice] = useState("");
  const [rentalUnit, setRentalUnit] = useState<RentalUnit>("يوم");
  const [salePrice, setSalePrice] = useState("");
  const [swapPreferences, setSwapPreferences] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewUrls]);

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_IMAGES_PER_LISTING) {
        setFormError(`الحد الأقصى ${MAX_IMAGES_PER_LISTING} صور.`);
        break;
      }
      const err = validateImageFile(f);
      if (err) {
        setFormError(err);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    setPreviewUrls(next.map((f) => URL.createObjectURL(f)));
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviewUrls((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const errs: Record<string, string> = {};
    if (title.trim().length < 3) errs.title = "العنوان قصير جدًا.";
    if (listingType === "rent") {
      const p = Number(rentalPrice);
      if (!Number.isInteger(p) || p < 0) errs.rentalPrice = "أدخل سعرًا صحيحًا بالجنيه.";
    }
    if (listingType === "sale") {
      const p = Number(salePrice);
      if (!Number.isInteger(p) || p < 0) errs.salePrice = "أدخل سعرًا صحيحًا بالجنيه.";
    }
    if (listingType === "swap" && swapPreferences.trim().length === 0) {
      errs.swapPreferences = "اكتب ما تفضّل مقايضته.";
    }
    const dep = Number(deposit);
    if (!Number.isInteger(dep) || dep < 0) errs.deposit = "التأمين يجب أن يكون عددًا صحيحًا.";
    if (files.length === 0) errs.images = "أضف صورة واحدة على الأقل.";

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      await createListingWithImages({
        owner_id: userId,
        title,
        description,
        listing_type: listingType,
        category,
        city,
        district: district || undefined,
        condition,
        rental_price: listingType === "rent" ? Number(rentalPrice) : null,
        rental_unit: listingType === "rent" ? rentalUnit : null,
        sale_price: listingType === "sale" ? Number(salePrice) : null,
        swap_preferences: listingType === "swap" ? swapPreferences : null,
        deposit: dep,
        files,
      });
      onDone();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر نشر الإعلان.");
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-xs text-destructive">{fieldErrors[key]}</p>
    ) : null;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-ink">إضافة إعلان جديد</CardTitle>
        <CardDescription>
          اختر نوع الإعلان وأدخل التفاصيل. الأسعار بالجنيه المصري (عدد صحيح).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>نوع الإعلان</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["rent", "sale", "swap"] as ListingType[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={listingType === t ? "default" : "outline"}
                  onClick={() => setListingType(t)}
                >
                  {LISTING_TYPE_LABEL[t]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">العنوان</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: كاميرا Sony A7 IV"
              required
              maxLength={120}
            />
            {field("title")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">الوصف</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={3000}
              placeholder="وصف الحالة، المحتويات، شروط الاستخدام…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الفئة</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المدينة</Label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district">المنطقة (اختياري)</Label>
              <Input
                id="district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label>الحالة</Label>
              <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {listingType === "rent" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="rp">سعر الإيجار (ج.م)</Label>
                <Input
                  id="rp"
                  type="number"
                  min={0}
                  step={1}
                  value={rentalPrice}
                  onChange={(e) => setRentalPrice(e.target.value)}
                  required
                />
                {field("rentalPrice")}
              </div>
              <div className="space-y-1.5">
                <Label>وحدة الإيجار</Label>
                <Select value={rentalUnit} onValueChange={(v) => setRentalUnit(v as RentalUnit)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RENTAL_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep">التأمين (ج.م)</Label>
                <Input
                  id="dep"
                  type="number"
                  min={0}
                  step={1}
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
                {field("deposit")}
              </div>
            </div>
          )}

          {listingType === "sale" && (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="sp">سعر البيع (ج.م)</Label>
              <Input
                id="sp"
                type="number"
                min={0}
                step={1}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                required
              />
              {field("salePrice")}
            </div>
          )}

          {listingType === "swap" && (
            <div className="space-y-1.5">
              <Label htmlFor="sw">ماذا تفضّل مقايضته؟</Label>
              <Textarea
                id="sw"
                value={swapPreferences}
                onChange={(e) => setSwapPreferences(e.target.value)}
                rows={3}
                placeholder="مثال: أفضّل مقايضته بلابتوب مك بوك أو كاميرا مع فتاحة…"
              />
              {field("swapPreferences")}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="images">الصور (حتى {MAX_IMAGES_PER_LISTING} صور، JPEG/PNG/WebP/GIF حتى 5MB)</Label>
            <input
              id="images"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              className="block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs file:me-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
            />
            {field("images")}
            {previewUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {previewUrls.map((url, i) => (
                  <div key={i} className="relative size-20 overflow-hidden rounded-md border border-line">
                    <img src={url} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label="حذف الصورة"
                      className="absolute top-0.5 end-0.5 rounded-full bg-ink/80 p-1 text-paper hover:bg-ink"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {formError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {formError}
            </p>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            <ImagePlus className="size-4" />
            نشر الإعلان
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
