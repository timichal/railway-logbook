/**
 * Railway usage patterns with Czech translations
 * This mirrors the USAGE constant from the root enums.ts
 */
export const USAGE_OPTIONS = [
  {
    id: 0,
    key: 'REGULAR',
    label: 'Pravidelný provoz',
    description: 'Regular service'
  },
  {
    id: 1,
    key: 'ONCE_DAILY',
    label: 'Provoz jednou denně',
    description: 'Service once daily'
  },
  {
    id: 2,
    key: 'SEASONAL',
    label: 'Sezónní provoz',
    description: 'Seasonal service'
  },
  {
    id: 3,
    key: 'ONCE_WEEKLY',
    label: 'Provoz jednou týdně',
    description: 'Service once weekly'
  },
  {
    id: 4,
    key: 'WEEKDAYS',
    label: 'Provoz o pracovních dnech',
    description: 'Weekdays service'
  },
  {
    id: 5,
    key: 'WEEKENDS',
    label: 'Provoz o víkendech',
    description: 'Weekends service'
  },
  {
    id: 6,
    key: 'SPECIAL',
    label: 'Provoz při zvláštních příležitostech',
    description: 'Special occasions service'
  }
] as const;

export const getAllUsageOptions = () => USAGE_OPTIONS;

export const getUsageById = (id: number) => {
  return USAGE_OPTIONS.find(usage => usage.id === id);
};

export const getUsageLabel = (id: number) => {
  const usage = getUsageById(id);
  return usage ? usage.label : `Unknown usage (${id})`;
};