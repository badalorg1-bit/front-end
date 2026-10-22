import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Loader2, MapPin, Package, Power, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { LISTING_TYPE_LABEL, listingPriceLabel } from "@/lib/types";
import type { ChatProduct } from "@/lib/chat";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  products?: ChatProduct[];
};

export const QUICK_CHIPS = [
  "عايز أستأجر بسرعة",
  "إزاي الدفع والضمان؟",
  "إيه الفئات المتاحة؟",
] as const;

type ChatPanelProps = {
  messages: UiMessage[];
  sending: boolean;
  error: "network" | "rate" | null;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  onClose: () => void;
  onEndChat: () => void;
};

function ProductRow({ p }: { p: ChatProduct }) {
  return (
    <Link
      to={`/listing/${p.id}`}
      className="flex gap-2.5 rounded-lg border border-line bg-card p-2 outline-none transition-colors hover:border-brand/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {p.image_url ? (
          <img
            src={p.image_url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Package className="size-5 text-ink-muted" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
          <MapPin className="size-3 shrink-0" />
          <span className="truncate">{p.city}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{LISTING_TYPE_LABEL[p.listing_type]}</span>
        </p>
        <p className="mt-1 text-sm font-bold text-success-ink">
          {listingPriceLabel({
            listing_type: p.listing_type,
            rental_price: p.rental_price,
            rental_unit: p.rental_unit,
            sale_price: p.sale_price,
            deposit: 0,
          })}
        </p>
      </div>
    </Link>
  );
}

export function ChatPanel({
  messages,
  sending,
  error,
  draft,
  onDraftChange,
  onSend,
  onRetry,
  onClose,
  onEndChat,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, error]);

  const showChips = messages.length <= 1 && !sending;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-l3 sm:rounded-3xl">
      <header className="flex items-center gap-2.5 bg-brand-deep px-4 py-3 text-paper">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-white">
          <span className="text-sm font-bold" aria-hidden="true">
            ب
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">مساعد بينا</h2>
          <p className="text-xs text-paper/70">أساعدك تلاقي المنتج المناسب — مجانًا</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onEndChat}
          aria-label="إنهاء المحادثة وبدء محادثة جديدة"
          className="text-paper hover:bg-white/10 hover:text-paper"
        >
          <Power className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="إغلاق المساعد"
          className="text-paper hover:bg-white/10 hover:text-paper"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div
        ref={scrollRef}
        aria-live="polite"
        className="flex-1 min-h-0 space-y-2.5 overflow-y-auto p-3"
      >
        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "ms-auto rounded-be-md bg-brand-deep text-paper"
                  : "me-auto rounded-bs-md border border-line bg-muted text-ink",
              )}
            >
              {m.text}
            </div>
            {m.products && m.products.length > 0 && (
              <div className="me-auto space-y-1.5">
                {m.products.map((p) => (
                  <ProductRow key={p.id} p={p} />
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="me-auto inline-flex items-center gap-1.5 rounded-2xl rounded-bs-md border border-line bg-muted px-3.5 py-2.5 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" />
            بيدورلك على المنتجات…
          </div>
        )}

        {error && (
          <div className="me-auto flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bs-md border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              {error === "rate"
                ? "كفاية لحظات ⏳ انتظر شوية واسأل تاني."
                : "حصلت مشكلة في الاتصال — جرّب تاني."}
              <Button
                variant="ghost"
                size="xs"
                onClick={onRetry}
                className="mt-1.5 gap-1 text-destructive hover:bg-destructive/10"
              >
                <RotateCcw className="size-3" />
                إعادة المحاولة
              </Button>
            </div>
          </div>
        )}
      </div>

      {showChips && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onSend(chip)}
              className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink outline-none transition-colors hover:border-brand/60 hover:text-success-ink focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(draft);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(draft);
            }
          }}
          maxLength={500}
          enterKeyHint="send"
          aria-label="اكتب سؤالك"
          placeholder="اكتب سؤالك هنا…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button
          type="submit"
          variant="success"
          size="icon"
          disabled={sending || !draft.trim()}
          aria-label="إرسال"
        >
          <Send className="size-4 scale-x-[-1]" />
        </Button>
      </form>
    </div>
  );
}
