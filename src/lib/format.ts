const num = new Intl.NumberFormat("ar-EG-u-nu-latn");
const dateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  day: "numeric",
  month: "short",
});

export function fmtNumber(n: number): string {
  return num.format(n);
}

export function fmtEGP(n: number): string {
  return `ج.م ${num.format(Math.round(n))}`;
}

function toDate(iso: string): Date {
  // Accept "YYYY-MM-DD" or full ISO timestamps from Postgres.
  return iso.includes("T") ? new Date(iso) : new Date(`${iso}T00:00:00`);
}

export function fmtDate(iso: string): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function fmtShortDate(iso: string): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : shortDateFmt.format(d);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function diffDays(from: string, to: string): number {
  const a = toDate(from).getTime();
  const b = toDate(to).getTime();
  return Math.round((b - a) / 86400000);
}

/** Label for a booking quantity row: عدد الأيام / عدد الساعات / عدد الأشهر. */
export function countLabel(unit: string): string {
  if (unit === "ساعة") return "عدد الساعات";
  if (unit === "شهر") return "عدد الأشهر";
  return "عدد الأيام";
}

/** Basic Arabic search normalization (hamza/alef, taa marbuta, yaa). */
export function normalizeAr(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}
