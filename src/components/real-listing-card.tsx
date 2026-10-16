import { Link } from "react-router-dom";
import { MapPin, Repeat, Tag, CalendarDays } from "lucide-react";
import { cn } from "cn";
import { fmtShortDate } from "@/lib/format";
import { LISTING_TYPE_LABEL, listingPriceLabel, type ListingWithImages } from "@/lib/types";

const typeIcon = {
  rent: CalendarDays,
  sale: Tag,
  swap: Repeat,
} as const;

export function RealListingCard({
  listing,
  className,
}: {
  listing: ListingWithImages;
  className?: string;
}) {
  const Icon = typeIcon[listing.listing_type];
  const cover = listing.images[0];

  return (
    <Link
      to={`/listing/${listing.id}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-l1 transition-colors hover:border-brand/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
        className,
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {cover ? (
          <img
            src={cover}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-muted">
            <Icon className="size-8" />
          </div>
        )}
        <span className="absolute top-2 start-2 rounded-full border border-line bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-ink">
          {listing.condition}
        </span>
        <span className="absolute top-2 end-2 inline-flex items-center gap-1 rounded bg-success-ink px-2 py-0.5 text-[11px] font-semibold text-white">
          <Icon className="size-3" />
          {LISTING_TYPE_LABEL[listing.listing_type]}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <h3 className="line-clamp-1 text-sm font-semibold text-ink group-hover:text-success-ink">
          {listing.title}
        </h3>

        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <MapPin className="size-3.5 shrink-0" />
          <span className="line-clamp-1">
            {listing.city}
            {listing.district ? ` — ${listing.district}` : ""}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-ink">{listingPriceLabel(listing)}</span>
          <span className="text-[11px] text-ink-muted">
            {fmtShortDate(listing.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
