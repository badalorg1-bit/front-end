import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addListingAvailability,
  listListingAvailability,
  removeListingAvailability,
} from "@/lib/api";
import {
  AVAILABILITY_NOTE_MAX,
  validateAvailabilityWindow,
  type AvailabilityWindow,
} from "@/lib/types";
import { addDaysISO, fmtDate, todayISO } from "@/lib/format";

/**
 * Owner availability editor (SRS §6.1 «مواعيد التوافر» · §6.5 «تعديل
 * التوافر»). Zero windows = available all year; once ONE window exists the
 * server only accepts bookings fully inside the union of them (0032).
 * RLS on listing_availability scopes every row to the listing owner.
 */
export function AvailabilityEditor({ listingId }: { listingId: string }) {
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState(todayISO());
  const [endsOn, setEndsOn] = useState(addDaysISO(todayISO(), 6));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    listListingAvailability(listingId)
      .then((rows) => {
        if (!cancelled) setWindows(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر تحميل مواعيد التوافر.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  useEffect(() => reload(), [reload]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    const err = validateAvailabilityWindow(startsOn, endsOn, note);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await addListingAvailability(listingId, startsOn, endsOn, note);
      setFlash("أُضيفت فترة التوافر.");
      setNote("");
      reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "تعذر إضافة فترة التوافر.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    setBusy(true);
    setError(null);
    setFlash(null);
    setBusyId(id);
    try {
      await removeListingAvailability(id);
      setFlash("حُذفت فترة التوافر.");
      reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "تعذر حذف فترة التوافر.");
    } finally {
      setBusy(false);
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-secondary/30 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <CalendarClock className="size-3.5 text-success" />
        مواعيد التوافر
      </p>
      <p className="text-xs leading-5 text-ink-muted">
        لا توجد فترات = متاح طوال العام. بمجرد إضافة فترة، لا يُقبل الحجز إلا داخل الفترات
        المحدّدة (تحقق الخادم).
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" />
          جارٍ التحميل…
        </p>
      ) : windows.length === 0 ? (
        <p className="rounded border border-dashed border-line p-2.5 text-xs text-ink-muted">
          لا توجد قيود — هذا الإعلان متاح للحجز طوال العام.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {windows.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-card px-2.5 py-1.5 text-xs"
            >
              <span className="text-ink">
                {fmtDate(w.starts_on)} ← {fmtDate(w.ends_on)}
                {w.note && <span className="text-ink-muted"> — {w.note}</span>}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label="حذف فترة التوافر"
                disabled={busy || busyId === w.id}
                onClick={() => void onRemove(w.id)}
              >
                {busyId === w.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                حذف
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <div>
          <Label className="text-xs">من</Label>
          <Input
            type="date"
            value={startsOn}
            min={todayISO()}
            onChange={(e) => setStartsOn(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">إلى</Label>
          <Input
            type="date"
            value={endsOn}
            min={startsOn || todayISO()}
            onChange={(e) => setEndsOn(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">ملاحظة (اختياري)</Label>
          <Input
            value={note}
            maxLength={AVAILABILITY_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: متاح مساءً فقط"
            className="h-8 text-xs"
          />
        </div>
        <Button size="sm" disabled={busy} className="self-end" aria-label="إضافة فترة توافر">
          {busy && <Loader2 className="size-3 animate-spin" />}
          <Plus className="size-3.5" />
          إضافة
        </Button>
      </form>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {flash && <p className="text-xs text-success-ink">{flash}</p>}
    </div>
  );
}
