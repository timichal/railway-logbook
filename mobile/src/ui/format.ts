/**
 * How the app writes its numbers, so a kilometre figure reads the same on every
 * screen. In the phone's locale, as the dates are (`formatDateOnly`).
 */

const KM = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;
const PERCENT = { maximumFractionDigits: 1 } as const;

/** Kilometres, always to one decimal: "1,234.5". The unit is the caller's. */
export function formatKm(km: number): string {
  return km.toLocaleString(undefined, KM);
}

/**
 * A percentage, to at most one decimal: "42%", "0.4%". The server's progress figures
 * are already whole numbers (`toUserProgress`) and print as such.
 */
export function formatPercent(percent: number): string {
  return `${percent.toLocaleString(undefined, PERCENT)}%`;
}

/** `completed` as a percentage of `total`, or null where there is no total to share. */
export function percentOf(completed: number, total: number): number | null {
  return total > 0 ? (completed / total) * 100 : null;
}
