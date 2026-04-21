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

/**
 * Line class options (derived from OSM data)
 */
export const lineClassOptions = [
  { id: 'highspeed', label: 'High-speed' },
  { id: 'main', label: 'Main' },
  { id: 'branch', label: 'Branch' },
] as const;

export type LineClass = typeof lineClassOptions[number]['id'];

export const getLineClassLabel = (lineClass: LineClass): string => {
  const option = lineClassOptions.find(opt => opt.id === lineClass);
  return option ? option.label : 'Unknown';
};

export const getFrequencyLabel = (frequency: string): string => {
  const option = frequencyOptions.find(opt => opt.key === frequency);
  return option ? option.label : frequency;
};

/**
 * Admin note types (optional categorization).
 * Legacy notes stored before this feature have NULL `note_type`.
 */
export const noteTypeOptions = [
  { id: 'Usage', label: 'Usage', color: '#2563eb' },   // blue
  { id: 'Works', label: 'Works', color: '#ea580c' },   // orange
  { id: 'Todo',  label: 'Todo',  color: '#9333ea' },   // purple
] as const;

export type NoteType = typeof noteTypeOptions[number]['id'];

export const NO_TYPE_COLOR = '#fbbf24'; // amber (legacy / untyped notes)

export const getNoteTypeColor = (noteType: NoteType | null | undefined): string => {
  if (!noteType) return NO_TYPE_COLOR;
  const option = noteTypeOptions.find((opt) => opt.id === noteType);
  return option ? option.color : NO_TYPE_COLOR;
};

/**
 * Supported countries for filtering
 */
export const SUPPORTED_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'IT', name: 'Italy' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'PL', name: 'Poland' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'CH', name: 'Switzerland' },
] as const;

