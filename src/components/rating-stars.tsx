import { Star } from "lucide-react";

interface RatingStarsProps {
  value: number;
  count?: number;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;

export function RatingStars({ value, count, size = "md" }: RatingStarsProps) {
  const s = sizeMap[size];
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`التقييم ${value} من 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${s} ${
            i <= full ? "fill-gold-deep text-gold-deep" : "text-ink-muted/40"
          }`}
        />
      ))}
      {count != null && (
        <span className="ms-1 text-xs text-ink-muted tabular-nums">({count})</span>
      )}
    </span>
  );
}
