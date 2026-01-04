import { getUsageLabel, type UsageType } from '@/lib/constants';

/**
 * Format route metadata as color-coded badges for tooltips
 */
export function formatRouteMetadataBadges(properties: {
  usage_type: UsageType;
  scenic?: boolean;
  frequency?: string;
}): string {
  let badges = "";

  // Usage type badge
  const usageLabel = getUsageLabel(properties.usage_type);
  const usageColor = properties.usage_type === 1 ? '#9333ea' : '#2563eb'; // Purple for Special, Blue for Regular
  const usageBgColor = properties.usage_type === 1 ? '#f3e8ff' : '#dbeafe';
  badges += `<span style="background-color: ${usageBgColor}; color: ${usageColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${usageLabel}</span>`;

  // Scenic badge
  if (properties.scenic) {
    badges += ` <span style="background-color: #fbbf24; color: #78350f; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Scenic</span>`;
  }

  // Frequency badges
  if (properties.frequency && properties.frequency !== "{}") {
    const frequencies = properties.frequency.slice(1, -1).split(',').map((f: string) => f.trim().replaceAll('"', ''));
    badges += frequencies.map((freq: string) =>
      ` <span style="background-color: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-right: 4px;">${freq}</span>`
    ).join('');
    badges += `<br />`;
  }

  return badges;
}
