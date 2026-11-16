import { transliterate } from "transliteration";

/**
 * Cyrillic station names romanized by the system of the country they stand in.
 *
 * The `transliteration` package romanizes all Cyrillic as Russian, and loosely
 * at that (ц "c", х "h"). It drops ъ, which in Bulgarian is a full vowel
 * (Дъбово came out "Dbovo", not Dabovo), and writes Serbian in Russian spelling
 * (Ниш "Nish", Ћуприја "Tshuprija") where Serbian has a Latin alphabet of its
 * own (Niš, Ćuprija). So each country's official system is written out here,
 * and the station's country picks it.
 *
 * A name written in another language than the country's (a Russian name in
 * Ukraine, say) shows a letter the country's alphabet lacks; it goes to the
 * first system whose alphabet covers it. What no system covers is left to the
 * package. Greek goes by ELOT 743 (`romanizeGreek`).
 */

/**
 * Romanizes the letter at `i` of a lower-cased name: its Latin spelling and
 * how many letters it took. A letter the system doesn't know returns nothing.
 */
type Rule = (chars: string[], i: number) => [string, number] | undefined;

type System = {
  /** Every letter the language writes, lower case. It picks among the Cyrillic systems (`covers`); Greek has one. */
  alphabet: string;
  rule: Rule;
};

const LETTER = /\p{L}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const GREEK = /\p{Script=Greek}/u;
/** The scripts the systems here romanize. A letter its system doesn't know goes to `romanizeUnknown`. */
const NON_LATIN = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
/** A combining acute or grave after a Cyrillic letter: a stress mark (Чугу́їв). */
const STRESS_MARK = /(\p{Script=Cyrillic})[\u{300}\u{301}]/gu;
/** ASCII, typographic and modifier-letter apostrophes - all three are used. */
const APOSTROPHES = "'’ʼ";

// Never `APOSTROPHES.includes(char)` on a possibly empty char: "" is in every string.
function isApostrophe(char: string | undefined): boolean {
  return !!char && APOSTROPHES.includes(char);
}

function isLetter(char: string | undefined): boolean {
  return !!char && LETTER.test(char) && !isApostrophe(char);
}

function startsWord(chars: string[], i: number): boolean {
  return !isLetter(chars[i - 1]) && !isApostrophe(chars[i - 1]);
}

/** A rule spelling every letter one way, wherever it stands. */
function lettersRule(letters: Record<string, string>): Rule {
  return (chars, i) => {
    const latin = letters[chars[i]];
    return latin === undefined ? undefined : [latin, 1];
  };
}

/** The first rule that knows the letter. */
function firstOf(...rules: Rule[]): Rule {
  return (chars, i) => {
    for (const rule of rules) {
      const result = rule(chars, i);
      if (result) return result;
    }
    return undefined;
  };
}

/**
 * An apostrophe between two letters only marks a separation (Ukrainian,
 * Belarusian) and is dropped. Anywhere else it is a quote and stays.
 */
const dropApostrophe: Rule = (chars, i) =>
  isApostrophe(chars[i]) && CYRILLIC.test(chars[i - 1] ?? "") && CYRILLIC.test(chars[i + 1] ?? "")
    ? ["", 1]
    : undefined;

/**
 * Bulgaria's Streamlined System (Transliteration Act, 2009). It is the official
 * romanization, the one on the station signs and in OSM's `name:en`.
 */
const BULGARIAN: System = {
  alphabet: "абвгдежзийклмнопрстуфхцчшщъьюяѝ",
  rule: firstOf(
    // The Act's one exception: -ия at the end of a word is "ia" (София, Sofia).
    (chars, i) =>
      chars[i] === "и" && chars[i + 1] === "я" && !isLetter(chars[i + 2]) ? ["ia", 2] : undefined,
    lettersRule({
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ж: "zh",
      з: "z",
      и: "i",
      ѝ: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "sht",
      ъ: "a",
      ь: "y",
      ю: "yu",
      я: "ya",
    }),
  ),
};

/**
 * Serbian Cyrillic to Serbian Latin (Gaj's alphabet), letter for letter.
 * Montenegro and Bosnia and Herzegovina write it the same way.
 */
const SERBIAN: System = {
  alphabet: "абвгдђежзијклљмнњопрстћуфхцчџш",
  rule: lettersRule({
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    ђ: "đ",
    е: "e",
    ж: "ž",
    з: "z",
    и: "i",
    ј: "j",
    к: "k",
    л: "l",
    љ: "lj",
    м: "m",
    н: "n",
    њ: "nj",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    ћ: "ć",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "č",
    џ: "dž",
    ш: "š",
  }),
};

/**
 * The Latin alphabet Macedonian is written in locally, as in OSM's `name:en`
 * (Kičevo, Gjorče Petrov): Serbian's diacritics, gj and kj for ѓ and ќ. The
 * government's ASCII system (ch, sh, zh) is not what the names carry.
 */
const MACEDONIAN: System = {
  alphabet: "абвгдѓежзѕијклљмнњопрстќуфхцчџшѐѝ",
  rule: lettersRule({
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    ѓ: "gj",
    е: "e",
    ѐ: "e",
    ж: "ž",
    з: "z",
    ѕ: "dz",
    и: "i",
    ѝ: "i",
    ј: "j",
    к: "k",
    л: "l",
    љ: "lj",
    м: "m",
    н: "n",
    њ: "nj",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    ќ: "kj",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "č",
    џ: "dž",
    ш: "š",
  }),
};

/**
 * Ukraine's national system (Cabinet resolution 55, 2010), the one on the
 * signs and in OSM's `name:en`: Київ Kyiv, Львів Lviv. є ї й ю я are spelt
 * with a y at the start of a word and an i inside one.
 */
const UKRAINIAN_INITIAL: Record<string, [string, string]> = {
  є: ["ye", "ie"],
  ї: ["yi", "i"],
  й: ["y", "i"],
  ю: ["yu", "iu"],
  я: ["ya", "ia"],
};

const UKRAINIAN: System = {
  alphabet: "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
  rule: firstOf(
    dropApostrophe,
    // зг is "zgh", to tell it from зх ("zkh"): Згурівка, Zghurivka.
    (chars, i) => (chars[i] === "з" && chars[i + 1] === "г" ? ["zgh", 2] : undefined),
    (chars, i) => {
      const forms = UKRAINIAN_INITIAL[chars[i]];
      if (!forms) return undefined;
      return [startsWord(chars, i) ? forms[0] : forms[1], 1];
    },
    lettersRule({
      а: "a",
      б: "b",
      в: "v",
      г: "h",
      ґ: "g",
      д: "d",
      е: "e",
      ж: "zh",
      з: "z",
      и: "y",
      і: "i",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "kh",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "shch",
      ь: "",
    }),
  ),
};

/**
 * Belarus's national system (2007 instruction, adopted by the UN in 2013), as
 * in OSM's `int_name`: Магілёў Mahilioŭ, Гомель Homieĺ. е ё ю я are je jo ju
 * ja at the start of a word and after a vowel, an apostrophe, ь or ў, and ie
 * io iu ia after a consonant. A soft sign marks the consonant before it.
 */
const BELARUSIAN_IOTATED: Record<string, string> = { е: "e", ё: "o", ю: "u", я: "a" };
const BELARUSIAN_SOFTENED: Record<string, string> = { з: "ź", л: "ĺ", н: "ń", с: "ś", ц: "ć" };
const CYRILLIC_VOWELS = "аеёиоуыэюяіїє";

const BELARUSIAN: System = {
  alphabet: "абвгґдеёжзійклмнопрстуўфхцчшыьэюя",
  rule: firstOf(
    dropApostrophe,
    (chars, i) => {
      const vowel = BELARUSIAN_IOTATED[chars[i]];
      if (!vowel) return undefined;
      const prev = chars[i - 1] ?? "";
      const separated =
        startsWord(chars, i) ||
        CYRILLIC_VOWELS.includes(prev) ||
        isApostrophe(prev) ||
        prev === "ь" ||
        prev === "ў";
      return [(separated ? "j" : "i") + vowel, 1];
    },
    (chars, i) => {
      const softened = BELARUSIAN_SOFTENED[chars[i]];
      return softened && chars[i + 1] === "ь" ? [softened, 2] : undefined;
    },
    lettersRule({
      а: "a",
      б: "b",
      в: "v",
      г: "h",
      ґ: "g",
      д: "d",
      ж: "ž",
      з: "z",
      і: "i",
      й: "j",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ў: "ŭ",
      ф: "f",
      х: "ch",
      ц: "c",
      ч: "č",
      ш: "š",
      ы: "y",
      ь: "",
      э: "e",
    }),
  ),
};

/**
 * Russian by BGN/PCGN as English maps and OSM's `name:en` simplify it:
 * Голицыно Golitsyno, Шереметьевская Sheremetyevskaya, Охотный Okhotny. е is
 * ye at the start of a word and after a vowel (but ы) or a hard or soft sign,
 * ё is always yo (Чёрное, Chyornoye). The signs are dropped, except before и,
 * where they are y (Ильича, Ilyicha). A word ending -ый or -ий ends -y.
 */
const RUSSIAN: System = {
  alphabet: "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
  rule: firstOf(
    (chars, i) =>
      (chars[i] === "ы" || chars[i] === "и") && chars[i + 1] === "й" && !isLetter(chars[i + 2])
        ? ["y", 2]
        : undefined,
    (chars, i) => {
      if (chars[i] === "ё") return ["yo", 1];
      if (chars[i] !== "е") return undefined;
      const prev = chars[i - 1] ?? "";
      // ы is y already: Новые, Novye.
      const afterVowel = CYRILLIC_VOWELS.includes(prev) && prev !== "ы";
      return [startsWord(chars, i) || afterVowel || prev === "ъ" || prev === "ь" ? "ye" : "e", 1];
    },
    (chars, i) =>
      chars[i] === "ъ" || chars[i] === "ь" ? [chars[i + 1] === "и" ? "y" : "", 1] : undefined,
    lettersRule({
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "kh",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "shch",
      ы: "y",
      э: "e",
      ю: "yu",
      я: "ya",
    }),
  ),
};

/**
 * Greece's ELOT 743 (ISO 843's transcription, adopted by the UN in 1987), the
 * spelling of Hellenic Train's timetables and the road signs: Κάτω Αχαρναί
 * Kato Acharnai, Χαλκίδα Chalkida, Αλεξανδρούπολη Alexandroupoli. The package
 * writes χ as "h" and ου as "oy", and spells ΐ as a capital I (Αχαΐα, "AhaIa").
 * The accents are dropped before the letters are matched (`greekLower`). The
 * diaeresis stays, since it parts two vowels (Αχαΐα, Achaia), and a tonos on
 * the first of two parts them too (Άυλος, Aylos).
 */
const GREEK_VOWELS = "αεηιοωυϊϋ";
/** Before these, and before a vowel, αυ ευ ηυ are av ev iv; af ef if elsewhere. */
const GREEK_VOICED = "βγδζλμνρ";
const GREEK_U_DIPHTHONGS: Record<string, string> = { α: "a", ε: "e", η: "i" };
const GREEK_NASAL_PAIRS: Record<string, string> = { γγ: "ng", γκ: "gk", γξ: "nx", γχ: "nch" };

const ELOT_743: System = {
  alphabet: "αβγδεζηθικλμνξοπρσςτυφχψωϊϋ",
  rule: firstOf(
    (chars, i) => {
      const vowel = GREEK_U_DIPHTHONGS[chars[i]];
      if (!vowel || chars[i + 1] !== "υ") return undefined;
      const next = chars[i + 2] ?? "";
      const voiced = next !== "" && (GREEK_VOWELS.includes(next) || GREEK_VOICED.includes(next));
      return [vowel + (voiced ? "v" : "f"), 2];
    },
    (chars, i) => (chars[i] === "ο" && chars[i + 1] === "υ" ? ["ou", 2] : undefined),
    // μπ is b at either end of a word, mb inside one: Μπράλος Bralos, Κομποτάδες Kombotades.
    (chars, i) => {
      if (chars[i] !== "μ" || chars[i + 1] !== "π") return undefined;
      return [startsWord(chars, i) || !isLetter(chars[i + 2]) ? "b" : "mb", 2];
    },
    (chars, i) => {
      const pair = GREEK_NASAL_PAIRS[chars[i] + (chars[i + 1] ?? "")];
      return pair ? [pair, 2] : undefined;
    },
    lettersRule({
      α: "a",
      β: "v",
      γ: "g",
      δ: "d",
      ε: "e",
      ζ: "z",
      η: "i",
      θ: "th",
      ι: "i",
      ϊ: "i",
      κ: "k",
      λ: "l",
      μ: "m",
      ν: "n",
      ξ: "x",
      ο: "o",
      π: "p",
      ρ: "r",
      σ: "s",
      ς: "s",
      τ: "t",
      υ: "y",
      ϋ: "y",
      φ: "f",
      χ: "ch",
      ψ: "ps",
      ω: "o",
    }),
  ),
};

/**
 * Accents ELOT 743 doesn't write: the tonos (acute, and the grave and
 * circumflex of polytonic spelling), the breathings and the iota subscript.
 */
const GREEK_ACCENTS = /[\u0300\u0301\u0313\u0314\u0342\u0345]/g;
/** The stress on a vowel: the tonos, or a polytonic grave or circumflex. */
const GREEK_STRESS = /[\u0300\u0301\u0342]/;

/** A Greek letter lower-cased and stripped of its accents; any other letter lower-cased. */
function greekLower(char: string): string {
  const lower = char.toLowerCase();
  if (!GREEK.test(lower)) return lower;
  return lower.normalize("NFD").replace(GREEK_ACCENTS, "").normalize("NFC");
}

/** `name` with its Greek romanized by ELOT 743. Latin letters pass through. */
export function romanizeGreek(name: string): string {
  const original = [...name.normalize("NFC")];
  const lower = original.map(greekLower);
  // The stress on the first of two vowels parts them, as a diaeresis on the
  // second would: Άυλος is a-y-los, Aylos, where αύ is one sound (Ναύπλιο).
  for (let i = 0; i + 1 < lower.length; i++) {
    if (
      "αεηο".includes(lower[i]) &&
      lower[i + 1] === "υ" &&
      GREEK_STRESS.test(original[i].normalize("NFD"))
    ) {
      lower[i + 1] = "ϋ";
    }
  }
  return romanizeWith(ELOT_743, original, lower);
}

/** The system each country writes Cyrillic in. Russian everywhere else. */
const COUNTRY_SYSTEMS: Record<string, System> = {
  BG: BULGARIAN,
  RS: SERBIAN,
  ME: SERBIAN,
  BA: SERBIAN,
  XK: SERBIAN,
  MK: MACEDONIAN,
  UA: UKRAINIAN,
  BY: BELARUSIAN,
  RU: RUSSIAN,
};

/** Where a name in another language than its country's is looked for. */
const FALLBACK_ORDER = [RUSSIAN, UKRAINIAN, BELARUSIAN, BULGARIAN, SERBIAN, MACEDONIAN];

function covers(system: System, chars: string[]): boolean {
  return chars.every((char) => !CYRILLIC.test(char) || system.alphabet.includes(char));
}

function isUpper(char: string | undefined): boolean {
  return !!char && LETTER.test(char) && char !== char.toLowerCase();
}

/**
 * The romanization of a capital. A multi-letter one is all capitals inside a
 * word written in capitals (ЖИВ, ZHIV) and capitalized otherwise (Жив, Zhiv).
 */
function capitalized(latin: string, prev: string | undefined, next: string | undefined): string {
  if (latin.length < 2) return latin.toUpperCase();
  const neighbour = isLetter(next) ? next : prev;
  return isUpper(neighbour) ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
}

/**
 * A run of letters `system` doesn't know: Greek in another system's name goes
 * by ELOT 743, anything else to the package.
 */
function romanizeUnknown(system: System, run: string): string {
  return system !== ELOT_743 && !CYRILLIC.test(run) ? romanizeGreek(run) : transliterate(run);
}

/**
 * Romanizes by `system`. A run of Cyrillic or Greek letters the system doesn't
 * know is romanized on its own (`romanizeUnknown`), so the diacritics the
 * system wrote (and any Latin ones in the name) are kept.
 */
function romanizeWith(system: System, original: string[], lower: string[]): string {
  let out = "";
  let unknown = "";

  for (let i = 0; i < original.length; ) {
    const result = system.rule(lower, i);
    if (!result && NON_LATIN.test(original[i])) {
      unknown += original[i];
      i++;
      continue;
    }
    if (unknown) {
      out += romanizeUnknown(system, unknown);
      unknown = "";
    }
    if (!result) {
      out += original[i];
      i++;
      continue;
    }
    const [latin, length] = result;
    // The case is judged by the letter after the whole match, not by its own
    // second letter (Bulgarian -ИЯ, Ukrainian ЗГ).
    out += isUpper(original[i]) ? capitalized(latin, original[i - 1], original[i + length]) : latin;
    i += length;
  }

  return unknown ? out + romanizeUnknown(system, unknown) : out;
}

/**
 * `name` with its Cyrillic romanized by the system of `country` (ISO 3166-1
 * alpha-2, null outside any). Latin letters, diacritics included, pass through.
 */
export function romanizeCyrillic(name: string, country: string | null): string {
  // NFC first: a decomposed й ё ї ў would otherwise carry its mark onto the
  // Latin letter, and only after it is a combining mark left on a Cyrillic
  // letter a stress mark (ѐ ѝ compose back into letters of their own).
  const original = [...name.normalize("NFC").replace(STRESS_MARK, "$1")];
  const lower = original.map((char) => char.toLowerCase());

  const own = (country && COUNTRY_SYSTEMS[country]) || RUSSIAN;
  const system = covers(own, lower)
    ? own
    : (FALLBACK_ORDER.find((candidate) => covers(candidate, lower)) ?? own);

  return romanizeWith(system, original, lower);
}

/**
 * A station name in Latin script. Cyrillic goes by its country's system
 * (`romanizeCyrillic`, Greek in the same name by ELOT 743), Greek by ELOT 743
 * (`romanizeGreek`), and Latin passes through. `countryAt` is asked only
 * for a Cyrillic name, since a lookup costs something and most names are Latin.
 */
export function romanizeName(name: string, countryAt: () => string | null): string {
  if (CYRILLIC.test(name)) return romanizeCyrillic(name, countryAt());
  if (GREEK.test(name)) return romanizeGreek(name);
  return name;
}
