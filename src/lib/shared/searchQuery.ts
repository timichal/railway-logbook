/**
 * What parts one word of a name from the next: whitespace, hyphens and dashes,
 * dots and middle dots. A query of several words is also matched word by word,
 * each as the start of a word of the name and in order, so "pr de" finds
 * "Praha-Dejvice". `search_words` in 02-vector-tiles.sql spells the same set out
 * (`\s` is JavaScript's whitespace, listed there character by character).
 */
const WORD_BREAK_CHARS = String.raw`\s.·・‐‑‒–—―\-`;

/** Apostrophes, which join the parts of one word ("San'yō" is "sanyo"). */
const APOSTROPHES = "'’‘ʼ";

export const SEARCH_WORD_BREAKS = new RegExp(`[${WORD_BREAK_CHARS}]+`, "u");

/**
 * What joins the parts of a name, and is written one way by one operator and
 * another (or not at all) by the next: the word breaks and the apostrophes. The
 * station and line searches ignore them, so "owariseto", "owari-seto" and "Owari
 * Seto" are one query and "sanyo" finds "San'yō". `search_key` in
 * 02-vector-tiles.sql drops the same set; tests/searchText.sql.test.ts holds the
 * two together.
 */
export const SEARCH_SEPARATORS = new RegExp(`[${APOSTROPHES}${WORD_BREAK_CHARS}]+`, "gu");

/**
 * A query's length as the two-character floor (`MIN_SEARCH_QUERY_LENGTH`) counts
 * it, on both sides of the wire: without separators, so "a-" is one character and
 * no client asks the server a question it answers with nothing.
 */
export function searchQueryLength(query: string): number {
  return query.replace(SEARCH_SEPARATORS, "").length;
}
