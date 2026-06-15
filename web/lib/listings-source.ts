/**
 * Pluggable listing source for ohm.homes.
 *
 * The rest of the app imports ONLY `getListings()` and the `Listing` type — it
 * never knows where the data comes from. That indirection is the adapter seam:
 * swap the body of `getListings()` (or the `ACTIVE_SOURCE` switch below) to plug
 * a real feed without touching any page or component.
 *
 * Roadmap for real data (see README "Pluggable listing source"):
 *   - SimplyRETS  — RESO-compliant MLS/IDX feed; requires brokerage MLS
 *                   membership + vendor credentials. The chosen primary source.
 *   - RentCast    — interim REST API for listings/AVM while MLS membership is
 *                   pending; good for a quick non-MLS launch.
 *   - RESO Web API — direct MLS Web API where a board exposes one.
 *
 * No external API is called here yet. `getListings()` returns 6 mock listings so
 * the UI is fully renderable offline. When wiring a real source, add an adapter
 * function (e.g. `fetchFromSimplyRETS`) that maps the provider payload into
 * `Listing[]`, then point `getListings()` at it. Keep the mock path as a
 * fallback for local dev / when no credentials are configured.
 */

export interface Listing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  lat: number;
  lng: number;
  imageUrl: string;
  status: "for-sale" | "pending" | "sold";
}

/**
 * Which source `getListings()` reads from. Wire env-driven selection here once a
 * real adapter exists, e.g.:
 *   const ACTIVE_SOURCE = process.env.LISTINGS_SOURCE ?? "mock";
 */
const ACTIVE_SOURCE: "mock" | "simplyrets" | "rentcast" =
  ((process.env.LISTINGS_SOURCE as "mock" | "simplyrets" | "rentcast") || "simplyrets");

const MOCK_LISTINGS: Listing[] = [
  {
    id: "ohm-1001",
    address: "418 Maple Ridge Dr",
    city: "Asheville",
    state: "NC",
    zip: "28803",
    price: 525000,
    beds: 3,
    baths: 2,
    sqft: 1840,
    lat: 35.5651,
    lng: -82.5212,
    imageUrl:
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=70",
    status: "for-sale",
  },
  {
    id: "ohm-1002",
    address: "27 Lakeshore Ct",
    city: "Boulder",
    state: "CO",
    zip: "80302",
    price: 1240000,
    beds: 4,
    baths: 3,
    sqft: 3120,
    lat: 40.015,
    lng: -105.2705,
    imageUrl:
      "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=70",
    status: "for-sale",
  },
  {
    id: "ohm-1003",
    address: "1109 Birchwood Ln",
    city: "Austin",
    state: "TX",
    zip: "78704",
    price: 689000,
    beds: 3,
    baths: 2,
    sqft: 2050,
    lat: 30.2449,
    lng: -97.7698,
    imageUrl:
      "https://images.unsplash.com/photo-1576941089067-2de3c901e126?auto=format&fit=crop&w=1200&q=70",
    status: "pending",
  },
  {
    id: "ohm-1004",
    address: "63 Harborview Ave",
    city: "Portland",
    state: "ME",
    zip: "04101",
    price: 845000,
    beds: 4,
    baths: 3,
    sqft: 2680,
    lat: 43.6591,
    lng: -70.2568,
    imageUrl:
      "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=1200&q=70",
    status: "for-sale",
  },
  {
    id: "ohm-1005",
    address: "550 Cedar Hollow Rd",
    city: "Bend",
    state: "OR",
    zip: "97703",
    price: 612000,
    beds: 3,
    baths: 2,
    sqft: 1975,
    lat: 44.0582,
    lng: -121.3153,
    imageUrl:
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=70",
    status: "for-sale",
  },
  {
    id: "ohm-1006",
    address: "8 Meadowbrook Way",
    city: "Burlington",
    state: "VT",
    zip: "05401",
    price: 459000,
    beds: 2,
    baths: 2,
    sqft: 1480,
    lat: 44.4759,
    lng: -73.2121,
    imageUrl:
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=70",
    status: "sold",
  },
];

// --- SimplyRETS adapter (RESO/MLS IDX) ---------------------------------------
// Defaults to the SimplyRETS public DEMO feed (sample MLS data) so real listings
// flow immediately. To show YOUR MLS listings, set SIMPLYRETS_API_KEY +
// SIMPLYRETS_API_SECRET (from your SimplyRETS account connected to your MLS feed)
// — no code change needed. btoa is used (Workers-native, no Node Buffer dep).
const RETS_USER = process.env.SIMPLYRETS_API_KEY || "simplyrets";
const RETS_PASS = process.env.SIMPLYRETS_API_SECRET || "simplyrets";

function mapStatus(s?: string): Listing["status"] {
  const v = (s || "").toLowerCase();
  if (v.includes("pend") || v.includes("contract")) return "pending";
  if (v.includes("clos") || v.includes("sold")) return "sold";
  return "for-sale";
}

async function fetchFromSimplyRETS(): Promise<Listing[]> {
  const auth = btoa(`${RETS_USER}:${RETS_PASS}`);
  const res = await fetch("https://api.simplyrets.com/properties?limit=24", {
    headers: { Authorization: `Basic ${auth}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`SimplyRETS ${res.status}`);
  const rows = (await res.json()) as any[];
  return (rows || []).map((p, i) => ({
    id: String(p.mlsId ?? p.listingId ?? `rets-${i}`),
    address: p.address?.full ?? p.address?.streetName ?? "Address available on request",
    city: p.address?.city ?? "",
    state: p.address?.state ?? "",
    zip: p.address?.postalCode ?? "",
    price: Number(p.listPrice ?? 0),
    beds: Number(p.property?.bedrooms ?? 0),
    baths: Number(p.property?.bathsFull ?? 0) + 0.5 * Number(p.property?.bathsHalf ?? 0),
    sqft: Number(p.property?.area ?? 0),
    lat: Number(p.geo?.lat ?? 0),
    lng: Number(p.geo?.lng ?? 0),
    imageUrl: (Array.isArray(p.photos) && p.photos[0]) || "",
    status: mapStatus(p.mls?.status),
  }));
}

/**
 * The single data entry point for the app. Pulls live MLS/IDX listings via the
 * active source; always falls back to mock so the UI renders even if the feed
 * is down or unconfigured.
 */
export async function getListings(): Promise<Listing[]> {
  try {
    if (ACTIVE_SOURCE === "simplyrets") {
      const live = await fetchFromSimplyRETS();
      if (live.length) return live;
    }
  } catch (e) {
    console.error("getListings: live source failed, falling back to mock —", e);
  }
  return MOCK_LISTINGS;
}

/** Convenience lookup for a future /listings/[id] detail page. */
export async function getListing(id: string): Promise<Listing | undefined> {
  const all = await getListings();
  return all.find((l) => l.id === id);
}
