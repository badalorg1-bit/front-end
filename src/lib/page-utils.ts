import { isSupabaseConfigured } from "@/lib/supabase";

export function isSupabaseConfiguredSafe(): boolean {
  return isSupabaseConfigured;
}

export { fmtDate, fmtShortDate, fmtEGP, todayISO, addDaysISO } from "@/lib/format";
