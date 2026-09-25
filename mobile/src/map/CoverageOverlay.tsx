/**
 * The ridden-stretch overlay, as a sibling of the route source.
 *
 * What it looks like is `@shared/map/coverageLayer` — the same source data, filter and
 * layer the web app hands to `addLayer`. Only the mechanism differs: there the source
 * is added and its data set on a live map (`useCoverageOverlay`), here it is a
 * `<GeoJSONSource>` whose `data` prop re-renders.
 *
 * `beforeId="stations"` is what the web app's `moveLayer` is for: the stretches belong
 * above the route lines and below the station dots, and therefore below the highlight
 * sets, which sit on top of everything. Mounting order cannot say that on its own,
 * since a layer that arrives once its fetch resolves is appended to the top.
 *
 * Which is also why this is **mounted with the map and holds an empty collection when
 * there is nothing to draw**, rather than appearing when the stretches arrive. Both
 * this and a highlight set ask to be inserted below `stations`, so the one inserted
 * later lands on top of the other — and a set that is already on screen does not
 * re-insert itself when a later layer slips above it. Inserting this one during the
 * map's own build settles the order once: every highlight set mounts afterwards, and
 * therefore above.
 *
 * Refetched on the log version, for the same reason the route tile is re-requested on
 * it: logging a journey is exactly what changes which stretches are ridden.
 */
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { COVERAGE_SOURCE_ID, coverageData, createCoverageLayer } from "@shared/map/coverageLayer";
import type { CoveredStretch } from "@shared/types";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import * as api from "@/api/endpoints";
import { useLogVersion } from "@/logbook/logVersion";

export function CoverageOverlay({ countries }: { countries: string[] }): ReactNode {
  const logVersion = useLogVersion();
  const [stretches, setStretches] = useState<CoveredStretch[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what refetches the stretches after a journey is logged.
  useEffect(() => {
    const controller = new AbortController();
    api
      .coverage(controller.signal)
      .then(setStretches)
      .catch(() => {
        // The overlay is a refinement of colours the route tile already carries: a
        // half-ridden route without it reads as partial rather than as half done,
        // which is wrong but not misleading. Not worth an error over the map.
      });
    return () => controller.abort();
  }, [logVersion]);

  const data = useMemo(() => coverageData(stretches), [stretches]);
  const layer = useMemo(() => createCoverageLayer(countries), [countries]);

  return (
    <GeoJSONSource id={COVERAGE_SOURCE_ID} data={data}>
      <Layer {...layer} beforeId="stations" />
    </GeoJSONSource>
  );
}
