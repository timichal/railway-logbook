/**
 * The trip just made with the logging screen's "New trip…" (`edit-trip` with
 * `fileUnder`), handed back to that screen.
 *
 * The new trip is picked for the journey at once, but the screen's trip list is
 * the server's and is read again only after the save: until it answers (or for
 * good, if that read fails offline) the picked trip would be missing from the
 * list, and shown under a stand-in name. So the screen lays this over its list
 * where the list lacks it. One trip, the last made; a module rather than a context
 * because the two screens are separate modals and only this passes between them.
 *
 * Kept only until a list read that began after the trip was made answers: from
 * then on the server's list is the word, and a trip since deleted isn't offered.
 */
export interface NewTrip {
  id: number;
  name: string;
}

let last: NewTrip | null = null;
/** Moves on with each trip made. */
let made = 0;

export function rememberNewTrip(trip: NewTrip): void {
  last = trip;
  made += 1;
}

/** Taken as a trip list read goes out, and handed to `settleNewTrip` when it answers. */
export function newTripMark(): number {
  return made;
}

/** A list read begun at `mark` has answered: it has the trip, if it still exists. */
export function settleNewTrip(mark: number): void {
  if (mark === made) last = null;
}

/** `trips` with the trip last made added at the end, if it isn't there. */
export function withNewTrip<T extends NewTrip>(trips: (T | NewTrip)[]): (T | NewTrip)[] {
  const trip = last;
  return trip && !trips.some(({ id }) => id === trip.id) ? [...trips, trip] : trips;
}
