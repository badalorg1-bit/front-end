import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Inbox,
  Loader2,
  MessageCircle,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import {
  getConversationMessages,
  listConversations,
  openConversation,
  sendMessage,
  type ConversationRow,
  type MessageRow,
} from "@/lib/api";
import { fmtShortDate } from "@/lib/format";
import { useAuth } from "@/store/auth";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} يوم`;
  return fmtShortDate(iso);
}

/** Inbox: list of conversations. */
export function MessagesPage() {
  const { user, configured } = useAuth();
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!configured || !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listConversations()
      .then((rows) => {
        setItems(rows);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "تعذر تحميل الرسائل."))
      .finally(() => setLoading(false));
  }, [configured, user]);

  useEffect(load, [load]);

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="الخدمة غير متصلة" description="أضف إعدادات Supabase في .env.local." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول لعرض رسائلك"
          description="المحادثات متاحة بين مستخدمي المنصة فقط."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold text-ink">الرسائل</h1>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="لا توجد محادثات بعد"
          description="افتح أي إعلان واضغط «مراسلة المالك» لبدء محادثة."
          action={
            <Link to="/search">
              <Button variant="outline">تصفح الإعلانات</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/messages/${c.id}`}
                className="flex items-start gap-3 rounded-xl border border-line bg-card p-4 transition-colors hover:border-brand-line hover:bg-brand-soft/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c.other_avatar ? (
                  <img
                    src={c.other_avatar}
                    alt=""
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-ink">
                    <MessageCircle className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-semibold text-ink">{c.other_name ?? "مستخدم"}</p>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {relativeTime(c.last_message_at)}
                    </span>
                  </div>
                  {c.listing_title && (
                    <p className="mt-0.5 truncate text-xs text-success-ink">
                      بخصوص: {c.listing_title}
                    </p>
                  )}
                  <p className="mt-1 truncate text-sm text-ink-muted">{c.last_body ?? "…"}</p>
                </div>
                {c.unread_count > 0 && (
                  <span className="mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-success-ink text-[11px] font-bold text-white">
                    {c.unread_count > 9 ? "9+" : c.unread_count}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Thread view for one conversation with polling. */
export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user, configured } = useAuth();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    if (!id || !configured || !user) return;
    getConversationMessages(id)
      .then((rows) => {
        setMessages(rows);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "تعذر تحميل المحادثة."))
      .finally(() => setLoading(false));
  }, [id, configured, user]);

  useEffect(() => {
    load();
    if (!id || !configured || !user) return;
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [load, id, configured, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const onSend = async () => {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(id, draft.trim());
      setDraft("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إرسال الرسالة.");
    } finally {
      setSending(false);
    }
  };

  if (!configured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="الخدمة غير متصلة" description="أضف إعدادات Supabase في .env.local." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="سجّل الدخول"
          description="المحادثات متاحة لمستخدمي المنصة فقط."
          action={
            <Link to="/auth">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col px-4 md:px-6 py-6">
      <Link
        to="/messages"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-success-ink outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ArrowRight className="size-4" />
        كل الرسائل
      </Link>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-muted">
                  ابدأ المحادثة برسالة…
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === user.id;
                  return (
                    <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={
                          mine
                            ? "max-w-[80%] rounded-2xl rounded-ss-md bg-success-ink px-3.5 py-2 text-sm leading-6 text-white"
                            : "max-w-[80%] rounded-2xl rounded-se-md bg-secondary px-3.5 py-2 text-sm leading-6 text-ink"
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-ink-muted"}`}>
                          {fmtShortDate(m.created_at)}
                          {mine && m.read_at ? " · تمت القراءة" : ""}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-line p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                  placeholder="اكتب رسالتك… (Enter للإرسال)"
                  rows={2}
                  maxLength={2000}
                  className="min-h-0 flex-1 resize-none"
                />
                <Button
                  onClick={() => void onSend()}
                  disabled={!draft.trim() || sending}
                  className="h-10 shrink-0"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  إرسال
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Redirect helper when arriving with ?with=userId&listing=id */
export function StartConversationPage() {
  const { user, configured } = useAuth();
  const navigate = useNavigate();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!configured) {
      setBusy(false);
      return;
    }
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    const withId = params.get("with");
    const listingId = params.get("listing");
    if (!withId) {
      navigate("/messages", { replace: true });
      return;
    }
    void (async () => {
      try {
        const convId = await openConversation(withId, listingId);
        navigate(`/messages/${convId}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذر فتح المحادثة.");
        setBusy(false);
      }
    })();
  }, [configured, user, navigate, params]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      {busy ? (
        <p className="flex items-center justify-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          جارٍ فتح المحادثة…
        </p>
      ) : (
        <EmptyState
          icon={ShieldAlert}
          title="تعذر فتح المحادثة"
          description={error ?? "حاول مرة أخرى."}
          action={
            <Link to="/messages">
              <Button variant="outline">الرجوع للرسائل</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
