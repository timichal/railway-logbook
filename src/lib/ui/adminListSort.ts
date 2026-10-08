/**
 * The admin lists' sort (routes, scenic lines). Done in the browser rather than
 * in SQL: a text sort under the database's collation was ~340ms of a ~510ms
 * routes query. A fixed locale, so every admin's browser pages a list alike;
 * numeric, so "Line 2" comes before "Line 10".
 */
export const { compare: compareText } = new Intl.Collator("en", { numeric: true });

type Endpoints = { from_station: string; to_station: string };

/**
 * By from, then to. Callers break a tie on their id, so two entries between the
 * same stations keep their order from one reload to the next.
 */
export function compareByEndpoints(a: Endpoints, b: Endpoints): number {
  return compareText(a.from_station, b.from_station) || compareText(a.to_station, b.to_station);
}
