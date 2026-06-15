import Link from "next/link";
import type { Metadata } from "next";
import { getListings } from "@/lib/listings-source";
import { MapPlaceholder } from "@/components/map-placeholder";
import { ListingCard } from "@/components/listing-card";

export const metadata: Metadata = {
  title: "Listings",
  description: "Browse homes for sale on ohm.homes.",
};

// Server Component: lists everything from the pluggable source, with the map.
export default async function ListingsPage() {
  const listings = await getListings();

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-bold text-forest">
            ohm.homes
          </Link>
          <p className="text-sm text-muted-foreground">
            {listings.length} {listings.length === 1 ? "home" : "homes"}
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[1fr_1.1fr]">
        {/* Results */}
        <section aria-label="Listing results" className="order-2 lg:order-1">
          <h1 className="mb-6 text-2xl font-bold text-charcoal">Homes for sale</h1>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>

        {/* Map — sticky alongside results on large screens */}
        <section
          aria-label="Map"
          className="order-1 lg:order-2 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]"
        >
          <MapPlaceholder count={listings.length} />
        </section>
      </div>
    </main>
  );
}
