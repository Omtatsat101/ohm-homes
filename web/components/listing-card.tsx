import { Bath, BedDouble, Ruler } from "lucide-react";
import type { Listing } from "@/lib/listings-source";

const STATUS_LABEL: Record<Listing["status"], string> = {
  "for-sale": "For sale",
  pending: "Pending",
  sold: "Sold",
};

function formatPrice(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Presentational card for a single listing. Server-renderable. */
export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {/* Plain <img> keeps this dependency-free; swap to next/image when a real
            image CDN host is configured in next.config.mjs remotePatterns. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.imageUrl}
          alt={`${listing.address}, ${listing.city}, ${listing.state}`}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <span className="absolute left-3 top-3 rounded-full bg-forest px-3 py-1 text-xs font-semibold text-white">
          {STATUS_LABEL[listing.status]}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <p className="text-xl font-bold text-charcoal">{formatPrice(listing.price)}</p>
        <p className="text-sm font-medium text-charcoal">{listing.address}</p>
        <p className="text-sm text-muted-foreground">
          {listing.city}, {listing.state} {listing.zip}
        </p>
        <div className="flex items-center gap-4 pt-2 text-sm text-charcoal">
          <span className="inline-flex items-center gap-1">
            <BedDouble className="h-4 w-4 text-forest" aria-hidden="true" />
            {listing.beds} bd
          </span>
          <span className="inline-flex items-center gap-1">
            <Bath className="h-4 w-4 text-forest" aria-hidden="true" />
            {listing.baths} ba
          </span>
          <span className="inline-flex items-center gap-1">
            <Ruler className="h-4 w-4 text-forest" aria-hidden="true" />
            {listing.sqft.toLocaleString()} sqft
          </span>
        </div>
      </div>
    </article>
  );
}
