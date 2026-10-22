import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChatError,
  clearChatHistory,
  loadChatHistory,
  postChat,
  pushChatHistory,
  type ChatHistoryEntry,
} from "@/lib/chat";
import { ChatPanel, type UiMessage } from "./ChatPanel";

const GREETING =
  "أهلاً 👋 أنا مساعد بينا — قولي عايز تأجر أو تشتري إيه، وأنا أدورلك على المنتجات المناسبة.";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<"network" | "rate" | null>(null);
  const lastRequestRef = useRef<{ message: string; history: ChatHistoryEntry[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessages((prev) =>
      prev.length ? prev : [{ id: "greeting", role: "assistant", text: GREETING }],
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(async (raw: string, opts?: { skipHistoryPush?: boolean }) => {
    const text = raw.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    setSending(true);

    const history = loadChatHistory();
    lastRequestRef.current = { message: text, history };

    if (!opts?.skipHistoryPush) {
      setMessages((prev) => [...prev, { id: uid(), role: "user", text }]);
    }

    try {
      const res = await postChat(text, history);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", text: res.reply, products: res.products },
      ]);
      pushChatHistory({ role: "user", text });
      pushChatHistory({ role: "model", text: res.reply });
      lastRequestRef.current = null;
    } catch (e) {
      setError(e instanceof ChatError && e.status === 429 ? "rate" : "network");
    } finally {
      setSending(false);
    }
  }, [sending]);

  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    if (last && !sending) void send(last.message, { skipHistoryPush: true });
  }, [send, sending]);

  const handleSend = useCallback(
    (text: string) => {
      void send(text);
    },
    [send],
  );

  const endChat = useCallback(() => {
    clearChatHistory();
    lastRequestRef.current = null;
    setDraft("");
    setError(null);
    setSending(false);
    setMessages([{ id: "greeting", role: "assistant", text: GREETING }]);
  }, []);

  return (
    <>
      {!open && (
        <div className="fixed bottom-4 end-4 z-50 sm:bottom-6 sm:end-6">
          <Button
            onClick={() => setOpen(true)}
            aria-label="افتح مساعد بينا"
            className="size-14 rounded-full bg-brand-deep text-paper shadow-l2 hover:bg-brand-ink"
          >
            <MessageCircle className="size-6" />
          </Button>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="مساعد بينا"
          className="fixed inset-x-2 bottom-2 top-16 z-50 sm:inset-auto sm:bottom-24 sm:end-6 sm:h-[min(34rem,calc(100dvh-8rem))] sm:w-[23rem]"
        >
          <ChatPanel
            messages={messages}
            sending={sending}
            error={error}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
            onRetry={retry}
            onClose={() => setOpen(false)}
            onEndChat={endChat}
          />
        </div>
      )}
    </>
  );
}
