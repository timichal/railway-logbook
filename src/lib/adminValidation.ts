import { ValidationError } from "./errors";

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
