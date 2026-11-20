import type { ClientBase, Pool } from "pg";
import { countryAt } from "./countryUtils";

/**
 * The country of a route's or scenic line's end, as stored in
 * `start_country`/`end_country`.
 *
 * Looked up in `country_boundaries`: OSM's own country borders
 * (`admin_level=2`), filled by `npm run importCountryBoundaries`. The track and
 * the border then come from one dataset, so a station a few hundred metres
 * inside a country is in that country. country-coder (`countryAt`) answers only
 * where no boundary covers the point (out at sea, a country not imported, or a
 * database where the import was never run, with no table at all). Its borders are generalized for size
 * and put border stations on the wrong side (Vrbovce in CZ, Šahy in HU, Bad
 * Schandau in CZ), which is why it is not the first answer.
 *
 * A point on a shared border, or where two claims overlap, takes the first code
 * alphabetically, so the answer never depends on row order.
 */
export async function countriesAt(
  db: Pool | ClientBase,
  points: readonly [number, number][],
): Promise<(string | null)[]> {
  if (points.length === 0) return [];
  // The table is created by the import, not by a deploy (01-schema.sql is never
  // re-run), so a database the import hasn't reached has none. Asked first
  // rather than caught: the route save runs in a transaction, which a failed
  // query would abort.
  const table = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('country_boundaries') IS NOT NULL AS exists",
  );
  if (!table.rows[0].exists) return points.map((point) => countryAt(point));
  const result = await db.query<{ i: string; code: string | null }>(
    `
    SELECT u.i, (
      SELECT b.code FROM country_boundaries b
      WHERE ST_Covers(b.geometry, ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326))
      ORDER BY b.code
      LIMIT 1
    ) AS code
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(lng, lat, i)
    `,
    [points.map((p) => p[0]), points.map((p) => p[1])],
  );
  const codes = new Map(result.rows.map((row) => [Number(row.i) - 1, row.code]));
  return points.map((point, index) => codes.get(index) ?? countryAt(point));
}
