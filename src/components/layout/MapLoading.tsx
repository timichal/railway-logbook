import type { MapStatus } from "@/lib/map/hooks/useMapLibre";
import { btn } from "@/lib/ui/buttonStyles";

/**
 * What a map shows while its client-only module loads (`dynamic(…, { loading })`),
 * and, through `MapPaneStatus`, over the pane while MapLibre itself loads.
 */
export default function MapLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  );
}

/**
 * Laid over a map pane until the map exists. MapLibre loads after the map
 * component's own chunk (`lib/map/maplibre.ts`), so the pane would otherwise sit
 * empty meanwhile, and say nothing at all if the load failed: a page left open
 * across a deploy asks for a chunk the server no longer has, and only a reload
 * gets the new one.
 */
export function MapPaneStatus({ status }: { status: MapStatus }) {
  if (status === "ready") return null;
  return (
    <div className="absolute inset-0">
      {status === "loading" ? (
        <MapLoading />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gray-100">
          <div className="text-gray-600">Couldn&apos;t load the map.</div>
          <button type="button" className={btn("primary", "md")} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
