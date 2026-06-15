import Link from "next/link";
import { getListings } from "@/lib/listings-source";
import { MapPlaceholder } from "@/components/map-placeholder";
import { ListingCard } from "@/components/listing-card";

// Server Component: pulls listings from the pluggable source at request time.
export default async function HomePage() {
  const listings = await getListings();
  const featured = listings.slice(0, 6);

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="bg-forest text-white">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-sand">
            ohm.homes
          </p>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            Find your next home
          </h1>
          <p className="mt-4 max-w-xl text-lg text-sand/90">
            Search homes on the map, filter by what matters, and discover the
            place that fits your life.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/listings"
              className="rounded-md bg-sand px-6 py-3 text-sm font-semibold text-charcoal transition-colors hover:bg-white"
            >
              Browse listings
            </Link>
            <Link
              href="/listings"
              className="rounded-md border border-sand/60 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              View map
            </Link>
          </div>
        </div>
      </section>

      {/* Map */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="mb-4 text-2xl font-bold text-charcoal">Explore the map</h2>
        <div className="h-[380px]">
          <MapPlaceholder count={listings.length} />
        </div>
      </section>

      {/* Featured listings */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold text-charcoal">Featured listings</h2>
          <Link
            href="/listings"
            className="text-sm font-semibold text-forest hover:underline"
          >
            See all →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </section>
    </main>
  );
}
