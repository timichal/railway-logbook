/**
 * The route tile URL (`shared/map/tileSources.ts`). Only a URL carrying the tile's
 * version may reach the source Martin serves `immutable`, and Martin caches it
 * under the raw query string, so the parameters' order is part of the contract.
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

test("the version comes before the country filter", () => {
  assert.equal(
    railwayRoutesTileUrl(BASE, { version: "0123abcd", selectedCountries: ["CZ", "SK"] }),
    `${BASE}/railway_routes_tile_versioned/{z}/{x}/{y}?v=0123abcd&selected_countries=${encodeURIComponent('["CZ","SK"]')}`,
  );
});

test("without a version the route tile stays on the uncached source", () => {
  assert.equal(railwayRoutesTileUrl(BASE), `${BASE}/railway_routes_tile/{z}/{x}/{y}`);
  assert.equal(
    railwayRoutesTileUrl(BASE, { cacheBuster: 42 }),
    `${BASE}/railway_routes_tile/{z}/{x}/{y}?v=42`,
  );
});
