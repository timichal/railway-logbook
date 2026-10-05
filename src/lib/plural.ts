/** "1 route", "3 routes" — a count with its noun, for regular English plurals. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count !== 1 ? "s" : ""}`;
}
