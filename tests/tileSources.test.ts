/**
 * The route tile URL (`shared/map/tileSources.ts`). Only a URL carrying the tile's
 * version may reach the source Martin serves `immutable`, and Martin caches it
 * under the raw query string, so the URL carries the version and nothing else.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { railwayRoutesTileUrl } from "@/lib/shared/map/tileSources";

const BASE = "https://example.org/tiles";

test("a versioned route tile URL names the cached source", () => {
  assert.equal(
    railwayRoutesTileUrl(BASE, { version: "0123abcd" }),
    `${BASE}/railway_routes_tile_versioned/{z}/{x}/{y}?v=0123abcd`,
  );
});

test("without a version the route tile stays on the uncached source", () => {
  assert.equal(railwayRoutesTileUrl(BASE), `${BASE}/railway_routes_tile/{z}/{x}/{y}`);
  assert.equal(
    railwayRoutesTileUrl(BASE, { cacheBuster: 42 }),
    `${BASE}/railway_routes_tile/{z}/{x}/{y}?v=42`,
  );
});
