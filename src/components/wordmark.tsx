import { Link } from "react-router-dom";
import { cn } from "cn";

const logoUrl = `${import.meta.env.BASE_URL}bayna-logo.jpg`;

/** Full Bayna logo lockup — provided brand asset (mark + "بينا" + "Bayna"). */
export function Wordmark({
  className,
  href = "/",
  size = "md",
}: {
  className?: string;
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const heights = { sm: "h-10", md: "h-14", lg: "h-20" }[size];

  return (
    <Link
      to={href}
      aria-label="بينا — الصفحة الرئيسية"
      className={cn(
        "inline-flex shrink-0 items-center rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
        className,
      )}
    >
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        width={665}
        height={1041}
        className={cn("h-auto w-auto object-contain", heights)}
      />
    </Link>
  );
}
