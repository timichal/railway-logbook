/**
 * Railway usage patterns
 */
export const usageOptions = [
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

export const getUsageLabel = (usageType: number): string => {
  const option = usageOptions.find(opt => opt.id === usageType);
  return option ? option.label : 'Unknown';
};

