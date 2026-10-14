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
 * Text as compared when matching by hand rather than in SQL: lower-cased and
 * without diacritics, so "chuo" finds "Chūō" and "lodz" finds "Łódź" — what the
 * map's search box does on the server (`immutable_unaccent` + `ILIKE`), for the
 * lists filtered in the browser and for telling two spellings of one line name
 * apart (`routeLineNames`). Lower-cased first, so the capitals fold with them
 * ("İ" lower-cases to an "i" and a combining dot).
 */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(UNDECOMPOSED_PATTERN, (char) => UNDECOMPOSED[char]);
}
