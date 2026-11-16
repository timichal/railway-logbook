/**
 * A metro-only station, which `pruneData` leaves out (metro lines are out of
 * scope). Judged by `station`, which lists the modes that stop there: a
 * station metro and trains share lists both (`station=train;subway`: Koropi,
 * Amsterdam Amstel, Athens Airport's `subway;train`), a metro-only one lists
 * `subway` alone. `train=yes` doesn't tell them apart, since mappers put it on
 * metro-only stations too (Gamla stan, Hamburg Rathaus); it decides only when
 * `station` is missing (Rodgau-Hainhausen). `subway=no` is no subway
 * (Berlin Gesundbrunnen's S-Bahn node).
 *
 * A shared station tagged `station=subway` alone (Oshiage, Kaizuka, Barcelona's
 * FGC stations) is lost with the metro-only ones. The fix is in OSM.
 */
export function isMetroOnlyStation(tags: Record<string, unknown>): boolean {
  if (tags.subway !== "yes") return false;
  if (typeof tags.station !== "string") return tags.train !== "yes";
  return tags.station.split(";").every((mode) => mode.trim() === "subway");
}
