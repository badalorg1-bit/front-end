import { Link } from "react-router-dom";
import { cn } from "cn";

/** Bayna brand mark — two abstract people in a circular embrace (BRAND.md). */
export function BaynaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable="false"
      className={className}
    >
      <circle cx="21" cy="15" r="9" fill="#60a5fa" />
      <circle cx="43" cy="15" r="9" fill="#2563eb" />
      <path
        d="M15 27C6 36 9 55 31 56"
        stroke="#60a5fa"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <path
        d="M49 27c9 9 6 28-16 29"
        stroke="#2563eb"
        strokeWidth="11"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Wordmark: Bayna mark chip + "بينا". */
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
    sm: { box: "size-7 rounded-md", text: "text-lg" },
    md: { box: "size-8 rounded-md", text: "text-xl" },
    lg: { box: "size-11 rounded-lg", text: "text-3xl" },
  }[size];
  const gap = { sm: "gap-1.5", md: "gap-2", lg: "gap-2.5" }[size];

  return (
    <Link
      to={href}
      aria-label="بينا — الصفحة الرئيسية"
      className={cn(
        "inline-flex items-center rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
        gap,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center border border-line bg-paper p-[2px]",
          sizes.box,
        )}
      >
        <BaynaMark className="h-full w-full" />
      </span>
      <span className={cn("font-bold leading-none tracking-tight", sizes.text)}>
        بينا
      </span>
    </Link>
  );
}
