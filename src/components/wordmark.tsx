import { ArrowLeftRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "cn";

/** Typographic wordmark treatment for the prototype (no official logo asset provided). */
export function Wordmark({
  className,
  href = "/",
  size = "md",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: { box: "size-7", text: "text-lg", gap: "gap-1.5" },
    md: { box: "size-8", text: "text-xl", gap: "gap-2" },
    lg: { box: "size-11", text: "text-3xl", gap: "gap-2.5" },
  }[size];

  return (
    <Link
      to={href}
      aria-label="بدّال — الصفحة الرئيسية"
      className={cn("inline-flex items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/60 rounded", sizes.gap, className)}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-md border border-line bg-paper text-brand-deep",
          sizes.box,
        )}
      >
        <ArrowLeftRight className={size === "lg" ? "size-6" : "size-4"} strokeWidth={2.4} />
      </span>
      <span className={cn("font-bold leading-none tracking-tight", sizes.text)}>بدّال</span>
    </Link>
  );
}
