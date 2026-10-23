import { SEARCH_SEPARATORS } from "./shared/searchQuery";

/**
 * Letters that carry their accent inside the letter rather than as a combining mark,
 * so NFD leaves them whole, mapped as Postgres's unaccent maps them: "Łódź" would
 * otherwise need an "ł" to be found.
 */
const UNDECOMPOSED: Record<string, string> = {
  ł: "l",
  ŀ: "l",
  ø: "o",
  đ: "d",
  ð: "d",
  ħ: "h",
  ı: "i",
  ŧ: "t",
  þ: "th",
  ß: "ss",
  ſ: "s",
  æ: "ae",
  œ: "oe",
};
const UNDECOMPOSED_PATTERN = new RegExp(`[${Object.keys(UNDECOMPOSED).join("")}]`, "g");

/**
 * Every combining mark but the kana voicing marks: decomposed, "ば" is "は" and a
 * mark, but the mark is part of the letter, not an accent on it — unaccent keeps
 * it, and so does this (NFC puts the two back together).
 */
const NOT_KANA_VOICING_MARK = /[^\P{M}\u3099\u309a]/gu;

/**
 * Text lower-cased and without diacritics, so "chuo" finds "Chūō" and "lodz" finds
 * "Łódź" — but with its spaces and hyphens, for free-form text where they carry
 * meaning ("1-2x daily" is not "12x daily"): the frequency tags. Compatibility
 * forms fold too (NFKD), as unaccent folds them: full-width "３" is "3", "№" is
 * "no" — lower-cased after decomposing, so what NFKD makes a capital folds as well.
 */
export function foldAccents(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(NOT_KANA_VOICING_MARK, "")
    .normalize("NFC")
    .replace(UNDECOMPOSED_PATTERN, (char) => UNDECOMPOSED[char]);
}

/**
 * A name as compared when matching by hand rather than in SQL: `foldAccents`
 * without the separators operators spell differently (`SEARCH_SEPARATORS`), so
 * "owariseto" also finds "Owari Seto" — what the map's search box does on the
 * server (`search_key`, kept in agreement by tests/searchText.sql.test.ts), for
 * the station and line lists filtered in the browser and for telling two
 * spellings of one line name apart (`routeLineNames`).
 */
export function foldForSearch(text: string): string {
  return foldAccents(text).replace(SEARCH_SEPARATORS, "");
}
