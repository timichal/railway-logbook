/**
 * What joins the parts of a name, and is written one way by one operator and
 * another (or not at all) by the next: whitespace, hyphens and dashes,
 * apostrophes, dots and middle dots. The station and line searches ignore them,
 * so "owariseto", "owari-seto" and "Owari Seto" are one query and "sanyo" finds
 * "San'yō". `search_key` in 02-vector-tiles.sql spells the same set out (`\s` is
 * JavaScript's whitespace, listed there character by character);
 * tests/searchText.sql.test.ts holds the two together.
 */
export const SEARCH_SEPARATORS = /[\s'’‘ʼ.·・‐‑‒–—―-]+/gu;

/**
 * A query's length as the two-character floor (`MIN_SEARCH_QUERY_LENGTH`) counts
 * it, on both sides of the wire: without separators, so "a-" is one character and
 * no client asks the server a question it answers with nothing.
 */
export function searchQueryLength(query: string): number {
  return query.replace(SEARCH_SEPARATORS, "").length;
}
