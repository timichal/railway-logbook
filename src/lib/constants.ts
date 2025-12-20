/**
 * Railway usage types (simplified to 2 types)
 */
export const usageOptions = [
  {
    id: 0,
    key: 'REGULAR',
    label: 'Regular'
  },
  {
    id: 1,
    key: 'SPECIAL',
    label: 'Special'
  }
] as const;

// Extract the usage type ID as a union type (0 | 1)
export type UsageType = typeof usageOptions[number]['id'];

export const getUsageLabel = (usageType: UsageType): string => {
  const option = usageOptions.find(opt => opt.id === usageType);
  return option ? option.label : 'Unknown';
};

/**
 * Frequency tags for routes
 */
export const frequencyOptions = [
  {
    key: 'Daily',
    label: 'Daily'
  },
  {
    key: 'Weekdays',
    label: 'Weekdays'
  },
  {
    key: 'Weekends',
    label: 'Weekends'
  },
  {
    key: 'Once a week',
    label: 'Once a week'
  },
  {
    key: 'Seasonal',
    label: 'Seasonal'
  }
] as const;

export const getFrequencyLabel = (frequency: string): string => {
  const option = frequencyOptions.find(opt => opt.key === frequency);
  return option ? option.label : frequency;
};

/**
 * Supported countries for filtering
 */
export const SUPPORTED_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'DE', name: 'Germany' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'PL', name: 'Poland' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'CH', name: 'Switzerland' },
] as const;

