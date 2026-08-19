/**
 * Incremental reader for a GeoJSON FeatureCollection.
 *
 * Both the pruning step and the database loader consume multi-gigabyte
 * collections, so features are cut out of the stream and parsed one at a time
 * rather than the document being parsed as a whole.
 *
 * Cutting on brace depth alone is not enough. `osmium export` writes every OSM
 * tag as a property, and tag values - `name`, `note`, `description`, `source` -
 * do contain stray braces. An unmatched `}` inside a string ends a feature
 * early; an unmatched `{` runs past its end and swallows the features that
 * follow, and either way the bad text lands in a `JSON.parse` that used to fail
 * silently. So the scan tracks string and escape state and only counts braces
 * outside them, and what still fails to parse is counted rather than ignored.
 */

export interface FeatureStreamStats {
  /** Features cut out of the stream, whether or not they then parsed. */
  total: number;
  /** Features whose text did not parse as JSON. Expected to stay 0. */
  malformed: number;
  /** The stream ended inside a feature — the input is truncated. */
  truncated: boolean;
}

export function createFeatureStreamStats(): FeatureStreamStats {
  return { total: 0, malformed: 0, truncated: false };
}

/** Everything before this is the collection header; the features follow it. */
const FEATURES_KEY = '"features":[';

/** Give up looking for the header rather than buffering a whole file to find it. */
const MAX_HEADER_CHARS = 1_000_000;

/**
 * The index of the `}` closing the object that opens at `start`, or -1 if the
 * text ends first. Braces inside strings, and escaped characters inside them,
 * are ignored.
 */
function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Yield each feature of a GeoJSON FeatureCollection as it arrives.
 *
 * @param source - chunks of the document, in order (a read stream or stdin)
 * @param stats - filled in as the stream is consumed; check it when done
 */
export async function* streamFeatures<T>(
  source: AsyncIterable<string>,
  stats: FeatureStreamStats,
): AsyncGenerator<T> {
  let buffer = "";
  let inFeatures = false;

  for await (const chunk of source) {
    buffer += chunk;

    // Skip the collection header, which may straddle a chunk boundary.
    if (!inFeatures) {
      const keyAt = buffer.indexOf(FEATURES_KEY);
      if (keyAt === -1) {
        if (buffer.length > MAX_HEADER_CHARS) {
          throw new Error(
            `No ${FEATURES_KEY} in the first ${MAX_HEADER_CHARS} characters — not a GeoJSON FeatureCollection?`,
          );
        }
        continue;
      }
      buffer = buffer.slice(keyAt + FEATURES_KEY.length);
      inFeatures = true;
    }

    // Emit every feature the buffer now holds in full, then drop what was read.
    // Trimming once per chunk rather than once per feature keeps this linear.
    let consumed = 0;
    while (true) {
      const open = buffer.indexOf("{", consumed);
      if (open === -1) {
        consumed = buffer.length;
        break;
      }

      const close = findObjectEnd(buffer, open);
      if (close === -1) {
        // Incomplete: keep this feature and wait for the next chunk.
        consumed = open;
        break;
      }

      const text = buffer.slice(open, close + 1);
      consumed = close + 1;
      stats.total++;

      let feature: T;
      try {
        feature = JSON.parse(text) as T;
      } catch {
        stats.malformed++;
        continue;
      }
      yield feature;
    }
    buffer = buffer.slice(consumed);
  }

  if (!inFeatures) {
    throw new Error(
      `Input ended before ${FEATURES_KEY} — empty or not a GeoJSON FeatureCollection`,
    );
  }

  // Anything left that starts an object is a feature the stream cut short.
  stats.truncated = buffer.trimStart().startsWith("{");
}

/** One line summarising a finished stream, for the end of a script's output. */
export function describeFeatureStream(stats: FeatureStreamStats): string {
  const parts = [`${stats.total} features read`];
  if (stats.malformed > 0) parts.push(`${stats.malformed} MALFORMED (skipped)`);
  if (stats.truncated) parts.push("input TRUNCATED");
  return parts.join(", ");
}
