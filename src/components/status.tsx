import { CircleCheck, Clock3, X } from "lucide-react";
import { cn } from "cn";
import type { ListingStatus, RequestStatus } from "@/lib/types";
import { LISTING_STATUS_LABEL, REQUEST_STATUS_LABEL } from "@/lib/types";

type Tone = "neutral" | "info" | "success" | "warn" | "danger" | "brand";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[#f1f5f9] text-ink-muted border-line",
  info: "bg-brand-soft text-success-ink border-brand-line",
  success: "bg-success-soft text-success-ink border-brand-line",
  warn: "bg-warn-soft text-gold-deep border-warn-line",
  danger: "bg-[#ffdad6] text-[#93000a] border-destructive/30",
  brand: "bg-success-ink text-white border-success-ink",
};

export function ListingStatusPill({
  status,
  className,
}: {
  status: ListingStatus;
  className?: string;
}) {
  const tone: Tone =
    status === "published"
      ? "success"
      : status === "draft"
        ? "warn"
        : status === "archived"
          ? "danger"
          : status === "blocked"
            ? "danger"
            : "neutral";
  const published = status === "published";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {published ? <CircleCheck className="size-3.5" /> : <Clock3 className="size-3.5" />}
      {LISTING_STATUS_LABEL[status]}
    </span>
  );
}

const requestTone: Record<RequestStatus, Tone> = {
  pending: "warn",
  accepted: "success",
  rejected: "danger",
  cancelled: "neutral",
  completed: "brand",
  disputed: "danger",
};

export function RequestStatusPill({
  status,
  className,
}: {
  status: RequestStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[requestTone[status]],
        className,
      )}
    >
      {status === "accepted" ? (
        <CircleCheck className="size-3.5" />
      ) : status === "rejected" ? (
        <X className="size-3.5" />
      ) : (
        <Clock3 className="size-3.5" />
      )}
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}
