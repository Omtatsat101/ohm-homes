import { MapPin } from "lucide-react";

/**
 * Static, dependency-free map placeholder.
 *
 * No external script or token is loaded — this is a styled stand-in until a real
 * map provider is wired in. Mapbox GL JS is the chosen provider (see README);
 * swap this component's body for a `<Map>` once NEXT_PUBLIC_MAPBOX_TOKEN is set.
 */
export function MapPlaceholder({ count }: { count?: number }) {
  return (
    <div
      className="relative flex h-full min-h-[320px] w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-forest/5"
      role="img"
      aria-label="Map of listings — provider not yet connected"
    >
      {/* faint grid to read as a map without any network call */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--forest) / 0.12) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--forest) / 0.12) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <MapPin className="h-8 w-8 text-forest" aria-hidden="true" />
        <p className="text-sm font-semibold text-charcoal">
          Map of listings — Mapbox provider TBD
        </p>
        {typeof count === "number" && (
          <p className="text-xs text-muted-foreground">
            {count} {count === 1 ? "property" : "properties"} in view
          </p>
        )}
      </div>
    </div>
  );
}
