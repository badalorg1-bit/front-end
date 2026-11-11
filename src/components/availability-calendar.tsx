import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, SearchCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkListingAvailability } from "@/lib/api";
import { AVAILABILITY_REASON_LABEL, type AvailabilityCheck } from "@/lib/types";
import { addDaysISO, fmtDate, todayISO } from "@/lib/format";

/**
 * SRS §4.8 item 9 «تقويم التوافر» + §4.9 server-side pre-check: the
 * listing page shows the owner's windows and the booked periods, and the
 * visitor can probe a specific range BEFORE opening a booking request.
 * The verdict comes from check_listing_availability (0032) — the server
 * is authoritative; the GiST constraint still backstops any race.
 */
export function AvailabilityCalendar({ listingId }: { listingId: string }) {
  const [check, setCheck] = useState<AvailabilityCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(addDaysISO(todayISO(), 1));
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<AvailabilityCheck | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    checkListingAvailability(listingId)
      .then((r) => {
        if (!cancelled) setCheck(r);
      })
      .catch(() => {
        if (!cancelled) setCheck(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  useEffect(() => load(), [load]);

  const runProbe = async () => {
    setChecking(true);
    setProbeError(null);
    setVerdict(null);
    try {
      setVerdict(await checkListingAvailability(listingId, start, end));
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : "تعذر فحص التوافر.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-card p-5 shadow-l1">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <CalendarDays className="size-4 text-success" />
        تقويم التوافر
      </h2>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" />
          جارٍ تحميل التوافر…
        </p>
      ) : !check ? (
        <p className="mt-3 text-xs leading-5 text-ink-muted">
          تعذر تحميل التوافر — يمكنك محاولة فحص فترة محددة بالأسفل.
        </p>
      ) : (
        <div className="mt-3 space-y-3 text-xs leading-5">
          {/* owner windows (§6.1 «مواعيد التوافر») */}
          {check.windows.length === 0 ? (
            <p className="text-ink-muted">
              <b className="text-ink">متاح طوال العام:</b> لم يحدد المالك مواعيد تقييدية على هذا
              الإعلان.
            </p>
          ) : (
            <div>
              <b className="text-ink">مواعيد التوافر المحدّدة:</b>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {check.windows.map((w, i) => (
                  <li
                    key={i}
                    className="rounded border border-success/40 bg-success-soft px-2 py-1 text-ink"
                  >
                    {fmtDate(w.starts_on)} ← {fmtDate(w.ends_on)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* booked periods (accepted + disputed hold the slot, §17.7) */}
          <div>
            <b className="text-ink">الفترات المحجوزة:</b>
            {check.booked.length === 0 ? (
              <p className="text-ink-muted">لا توجد حجوزات مؤكدة أو نزاعات قيد التنفيذ حاليًا.</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {check.booked.map((b, i) => (
                  <li
                    key={i}
                    className="rounded border border-warn-line bg-warn-soft px-2 py-1 text-gold-deep"
                  >
                    محجوز: {fmtDate(b.starts_on)} ← {fmtDate(b.ends_on)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* §4.9 pre-check: probe a range before requesting */}
          <div className="rounded-lg border border-line bg-secondary/40 p-3">
            <p className="mb-2 font-semibold text-ink">فحص فترة قبل الحجز</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-36">
                <Label className="text-xs">من</Label>
                <Input
                  type="date"
                  value={start}
                  min={todayISO()}
                  onChange={(e) => setStart(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-36">
                <Label className="text-xs">إلى</Label>
                <Input
                  type="date"
                  value={end}
                  min={start || todayISO()}
                  onChange={(e) => setEnd(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" disabled={checking} onClick={() => void runProbe()}>
                {checking && <Loader2 className="size-3 animate-spin" />}
                <SearchCheck className="size-3.5" />
                فحص التوافر
              </Button>
            </div>

            {probeError && <p className="mt-2 text-destructive">{probeError}</p>}

            {verdict && (
              <div
                className={`mt-2 rounded p-2.5 leading-6 ${
                  verdict.available
                    ? "border border-success/40 bg-success-soft text-success-ink"
                    : "border border-destructive/40 bg-destructive/10 text-destructive"
                }`}
                role="status"
              >
                {verdict.available ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 shrink-0" />
                    متاح في هذه الفترة — يمكنك إرسال طلب الحجز.
                  </span>
                ) : (
                  <span className="flex items-start gap-1.5">
                    <XCircle className="mt-1 size-4 shrink-0" />
                    <span>
                      غير متاح:{" "}
                      {verdict.reason
                        ? AVAILABILITY_REASON_LABEL[verdict.reason]
                        : "هذه الفترة غير متاحة حاليًا."}
                      {verdict.conflicts.length > 0 && (
                        <span className="mt-1 block text-xs">
                          {verdict.conflicts.map((c, i) => (
                            <span key={i} className="block" dir="rtl">
                              محجوز من {fmtDate(c.starts_on)} إلى {fmtDate(c.ends_on)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
