/**
 * A `Date`'s calendar day as YYYY-MM-DD, read in the local timezone — so
 * `new Date()` gives today where the user is, not the UTC day `toISOString()`
 * would. Journey dates need no conversion: they arrive as YYYY-MM-DD already.
 */
export const getUntimezonedDateStr = (date: Date): string =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split("T")[0];

/**
 * A YYYY-MM-DD day as a `Date` at local midnight, for formatting. `new Date(str)`
 * parses a date-only string as UTC midnight, which prints as the day before
 * anywhere west of UTC. Anything that isn't a bare date falls through to `Date`.
 * A day that does not exist (2026-02-31) is an Invalid Date, as `new Date(str)`
 * makes it, rather than the day the `Date` constructor would roll it over to.
 */
export const parseDateOnly = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : new Date(Number.NaN);
};

/** Whether `value` is a YYYY-MM-DD day that exists — what a journey's `date` must be. */
export const isDateOnly = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDateOnly(value).getTime());

/** Today where the user is, as YYYY-MM-DD. */
export const getTodayDateStr = (): string => getUntimezonedDateStr(new Date());
