/**
 * Field classes for the auth forms, the app's only two forms that are a *screen*
 * rather than a row in a panel — they get the whole menu sheet on mobile, and they
 * are the first thing a new visitor is asked to fill in.
 *
 * The values are the house input style already spelled out by hand across the admin
 * forms (`w-full px-3 py-2 border border-gray-300 rounded-md … focus:ring-2
 * focus:ring-blue-500`), named here so the two forms cannot drift from each other.
 * This is deliberately not a sweep of every input in the app — see
 * `buttonStyles.ts` for the same idea carried all the way through.
 *
 * No `focus:outline-none`: `globals.css` leaves inputs out of its `:focus-visible`
 * rule precisely so the ring can be the whole focus indicator, and inputs get no
 * default outline worth suppressing.
 */

export const FIELD_LABEL = "block text-sm font-medium text-gray-700 mb-1.5";

export const FIELD =
  "w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm text-fg placeholder-gray-400 transition-colors focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

/** Under-field hint. Says what the server would otherwise only say after a refusal. */
export const FIELD_HINT = "mt-1.5 text-xs text-gray-500";

/** Whole-form error, above the submit button. Pair with `role="alert"`. */
export const FORM_ERROR =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700";
