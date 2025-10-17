/**
 * Railway usage patterns
 */
export const USAGE_OPTIONS = [
  {
    id: 0,
    key: 'REGULAR',
    label: 'Regular'
  },
  {
    id: 1,
    key: 'SEASONAL',
    label: 'Seasonal'
  },
  {
    id: 2,
    key: 'SPECIAL',
    label: 'Special'
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