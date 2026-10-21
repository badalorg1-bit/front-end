import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { listMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/admin-api";
import { getSupabase } from "@/lib/supabase";
import { fmtShortDate } from "@/lib/requests-shared";
import { useAuth } from "@/store/auth";

type Note = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const { user, configured } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Note | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!user || !configured) return;
    setLoading(true);
    try {
      setItems(await listMyNotifications(user.id));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, configured]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: push new notifications the moment they are inserted (RLS-filtered server-side).
  useEffect(() => {
    if (!user || !configured) return;
    const channel = getSupabase()
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as Note;
          setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
          setToast(n);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 6000);
        },
      )
      .subscribe();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      void getSupabase().removeChannel(channel);
    };
  }, [user, configured]);

  if (!user || !configured) return null;

  const unread = items.filter((n) => !n.read_at).length;

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void openPanel()}
        className="relative inline-flex items-center gap-1.5 rounded-md border border-white/25 px-2 py-1.5 text-xs font-medium text-paper/90 transition-colors hover:border-white/50 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
        aria-label={unread ? `الإشعارات (${unread} غير مقروء)` : "الإشعارات"}
        title="الإشعارات"
      >
        <Bell className="size-3.5" />
        <span className="hidden sm:inline">إشعارات</span>
        {unread > 0 ? (
          <span className="absolute -top-1.5 -end-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        ) : null}
      </button>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 start-4 z-[60] w-80 rounded-xl border border-line bg-card p-3 shadow-l2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{toast.title}</p>
              {toast.body ? (
                <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-ink-muted">{toast.body}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-muted hover:text-ink"
              title="إغلاق"
              onClick={() => setToast(null)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/20"
            aria-label="إغلاق الإشعارات"
            onClick={() => setOpen(false)}
          />
          <div className="absolute end-0 z-50 mt-2 w-80 max-h-96 overflow-auto rounded-xl border border-line bg-card p-2 shadow-l2">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-sm font-semibold">الإشعارات</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink"
                  title="تعليم الكل كمقروء"
                  onClick={async () => {
                    await markAllNotificationsRead(user.id);
                    await load();
                  }}
                >
                  <CheckCheck className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink"
                  title="إغلاق"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {loading ? (
              <p className="px-2 py-6 text-center text-sm text-ink-muted">جارٍ التحميل…</p>
            ) : items.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-ink-muted">لا توجد إشعارات.</p>
            ) : (
              <ul className="space-y-1">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`w-full rounded-lg px-2 py-2 text-start transition-colors hover:bg-muted ${
                        n.read_at ? "opacity-70" : "bg-brand/5"
                      }`}
                      onClick={async () => {
                        if (!n.read_at) {
                          await markNotificationRead(n.id);
                          await load();
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        <span className="shrink-0 text-[10px] text-ink-muted">
                          {fmtShortDate(n.created_at)}
                        </span>
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-ink-muted">{n.body}</p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
