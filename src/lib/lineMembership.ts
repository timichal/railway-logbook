/**
 * Which named lines a route is on: the one it is called by (`name`) and the ones
 * it shares the stretch with (`other_names`). Written once, here, because the
 * line search, its highlight and the admin's name suggestions must agree on it —
 * one of them reading `name` alone would offer a line the others cannot draw.
 *
 * `alias` is the `railway_routes` alias in the calling query.
 */

/**
 * Every line the route is on, one row each, for a FROM / `CROSS JOIN LATERAL`. A
 * route with no name yields a single NULL (other names need a name, see the
 * table's CHECK), so callers filter `IS NOT NULL`.
 */
export function routeLinesSql(alias: string): string {
  return `unnest(${alias}.other_names || ${alias}.name)`;
}

/** Whether the route is on the line named by `line` (a parameter or a column). */
export function onLineSql(alias: string, line: string): string {
  return `(${alias}.name = ${line} OR ${line} = ANY(${alias}.other_names))`;
}
