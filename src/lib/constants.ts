/**
 * Railway usage types. The axis is "what system is it, and how is it published?":
 * 0 = Regular — in the official national timetable / route planner, published in
 *     advance. Any frequency counts (even a once-a-day summer-Saturday-only train);
 *     rarity is captured by frequency tags, not by this field. Counts toward stats
 *     and the journey planner.
 * 1 = Heritage & tourist — its own line, outside the national timetable, published
 *     through the operator's own channels. Museum and preserved railways, but also
 *     commercially-run tourist lines (rack railways, funiculars, resort lines) that
 *     may run daily to a dependable published schedule — the discriminator is the
 *     separate system and the separate timetable, not the age of the stock or how
 *     reliable the service is. Service character (daily, seasonal, weekends-only,
 *     winter break) belongs in the frequency tags. Drawn dotted; revealed by the
 *     "Show heritage & tourist lines" toggle.
 * 2 = Special — national infrastructure, but irregular ad-hoc passenger use:
 *     diversions during engineering works, festival/anniversary runs, marketed
 *     tourist specials. "You never know until they announce it." Drawn dashed;
 *     revealed by the "Show special services" toggle.
 * So types 1 and 2 split on whose track and whose timetable, not on what kind of
 * train: a tourist railway on its own line is 1, a tourist special routed over the
 * national network is 2. Both are "special" (non-regular): excluded from stats and
 * the planner. Each has its own independent toggle.
 */
export const usageOptions = [
  {
    id: 0,
    key: "REGULAR",
    label: "Regular",
    // Blue
    color: "#2563eb",
    bgColor: "#dbeafe",
  },
  {
    id: 1,
    key: "HERITAGE",
    label: "Heritage & tourist",
    // Purple
    color: "#9333ea",
    bgColor: "#f3e8ff",
  },
  {
    id: 2,
    key: "SPECIAL",
    label: "Special",
    // Teal
    color: "#0d9488",
    bgColor: "#ccfbf1",
  },
] as const;

// Extract the usage type ID as a union type (0 | 1 | 2)
export type UsageType = (typeof usageOptions)[number]["id"];

/** A route is "special" (non-regular) when it is anything other than Regular. */
export const isSpecialUsage = (usageType: UsageType): boolean => usageType !== 0;

export const getUsageLabel = (usageType: UsageType): string => {
  const option = usageOptions.find((opt) => opt.id === usageType);
  return option ? option.label : "Unknown";
};

export const getUsageBadgeColors = (usageType: UsageType): { color: string; bgColor: string } => {
  const option = usageOptions.find((opt) => opt.id === usageType);
  return option
    ? { color: option.color, bgColor: option.bgColor }
    : { color: "#374151", bgColor: "#e5e7eb" };
};

/**
 * Line class options (derived from OSM data)
 */
export const lineClassOptions = [
  { id: "highspeed", label: "High-speed" },
  { id: "main", label: "Main" },
  { id: "branch", label: "Branch" },
] as const;

export type LineClass = (typeof lineClassOptions)[number]["id"];

export const getLineClassLabel = (lineClass: LineClass): string => {
  const option = lineClassOptions.find((opt) => opt.id === lineClass);
  return option ? option.label : "Unknown";
};

/**
 * Admin note types. Every note has one — the column is NOT NULL.
 *
 * Only `public: true` types are shown on the public user map. "Usage" is the
 * published, public-facing type; "UsageInternal" ("Usage (internal)") is an
 * admin-only draft that the admin manually promotes to "Usage" once reviewed.
 */
export const noteTypeOptions = [
  { id: "Usage", label: "Usage", color: "#2563eb", public: true }, // blue
  { id: "UsageInternal", label: "Usage (internal)", color: "#60a5fa", public: false }, // light blue (draft)
  { id: "Works", label: "Works", color: "#ea580c", public: false }, // orange
  { id: "Todo", label: "Todo", color: "#9333ea", public: false }, // purple
] as const;

export type NoteType = (typeof noteTypeOptions)[number]["id"];

const noteTypeById = Object.fromEntries(noteTypeOptions.map((opt) => [opt.id, opt])) as Record<
  NoteType,
  (typeof noteTypeOptions)[number]
>;

export const getNoteTypeColor = (noteType: NoteType): string => noteTypeById[noteType].color;

/** Display label for a note type. */
export const getNoteTypeLabel = (noteType: NoteType): string => noteTypeById[noteType].label;

/** Whether a note type is shown on the public user map (only published "Usage"). */
export const isPublicNoteType = (noteType: NoteType): boolean => noteTypeById[noteType].public;

/**
 * Supported countries for filtering
 */
export const SUPPORTED_COUNTRIES = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "ES", name: "Spain" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "SE", name: "Sweden" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "CH", name: "Switzerland" },
] as const;
