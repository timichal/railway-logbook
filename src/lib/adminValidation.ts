import { ValidationError } from "./errors";
import { foldForSearch } from "./searchText";

/**
 * A route's or scenic line's endpoint names, required. The forms say so first,
 * but every admin action is an endpoint. Trimmed, so a stray space never gets
 * saved (" Brno"); a name of only spaces is then empty and refused. `what`
 * names the thing in the message ("A route", "A scenic line").
 */
export function requiredStations(
  from: string,
  to: string,
  what: string,
): { from: string; to: string } {
  const trimmedFrom = typeof from === "string" ? from.trim() : "";
  const trimmedTo = typeof to === "string" ? to.trim() : "";
  if (!trimmedFrom || !trimmedTo) {
    throw new ValidationError(`${what} needs both a From and a To station`);
  }
  return { from: trimmedFrom, to: trimmedTo };
}

/**
 * A route's link and the name it is shown under, trimmed, blanks as NULL. The name
 * goes with the link: one typed beside an emptied link is dropped rather than kept
 * for a link that isn't there, as the table's CHECK requires.
 */
export function routeLink(
  link: string | null,
  linkName: string | null,
): { link: string | null; linkName: string | null } {
  const url = typeof link === "string" && link.trim() ? link.trim() : null;
  const name = url && typeof linkName === "string" && linkName.trim() ? linkName.trim() : null;
  return { link: url, linkName: name };
}

/**
 * Why a scenic line's path was refused, or its recalculation marked invalid: a
 * path into a spur and back would draw the spur as part of the band.
 */
export const SCENIC_BACKTRACKING_ERROR = "The path backtracks, which a scenic line may not";

/**
 * A route's line names: `name`, the line it is called by, and `otherNames`, the
 * other lines sharing it. Trimmed, blanks dropped, and the other names cleared of
 * duplicates and of the name itself, compared as the line search compares them
 * (case, diacritics, spaces and hyphens aside, `foldForSearch`): "Chuo Main Line"
 * beside "Chūō Main Line" would make the search offer one line twice, each with
 * half its routes.
 * Other names need a name to follow, as the table's CHECK says; refused here
 * first, with a message the form can show.
 */
export function routeLineNames(
  name: string | null,
  otherNames: unknown,
): { name: string | null; otherNames: string[] } {
  const primary = typeof name === "string" && name.trim() ? name.trim() : null;
  if (!Array.isArray(otherNames) || otherNames.some((other) => typeof other !== "string")) {
    throw new ValidationError("Other lines must be a list of names");
  }

  const seen = new Set(primary ? [foldForSearch(primary)] : []);
  const others: string[] = [];
  for (const other of otherNames as string[]) {
    const trimmed = other.trim();
    const folded = foldForSearch(trimmed);
    if (!trimmed || seen.has(folded)) continue;
    seen.add(folded);
    others.push(trimmed);
  }

  if (others.length > 0 && !primary) {
    throw new ValidationError("A route on other lines needs a name of its own");
  }
  return { name: primary, otherNames: others };
}
