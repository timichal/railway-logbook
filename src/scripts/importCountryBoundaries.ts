#!/usr/bin/env tsx
/**
 * Import OSM's country borders into `country_boundaries`, then correct the
 * countries stored on every route's and scenic line's ends.
 *
 * The borders are the `admin_level=2` relations with an ISO 3166-1 alpha-2 code
 * whose bounding box reaches a region (listed by Overpass), each taken as the
 * polygon Nominatim has already assembled from it (`lookup` with
 * `polygon_geojson`), clipped to the regions plus a margin and cut into small
 * pieces for the lookup (`countriesAt`, src/lib/countryBoundaries.ts). The
 * relations that only describe a border stretch ("France - España") carry no code
 * and are passed by. Borders hardly move, so this runs once per database and
 * again only when one does.
 *
 * Why Nominatim for the geometry: Overpass has to assemble a country from its
 * ways on every request, which takes minutes for a big one and runs into the
 * public instances' gateway timeouts (Russia never came through). Nominatim
 * answers from polygons it keeps, in a second or two, simplified to within
 * `SIMPLIFY_DEGREES` (about 2m). Its usage policy allows one request a second,
 * hence the pause between countries.
 *
 * All-or-nothing: every country is fetched before anything is replaced, and the
 * replacement and the corrected countries are one transaction. A country that
 * doesn't come back as a polygon stops the run, the table left as it was,
 * rather than leaving that country to country-coder, and so does a region's own
 * country missing from the list.
 *
 * Every route and scenic line is looked up again, closed and invalid ones
 * included: the coordinates stay as they are, only the label of the country
 * they lie in is corrected.
 *
 * Usage: npm run importCountryBoundaries
 * OVERPASS_URL names a single Overpass instance to list the countries with.
 */

import https from "node:https";
import type { PoolClient } from "pg";
import { countriesAt } from "../lib/countryBoundaries";
import pool from "../lib/db";
import { REGIONS } from "../lib/shared/regions";

const USER_AGENT = "railway-map-country-boundaries/1.0";

/** Tried in turn, a failed query moving on to the next. */
const OVERPASS_URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

const NOMINATIM_LOOKUP = "https://nominatim.openstreetmap.org/lookup";

/** Nominatim's simplification of the polygons, in degrees: ~2m. */
const SIMPLIFY_DEGREES = 0.00002;

/**
 * Kept around each region's box, so a point at its edge still has its border
 * on both sides.
 */
const MARGIN_DEGREES = 0.5;

/** Most vertices per stored piece. */
const PIECE_VERTICES = 255;

const ATTEMPTS = 6;

/**
 * How long a connection may sit silent before it counts as a failure and the
 * next attempt starts. Overpass says nothing while its query runs (up to the
 * listing's 180s), so well above that.
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type Box = { west: number; south: number; east: number; north: number };

const regionBoxes: Box[] = Object.values(REGIONS).map(
  ({ bounds: [[west, south], [east, north]] }) => ({
    west: west - MARGIN_DEGREES,
    south: south - MARGIN_DEGREES,
    east: east + MARGIN_DEGREES,
    north: north + MARGIN_DEGREES,
  }),
);

const regionsWKT = `MULTIPOLYGON(${regionBoxes
  .map(
    ({ west, south, east, north }) =>
      `((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`,
  )
  .join(",")})`;

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * One request, its answer read whole: a GET, or a POST of `form`. Through
 * node:https rather than fetch, which gives up on response headers after 300s.
 */
function request(url: string, form?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: form === undefined ? "GET" : "POST",
        headers: {
          "User-Agent": USER_AGENT,
          ...(form === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    req.setTimeout(IDLE_TIMEOUT_MS, () =>
      req.destroy(new Error(`no answer for ${IDLE_TIMEOUT_MS / 1000}s`)),
    );
    req.on("error", reject);
    req.end(form);
  });
}

/**
 * Asks until a JSON answer comes back that `accept` takes, waiting longer after
 * each failure. `urls` are tried in turn: the public Overpass instances are
 * often overloaded (502/504) for minutes at a time.
 */
async function askJson<T>(
  urls: string[],
  form: string | undefined,
  accept: (json: unknown) => T | string,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const url = urls[(attempt - 1) % urls.length];
    let failure: string;
    try {
      const { status, body } = await request(url, form);
      if (status === 200) {
        const accepted = accept(JSON.parse(body));
        if (typeof accepted !== "string") return accepted;
        failure = accepted;
      } else {
        failure = `HTTP ${status}`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (attempt >= ATTEMPTS) throw new Error(`failed ${ATTEMPTS} times, last: ${failure}`);
    const wait = 20 * attempt;
    console.log(`  ${new URL(url).host}: ${failure}; retrying in ${wait}s`);
    await sleep(wait);
  }
}

interface Bounds {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

interface Country {
  id: number;
  code: string;
  bounds: Bounds;
}

/** Every coded country relation, with its bounding box. */
async function listCountries(): Promise<Country[]> {
  const query = "[out:json][timeout:180];rel[boundary=administrative][admin_level=2];out tags bb;";
  const elements = await askJson(OVERPASS_URLS, `data=${encodeURIComponent(query)}`, (json) => {
    const answer = json as {
      remark?: string;
      elements?: { id: number; tags?: Record<string, string>; bounds?: Bounds }[];
    };
    // A query that runs out of time still answers 200, with a remark
    if (answer.remark) return answer.remark;
    return Array.isArray(answer.elements) ? answer.elements : "no elements in the answer";
  });
  return elements.flatMap((element) => {
    const code = element.tags?.["ISO3166-1:alpha2"] ?? "";
    return /^[A-Z]{2}$/.test(code) && element.bounds
      ? [{ id: element.id, code, bounds: element.bounds }]
      : [];
  });
}

/** Whether a relation's bounding box reaches a region's; Russia's wraps past 180°. */
function reachesRegion(bounds: Bounds): boolean {
  const lonRanges: [number, number][] =
    bounds.minlon <= bounds.maxlon
      ? [[bounds.minlon, bounds.maxlon]]
      : [
          [bounds.minlon, 180],
          [-180, bounds.maxlon],
        ];
  return regionBoxes.some(
    (box) =>
      bounds.minlat <= box.north &&
      bounds.maxlat >= box.south &&
      lonRanges.some(([west, east]) => west <= box.east && east >= box.west),
  );
}

/** The country's polygon as GeoJSON text, from Nominatim. */
async function countryPolygon(country: Country): Promise<string> {
  const url =
    `${NOMINATIM_LOOKUP}?osm_ids=R${country.id}&format=jsonv2` +
    `&polygon_geojson=1&polygon_threshold=${SIMPLIFY_DEGREES}`;
  const { geojson } = await askJson([url], undefined, (json) => {
    const [place] = json as { osm_id?: number; geojson?: { type: string } }[];
    if (place?.osm_id !== country.id) return `relation ${country.id} not in the answer`;
    const type = place.geojson?.type;
    if (type !== "Polygon" && type !== "MultiPolygon") return `came back as ${type ?? "nothing"}`;
    // In an object: a string is how `accept` reports a failure
    return { geojson: JSON.stringify(place.geojson) };
  });
  return geojson;
}

interface Endpoints {
  id: number;
  name: string | null;
  from_station: string;
  to_station: string;
  start_lng: number;
  start_lat: number;
  end_lng: number;
  end_lat: number;
  start_country: string | null;
  end_country: string | null;
}

/** Look the ends of every row up again and write the ones that changed; returns the changes. */
async function correctCountries(
  client: PoolClient,
  table: "railway_routes" | "scenic_lines",
): Promise<string[]> {
  const idColumn = table === "railway_routes" ? "track_id" : "id";
  const nameColumn = table === "railway_routes" ? "name" : "NULL::text";
  const { rows } = await client.query<Endpoints>(`
    SELECT ${idColumn} AS id, ${nameColumn} AS name, from_station, to_station,
           ST_X(starting_coordinate) AS start_lng, ST_Y(starting_coordinate) AS start_lat,
           ST_X(ending_coordinate) AS end_lng, ST_Y(ending_coordinate) AS end_lat,
           start_country, end_country
    FROM ${table}
    ORDER BY ${idColumn}
  `);
  const countries = await countriesAt(
    client,
    rows.flatMap((row): [number, number][] => [
      [row.start_lng, row.start_lat],
      [row.end_lng, row.end_lat],
    ]),
  );

  const changes: string[] = [];
  for (const [index, row] of rows.entries()) {
    const start = countries[2 * index];
    const end = countries[2 * index + 1];
    if (start === row.start_country && end === row.end_country) continue;
    await client.query(
      `UPDATE ${table} SET start_country = $2, end_country = $3 WHERE ${idColumn} = $1`,
      [row.id, start, end],
    );
    const title = `${row.name ? `${row.name}: ` : ""}${row.from_station} → ${row.to_station}`;
    const was = `${row.start_country ?? "-"}/${row.end_country ?? "-"}`;
    changes.push(`#${row.id} ${title}: ${was} → ${start ?? "-"}/${end ?? "-"}`);
  }
  return changes;
}

async function importCountryBoundaries() {
  const client = await pool.connect();
  try {
    console.log("Listing the countries on Overpass...");
    const countries = (await listCountries()).filter((country) => reachesRegion(country.bounds));
    console.log(`  ${countries.map((country) => country.code).join(" ")}\n`);

    // Staged on this connection as each country arrives, so only one country's
    // geometry is in memory at a time
    await client.query(
      "CREATE TEMP TABLE staged_boundaries (code VARCHAR(2), geometry GEOMETRY(POLYGON, 4326))",
    );

    for (const [index, country] of countries.entries()) {
      const polygon = await countryPolygon(country).catch((error: Error) => {
        throw new Error(`${country.code} (relation ${country.id}): ${error.message}`);
      });
      const { rows } = await client.query<{ pieces: number }>(
        `
        WITH staged AS (
          INSERT INTO staged_boundaries (code, geometry)
          SELECT $1, ST_Subdivide(part.geom, ${PIECE_VERTICES})
          FROM ST_Dump(ST_CollectionExtract(ST_Intersection(
                 ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
                 ST_GeomFromText($3, 4326)
               ), 3)) part
          RETURNING 1
        )
        SELECT count(*)::int AS pieces FROM staged
        `,
        [country.code, polygon, regionsWKT],
      );
      console.log(
        `  ${country.code.padEnd(3)} ${String(rows[0].pieces).padStart(5)} pieces  ${index + 1}/${countries.length}`,
      );
      await sleep(1.5);
    }

    // A region's own country left out (its relation lost its code, or a short
    // answer from Overpass) would quietly go back to country-coder
    const { rows: staged } = await client.query<{ code: string }>(
      "SELECT DISTINCT code FROM staged_boundaries",
    );
    const stagedCodes = new Set(staged.map((row) => row.code));
    const missing = Object.values(REGIONS)
      .flatMap((region) => region.countries.map((country) => country.code))
      .filter((code) => !stagedCodes.has(code));
    if (missing.length > 0) {
      throw new Error(`no boundary for ${missing.join(", ")}, a region's own country`);
    }

    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS country_boundaries (
        code VARCHAR(2) NOT NULL CHECK (code ~ '^[A-Z]{2}$'),
        geometry GEOMETRY(POLYGON, 4326) NOT NULL
      )
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_country_boundaries_geometry ON country_boundaries USING GIST (geometry)",
    );
    await client.query("DELETE FROM country_boundaries");
    const inserted = await client.query(
      "INSERT INTO country_boundaries SELECT code, geometry FROM staged_boundaries",
    );
    await client.query("ANALYZE country_boundaries");
    console.log(`\n✓ ${inserted.rowCount} pieces in country_boundaries\n`);

    for (const [table, label] of [
      ["railway_routes", "routes"],
      ["scenic_lines", "scenic lines"],
    ] as const) {
      const changes = await correctCountries(client, table);
      console.log(`✓ ${changes.length} ${label} changed country`);
      for (const change of changes) console.log(`  ${change}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

importCountryBoundaries().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
