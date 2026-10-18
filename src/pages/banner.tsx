import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { listMyBannerCampaigns, submitBannerCampaign } from "@/lib/saas";
import { fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";

const SLOTS = [
  { id: "home_top", label: "أعلى الصفحة الرئيسية" },
  { id: "search_sidebar", label: "جانب صفحة البحث" },
  { id: "category_header", label: "أعلى الفئة" },
];

export function BannerPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [advertiser, setAdvertiser] = useState("");
  const [contact, setContact] = useState("");
  const [url, setUrl] = useState("");
  const [slot, setSlot] = useState("home_top");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const rows = await listMyBannerCampaigns();
    setCampaigns(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advertiser.trim() || !contact.trim()) {
      setError("اسم المعلن وبيانات التواصل مطلوبان.");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await submitBannerCampaign({
        advertiser_name: advertiser.trim(),
        contact_info: contact.trim(),
        destination_url: url.trim() || undefined,
        banner_slot: slot,
        start_date: start || undefined,
        end_date: end || undefined,
      });
      setFlash("تم إرسال طلب الإعلان التجاري — بانتظار مراجعة الإدارة.");
      setAdvertiser("");
      setContact("");
      setUrl("");
      setStart("");
      setEnd("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-ink-muted">سجّل دخولك لطلب إعلان تجاري.</p>
        <Button className="mt-4" asChild>
          <Link to="/auth">تسجيل الدخول</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-ink">إعلانات الشركات (بانرات)</h1>
      <p className="mt-1 text-sm text-ink-muted">
        اطلب مساحة إعلانية لشركتك أو متجرك — تُراجع الإدارة وتتواصل معك للسعر النهائي.
      </p>

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

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-line bg-card p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="adv-name">اسم المعلن *</Label>
            <Input id="adv-name" value={advertiser} onChange={(e) => setAdvertiser(e.target.value)} placeholder="اسم الشركة أو المتجر" />
          </div>
          <div>
            <Label htmlFor="adv-contact">بيانات التواصل *</Label>
            <Input id="adv-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="بريد / واتساب / تليفون" />
          </div>
        </div>
        <div>
          <Label htmlFor="adv-url">رابط الإعلان (اختياري)</Label>
          <Input id="adv-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" dir="ltr" />
        </div>
        <div>
          <Label>الموضع الإعلاني</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlot(s.id)}
                className={`rounded-md border-2 px-3 py-1.5 text-sm font-semibold transition ${
                  slot === s.id ? "border-brand bg-brand/5 text-brand-deep" : "border-line text-ink-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="adv-start">تاريخ البداية</Label>
            <Input id="adv-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="adv-end">تاريخ النهاية</Label>
            <Input id="adv-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          <Megaphone className="size-4" />
          إرسال طلب الإعلان
        </Button>
      </form>

      {/* My campaigns */}
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-bold text-ink">طلباتي السابقة</h2>
        {loading ? (
          <p className="text-sm text-ink-muted">
            <Loader2 className="inline size-4 animate-spin" /> جارٍ التحميل…
          </p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-ink-muted">لا توجد طلبات بعد.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id as string} className="flex items-center justify-between rounded-lg border border-line bg-card p-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">{c.advertiser_name as string}</p>
                  <p className="text-xs text-ink-muted">
                    {SLOTS.find((s) => s.id === c.banner_slot)?.label ?? (c.banner_slot as string)}
                    {c.start_date ? ` · من ${fmtShortDate(c.start_date as string)}` : ""}
                  </p>
                </div>
                <Badge variant={c.status === "approved" || c.status === "active" ? "default" : "secondary"}>
                  {c.status === "pending" ? "قيد المراجعة" : c.status === "approved" ? "مقبول" : c.status === "rejected" ? "مرفوض" : c.status === "active" ? "نشط" : c.status === "expired" ? "منتهي" : (c.status as string)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-6 rounded-md border border-warn-line bg-warn-soft p-3 text-xs text-gold-deep">
        السعر النهائي يُحدد من الإدارة حسب المساحة والمدة وبيانات الزيارات — لا يوجد سعر ثابت للبانرات.
      </p>
    </div>
  );
}
