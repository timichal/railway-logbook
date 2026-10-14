/**
 * LocalStorage access for storing journeys and preferences for unauthenticated users.
 * Max MAX_JOURNEYS journeys allowed, no limit on logged parts.
 *
 * Exposed as plain module functions; callers typically import the namespace
 * (`import * as localStore from "@/lib/localStorage"`).
 */

import { normalizeCountryCodes, SUPPORTED_COUNTRIES } from "./shared/constants";
import type { JourneyEdits, LocalJourney, LocalLoggedPart } from "./shared/types";

const JOURNEYS_KEY = "railway_journeys";
const LOGGED_PARTS_KEY = "railway_logged_parts";
const PREFS_KEY = "railway_preferences";
const STORAGE_KEYS = [JOURNEYS_KEY, LOGGED_PARTS_KEY, PREFS_KEY];
/**
 * The cap on locally stored journeys. Exported because the number is also shown
 * to the user (the Route Logger's storage banner, the disabled-button title),
 * and a second hard-coded copy is how those strings went stale before.
 */
export const MAX_JOURNEYS = 5;
/** The one wording of the cap, so the toast and the throw cannot disagree. */
export const JOURNEY_LIMIT_MESSAGE = `Journey limit reached (${MAX_JOURNEYS}/${MAX_JOURNEYS}). Please register to log more journeys.`;
// Returns a fresh array each call: getPreferences hands its result to callers
// that put it in React state, and a shared mutable module-level array would let
// one of them corrupt the defaults for everyone else.
const defaultCountries = (): string[] => SUPPORTED_COUNTRIES.map((country) => country.code);

/**
 * A failure whose message is written for the user (the journey limit, a full
 * quota, an unreadable list), as opposed to whatever the browser threw.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Only the fields something downstream reads without checking - a search calls
// `name.toLowerCase()`, the map colouring looks rides up by `track_id`. No more:
// every write re-saves what the last read returned, so an entry refused here is
// deleted for good, and a ride stored by an older version must not be lost over a
// field nothing would have crashed on.
const isLocalJourney = (entry: unknown): entry is LocalJourney =>
  isRecord(entry) &&
  typeof entry.id === "string" &&
  typeof entry.name === "string" &&
  typeof entry.date === "string";

const isLocalLoggedPart = (entry: unknown): entry is LocalLoggedPart =>
  isRecord(entry) &&
  typeof entry.id === "string" &&
  typeof entry.journey_id === "string" &&
  typeof entry.track_id === "number";

/** What an edit says when the journey has been deleted in another tab. */
const GONE_MESSAGE = "This journey is no longer saved in this browser.";

/** What a write says when the list it would replace cannot be read. */
const UNREADABLE_MESSAGE =
  "The journeys saved in this browser could not be read, so nothing was saved over them. Clearing this site's data in the browser settings starts them afresh.";

/**
 * The array under `field` in the JSON stored at `key`, keeping only the entries
 * `isEntry` accepts; null when nothing is stored (or on the server).
 *
 * Something stored that is not such an array — it fails to parse, or parses to
 * `{"journeys":{}}` or `null` — throws instead of passing for an empty list,
 * because every write re-saves what its read returned: an empty list there would
 * overwrite whatever the user had with the one new entry. The display readers
 * (`readForDisplay`) turn the throw into an empty list; the writers let it stop
 * the write. Storage is the browser's, not ours: anything (an old version, an
 * extension, a hand edit) can have written it.
 */
function readStoredArray<T>(
  key: string,
  field: string,
  isEntry: (entry: unknown) => entry is T,
): T[] | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(key);
  if (!data) return null;
  let entries: unknown;
  try {
    const parsed: unknown = JSON.parse(data);
    entries = isRecord(parsed) ? parsed[field] : undefined;
  } catch {
    // Unparseable: falls through to the shape check, which refuses it
  }
  if (!Array.isArray(entries)) throw new StorageError(UNREADABLE_MESSAGE);
  return entries.filter(isEntry);
}

/** `readStoredArray` for a reader that only shows the list: unreadable reads as nothing stored. */
function readForDisplay<T>(
  key: string,
  field: string,
  isEntry: (entry: unknown) => entry is T,
): T[] | null {
  try {
    return readStoredArray(key, field, isEntry);
  } catch (error) {
    console.error(`Error reading ${key} from localStorage:`, error);
    return null;
  }
}

/**
 * Stores `list` under `field` at `key`. Given `what` (plural), a full quota becomes
 * a message meant for the user — "register to save more <what>" — since the callers
 * show a thrown message as it is; without it the browser's error is rethrown.
 */
function writeStoredArray(key: string, field: string, list: unknown[], what?: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, [field]: list }));
  } catch (error) {
    if (what && error instanceof Error && error.name === "QuotaExceededError") {
      throw new StorageError(`Storage limit reached. Please register to save more ${what}.`);
    }
    throw error;
  }
}

// The lists a write starts from: these throw rather than return an unreadable list as empty.
const journeysToWrite = () => readStoredArray(JOURNEYS_KEY, "journeys", isLocalJourney) ?? [];
const partsToWrite = () => readStoredArray(LOGGED_PARTS_KEY, "parts", isLocalLoggedPart) ?? [];
const writeJourneys = (journeys: LocalJourney[]) =>
  writeStoredArray(JOURNEYS_KEY, "journeys", journeys, "journeys");
const writeParts = (parts: LocalLoggedPart[]) =>
  writeStoredArray(LOGGED_PARTS_KEY, "parts", parts, "routes");

// ===== Journeys =====

export function getJourneys(): LocalJourney[] {
  return readForDisplay(JOURNEYS_KEY, "journeys", isLocalJourney) ?? [];
}

export function getJourneyCount(): number {
  return getJourneys().length;
}

export function canAddMoreJourneys(): boolean {
  return getJourneyCount() < MAX_JOURNEYS;
}

/**
 * Adds a journey with its routes. Both or neither: a journey left behind by a
 * failed routes write would hold one of the MAX_JOURNEYS slots with nothing in it.
 * @throws Error if the journey limit or the storage quota is reached
 */
export function addJourneyWithParts(
  journey: Omit<LocalJourney, "id" | "created_at" | "updated_at">,
  parts: Omit<LocalLoggedPart, "id" | "journey_id" | "created_at">[],
): LocalJourney {
  const journeys = journeysToWrite();
  if (journeys.length >= MAX_JOURNEYS) throw new StorageError(JOURNEY_LIMIT_MESSAGE);
  const existingParts = partsToWrite();

  const now = new Date().toISOString();
  const newJourney: LocalJourney = {
    ...journey,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  };
  writeJourneys([...journeys, newJourney]);
  try {
    writeParts([
      ...existingParts,
      ...parts.map((part) => newLoggedPart({ ...part, journey_id: newJourney.id }, now)),
    ]);
  } catch (error) {
    // The list it puts back is shorter than the one just stored, so it fits.
    writeJourneys(journeys);
    throw error;
  }
  return newJourney;
}

/**
 * Saves an edited journey — its name, description and date, and its routes — as
 * `saveJourneyEditsForUser` does on the server. An upserted route keeps its stretch
 * while it stays partial and loses it when it doesn't: a stretch kept would come
 * back when the flag is ticked again, claiming a range nobody re-entered. Both
 * lists or neither.
 */
export function saveJourneyEdits(id: string, edits: JourneyEdits): void {
  const journeys = journeysToWrite();
  const parts = partsToWrite();
  if (!journeys.some((journey) => journey.id === id)) throw new StorageError(GONE_MESSAGE);

  const now = new Date().toISOString();
  const flags = new Map(edits.upsert.map(({ trackId, partial }) => [trackId, partial]));
  const removed = new Set(edits.remove);
  const kept = parts.filter((part) => part.journey_id !== id || !removed.has(part.track_id));
  const logged = new Set(kept.filter((part) => part.journey_id === id).map((p) => p.track_id));
  const updated = kept.map((part) => {
    const partial = part.journey_id === id ? flags.get(part.track_id) : undefined;
    if (partial === undefined) return part;
    return partial
      ? { ...part, partial }
      : { ...part, partial, covered_start: null, covered_end: null };
  });
  const added = edits.upsert
    .filter(({ trackId }) => !logged.has(trackId))
    .map(({ trackId, partial }) =>
      newLoggedPart({ journey_id: id, track_id: trackId, partial }, now),
    );

  writeParts([...updated, ...added]);
  try {
    writeJourneys(
      journeys.map((journey) =>
        journey.id === id
          ? {
              ...journey,
              name: edits.name,
              description: edits.description,
              date: edits.date,
              updated_at: now,
            }
          : journey,
      ),
    );
  } catch (error) {
    // What was stored before, so it fits.
    writeParts(parts);
    throw error;
  }
}

/** Deletes the journey and every part logged in it. */
export function deleteJourney(id: string): void {
  // Both read before either is written, so an unreadable parts list stops the
  // delete before the journey is gone.
  const journeys = journeysToWrite();
  const parts = partsToWrite();
  writeJourneys(journeys.filter((journey) => journey.id !== id));
  writeParts(parts.filter((part) => part.journey_id !== id));
}

// ===== Logged parts =====

export function getLoggedParts(): LocalLoggedPart[] {
  return readForDisplay(LOGGED_PARTS_KEY, "parts", isLocalLoggedPart) ?? [];
}

/**
 * One journey and its routes, for a card about to edit them. Read as a write
 * reads, so an unreadable list says so rather than passing for a journey deleted
 * in another tab.
 */
export function getJourneyWithParts(id: string): {
  journey: LocalJourney;
  parts: LocalLoggedPart[];
} {
  const journey = journeysToWrite().find((j) => j.id === id);
  if (!journey) throw new StorageError(GONE_MESSAGE);
  return { journey, parts: partsToWrite().filter((part) => part.journey_id === id) };
}

const newLoggedPart = (
  part: Omit<LocalLoggedPart, "id" | "created_at">,
  created_at: string,
): LocalLoggedPart => ({ ...part, id: crypto.randomUUID(), created_at });

// ===== Preferences =====

export function getPreferences(): string[] {
  // The same cleanup every other reader of the filter applies (upper case, no
  // duplicates, two letters), so a hand-edited "cz" still matches the tiles.
  const codes = readForDisplay(
    PREFS_KEY,
    "selected_countries",
    (code): code is string => typeof code === "string",
  );
  return codes ? normalizeCountryCodes(codes) : defaultCountries();
}

export function setPreferences(countries: string[]): void {
  writeStoredArray(PREFS_KEY, "selected_countries", countries);
}

// ===== Migration and sync =====

/** All journeys and logged parts, for migration on login. */
export function exportJourneysData(): { journeys: LocalJourney[]; parts: LocalLoggedPart[] } {
  return { journeys: getJourneys(), parts: getLoggedParts() };
}

/** Calls `callback` when another tab changes the railway data. Returns the unsubscribe. */
export function onStorageChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: StorageEvent) => {
    // A null key is a `localStorage.clear()`, which took ours with it.
    if (event.storageArea !== localStorage) return;
    if (event.key === null || STORAGE_KEYS.includes(event.key)) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function clearAll(): void {
  // Each key on its own, so one failing does not leave the others behind.
  for (const key of STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error clearing ${key} from localStorage:`, error);
    }
  }
}
