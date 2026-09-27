/**
 * `ST_DWithin` in metres on the ground, measured against a `geometry_3857`
 * column so its GIST index is usable — an `ST_DWithin` on a `::geography` cast
 * can't use it, and costs hundreds of milliseconds per call.
 *
 * Web Mercator inflates distance by 1/cos(lat), so the radius is scaled by the
 * same factor at `latSql`, guarded so a degenerate latitude cannot blow up the
 * divisor. The scaling is exact only at that latitude; over the few kilometres
 * these radii span, the difference is negligible.
 *
 * Every argument is a SQL expression (a column, a `$n` placeholder, a literal)
 * interpolated as is — never pass user input.
 */
export function withinMetersSql(
  geometry3857Sql: string,
  point3857Sql: string,
  metersSql: string | number,
  latSql: string,
): string {
  return `ST_DWithin(${geometry3857Sql}, ${point3857Sql}, ${metersSql} / GREATEST(cos(radians(${latSql})), 0.01))`;
}
