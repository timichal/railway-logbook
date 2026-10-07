/**
 * The length in kilometres of a WGS84 line given as WKT, measured on the
 * ellipsoid (`::geography`). Every stored `length_km` — a route or scenic line
 * saved or recalculated — and the admin preview's length go through this one
 * expression, so the length shown before a save is the length the save stores.
 * A spherical (haversine) sum reads Japanese east-west lines ~0.2% short.
 *
 * `wktSql` is a SQL expression (a `$n` placeholder) interpolated as is — never
 * pass user input.
 */
export function lineLengthKmSql(wktSql: string): string {
  return `ST_Length(ST_GeomFromText(${wktSql}, 4326)::geography) / 1000`;
}
