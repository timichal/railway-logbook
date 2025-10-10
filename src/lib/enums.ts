/**
 * Railway usage patterns with Czech translations
 */
export const USAGE = {
  REGULAR: {
    id: 0,
    key: 'REGULAR',
    label: 'Pravidelný provoz',
    description: 'Regular service'
  },
  ONCE_DAILY: {
    id: 1,
    key: 'ONCE_DAILY',
    label: 'Provoz jednou denně',
    description: 'Service once daily'
  },
  SEASONAL: {
    id: 2,
    key: 'SEASONAL',
    label: 'Sezónní provoz',
    description: 'Seasonal service'
  },
  ONCE_WEEKLY: {
    id: 3,
    key: 'ONCE_WEEKLY',
    label: 'Provoz jednou týdně',
    description: 'Service once weekly'
  },
  WEEKDAYS: {
    id: 4,
    key: 'WEEKDAYS',
    label: 'Provoz o pracovních dnech',
    description: 'Weekdays service'
  },
  WEEKENDS: {
    id: 5,
    key: 'WEEKENDS',
    label: 'Provoz o víkendech',
    description: 'Weekends service'
  },
  SPECIAL: {
    id: 6,
    key: 'SPECIAL',
    label: 'Provoz při zvláštních příležitostech',
    description: 'Special occasions service'
  }
} as const;

/**
 * Railway operators by region
 */
export const OPERATORS = {
  // Czech Republic
  ČD: {
    code: 'ČD',
    name: 'České dráhy',
    country: 'CZ',
    region: 'Czech Republic'
  },
  GW: {
    code: 'GW',
    name: 'GW Train Regio',
    country: 'CZ',
    region: 'Czech Republic'
  },
  RC: {
    code: 'RC',
    name: 'Railway Capital',
    country: 'CZ',
    region: 'Czech Republic'
  },
  DLB: {
    code: 'DLB',
    name: 'Die Länderbahn',
    country: 'CZ',
    region: 'Czech Republic'
  },
  RJ: {
    code: 'RJ',
    name: 'RegioJet',
    country: 'CZ',
    region: 'Czech Republic'
  },
  ARR: {
    code: 'ARR',
    name: 'Arriva',
    country: 'CZ',
    region: 'Czech Republic'
  },
  MPD: {
    code: 'MPD',
    name: 'Mladějovská průmyslová dráha',
    country: 'CZ',
    region: 'Czech Republic'
  },
  MBM: {
    code: 'MBM',
    name: 'MBM Rail',
    country: 'CZ',
    region: 'Czech Republic'
  },
  VL: {
    code: 'VL',
    name: 'Vltavotýnská lokálka',
    country: 'CZ',
    region: 'Czech Republic'
  },
  KŽC: {
    code: 'KŽC',
    name: 'KŽC Doprava',
    country: 'CZ',
    region: 'Czech Republic'
  },
  AŽD: {
    code: 'AŽD',
    name: 'AŽD Praha',
    country: 'CZ',
    region: 'Czech Republic'
  },
  LE: {
    code: 'LE',
    name: 'Leo Express',
    country: 'CZ',
    region: 'Czech Republic'
  },
  // Austria
  ÖBB: {
    code: 'ÖBB',
    name: 'ÖBB',
    country: 'AT',
    region: 'Austria'
  },
  NÖB: {
    code: 'NÖB',
    name: 'Niederösterreich Bahnen',
    country: 'AT',
    region: 'Austria'
  },
  WSV: {
    code: 'WSV',
    name: 'Waldviertler Schmalspurbahnverein',
    country: 'AT',
    region: 'Austria'
  },
  ZVT: {
    code: 'ZVT',
    name: 'Zillertaler Verkehrsbetriebe',
    country: 'AT',
    region: 'Austria'
  },
  ASB: {
    code: 'ASB',
    name: 'Achenseebahn Infrastruktur- und Betriebs-GmbH',
    country: 'AT',
    region: 'Austria'
  },
  SBL: {
    code: 'SBL',
    name: 'Salzburg Linien',
    country: 'AT',
    region: 'Austria'
  },
  NBK: {
    code: 'NBK',
    name: 'Nostalgiebahnen in Kärnten',
    country: 'AT',
    region: 'Austria'
  },
  IVB: {
    code: 'IVB',
    name: 'Innsbrucker Verkehrsbetriebe und Stubaitalbahn',
    country: 'AT',
    region: 'Austria'
  },
  SHF: {
    code: 'SHF',
    name: 'Stern Hafferl Verkehr',
    country: 'AT',
    region: 'Austria'
  },
  STB: {
    code: 'STB',
    name: 'Steiermärkische Landesbahnen',
    country: 'AT',
    region: 'Austria'
  },
  TRB: {
    code: 'TRB',
    name: 'Taurachbahn',
    country: 'AT',
    region: 'Austria'
  }
} as const;

// Type utilities for better type safety
export type UsageKey = keyof typeof USAGE;
export type UsageValue = typeof USAGE[UsageKey];
export type UsageId = UsageValue['id'];

export type OperatorCode = keyof typeof OPERATORS;
export type OperatorValue = typeof OPERATORS[OperatorCode];
export type Country = OperatorValue['country'];

// Utility functions
export const getUsageById = (id: number): UsageValue | undefined => {
  return Object.values(USAGE).find(usage => usage.id === id);
};

export const getUsageByKey = (key: UsageKey): UsageValue => {
  return USAGE[key];
};

export const getOperatorByCode = (code: OperatorCode): OperatorValue => {
  return OPERATORS[code];
};

export const getOperatorsByCountry = (country: Country): OperatorValue[] => {
  return Object.values(OPERATORS).filter(op => op.country === country);
};

export const getAllUsageOptions = (): UsageValue[] => {
  return Object.values(USAGE);
};

export const getAllOperatorCodes = (): OperatorCode[] => {
  return Object.keys(OPERATORS) as OperatorCode[];
};

// Legacy enum compatibility (for backward compatibility if needed)
/** @deprecated Use USAGE constant instead */
export const Usage = {
  Regular: USAGE.REGULAR.id,
  OnceDaily: USAGE.ONCE_DAILY.id,
  Seasonal: USAGE.SEASONAL.id,
  OnceWeekly: USAGE.ONCE_WEEKLY.id,
  Weekdays: USAGE.WEEKDAYS.id,
  Weekends: USAGE.WEEKENDS.id,
  Special: USAGE.SPECIAL.id,
} as const;

/** @deprecated Use OPERATORS constant instead */
export const Operator = Object.fromEntries(
  Object.entries(OPERATORS).map(([code, data]) => [code, data.name])
) as Record<OperatorCode, string>;
