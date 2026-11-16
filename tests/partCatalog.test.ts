import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pool } from "pg";
import { PartCatalog } from "@/scripts/lib/partCatalog";
import { PartNetwork } from "@/scripts/lib/partNetwork";

type Coord = [number, number];

// Doubles that don't survive a careless round trip (more digits than a float, a
// negative zero), and a part that meets two others
const parts: Record<string, Coord[]> = {
  "9": [
    [14.123456789, 50.000000001],
    [14.2, 50.1],
  ],
  "10": [
    [14.2, 50.1],
    [-0, 50.2],
    [14.3, 50.3],
  ],
  "100": [
    [14.2, 50.1],
    [14.25, 50.05],
  ],
  // One coordinate, skipped by a per-route load
  "11": [[14.5, 50.5]],
};

const geoJsonRows = Object.entries(parts).map(([id, coordinates]) => ({
  id,
  // JSON.stringify writes -0 as 0, and ST_AsGeoJSON could write it as -0
  geometry_json: JSON.stringify({ type: "LineString", coordinates }).replace("[0,", "[-0,"),
}));

/** A stand-in for the database answering a catalog's pages, then a part load. */
function fakeDb(rows: { id: string; geometry_json?: string }[]): Pool {
  let pages = 0;
  return {
    query: async (sql: string) => {
      if (sql.includes("LIMIT")) return { rows: pages++ === 0 ? geoJsonRows : [] };
      return { rows };
    },
  } as unknown as Pool;
}

// The part load's order: text order, as `ORDER BY id` on `id::TEXT` gives
const loadOrder = ["10", "100", "11", "9"];

describe("PartCatalog", () => {
  test("a network loaded through it holds exactly what a GeoJSON load does", async () => {
    const catalog = await PartCatalog.load(fakeDb([]));
    assert.equal(catalog.size, 3);

    const byGeoJson = new PartNetwork();
    await byGeoJson.loadAround(
      fakeDb(loadOrder.map((id) => geoJsonRows.find((row) => row.id === id)!)),
      [[14.2, 50.1]],
      50000,
    );
    const byCatalog = new PartNetwork(catalog);
    await byCatalog.loadAround(fakeDb(loadOrder.map((id) => ({ id }))), [[14.2, 50.1]], 50000);

    for (const id of Object.keys(parts)) {
      assert.deepStrictEqual(byCatalog.get(id), byGeoJson.get(id), `part ${id}`);
      assert.deepStrictEqual(byCatalog.connected(id), byGeoJson.connected(id), `neighbours ${id}`);
    }
    assert.ok(Object.is(byCatalog.get("10")!.coordinates[1][0], -0));
    assert.deepStrictEqual(
      byCatalog.partsContaining([14.2, 50.1], 1),
      byGeoJson.partsContaining([14.2, 50.1], 1),
    );
    assert.deepStrictEqual(byCatalog.partsContaining([14.2, 50.1], 1), ["10", "100", "9"]);
  });

  test("each load gets coordinates of its own", async () => {
    const catalog = await PartCatalog.load(fakeDb([]));
    const first = catalog.part("9")!;
    first.coordinates[0][0] = 0;
    assert.equal(catalog.part("9")!.coordinates[0][0], 14.123456789);
  });

  test("refuses a part added after it was loaded", async () => {
    const catalog = await PartCatalog.load(fakeDb([]));
    assert.equal(catalog.part("11"), null);
    assert.throws(() => catalog.part("12"), /added after the part catalog was loaded/);
  });
});
