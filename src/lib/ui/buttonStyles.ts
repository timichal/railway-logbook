/**
 * The app's button classes, in one place.
 *
 * Every control used to assemble its own string, so the same button role came out
 * differently in each file (`rounded` here, `rounded-md` there; `bg-gray-200` for one
 * Cancel and `bg-gray-300` for the next) and the *states* were whatever each site
 * remembered: some had `hover:`, a few had `disabled:`, almost none had `active:`.
 * A named class per role fixes all three at once — the roles are a short list, and a
 * state added here reaches every button that plays that role.
 *
 * **The agreed state set is: hover, active, focus-visible, disabled.**
 *
 * - `hover:` is Tailwind v4's, which emits `@media (hover: hover)` — so a hover style
 *   is not painted on a phone, and none of these leave a tapped button stuck in its
 *   highlight. That is exactly why `active:` is here as well: it is the only one of
 *   the four a touch device can show, and it was the one missing everywhere.
 * - `focus-visible:` is **not** in these strings. It is a `@layer base` rule in
 *   `globals.css` covering `button`/`a`/`[role="button"]`, which is the only way to be
 *   sure nothing was missed — including controls that never come through this module.
 * - `disabled:` is `disabled:opacity-50` for every variant, rather than the
 *   `disabled:bg-gray-400` the solid buttons used: opacity reads the same way on a
 *   soft, outlined or ghost button, so one rule covers the whole table. Hover and
 *   active are `not-disabled:`-prefixed so a dead button does not react. `not-*`
 *   rather than `enabled:` because `:enabled` never matches an `<a>`, and several of
 *   these classes are worn by a `next/link`.
 *
 * `cursor-pointer` is likewise not here — `globals.css` sets it on every enabled
 * button (and `not-allowed` on disabled ones), because applying it by hand meant
 * missing it by hand. Tailwind v4 dropped the preflight rule that used to do it.
 *
 * Call sites add **layout** — `w-full`, `flex-1`, `flex-shrink-0`, margins — and
 * nothing else. An appearance utility appended at a call site is a coin toss:
 * Tailwind resolves conflicts by source order in the generated CSS, not by the order
 * of classes in the attribute, so `${btn("primary")} rounded-lg` may or may not win.
 * If a size needs a different radius, it belongs in `SIZES`.
 */

/** Shared by every padded button. */
const BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50";

/**
 * Radius travels with the size, not with the base: the mobile sheet's full-width
 * buttons want `rounded-lg` and the dense in-card ones `rounded-md`, and a call site
 * cannot reliably override a radius (see above).
 */
const SIZES = {
  /** Dense, inside a card row or beside a heading. */
  xs: "text-xs px-2 py-1 rounded-md",
  /** The default: the action buttons inside the sidebar's cards and forms. */
  sm: "text-sm px-3 py-1.5 rounded-md",
  /** A form's own submit, and dialog buttons. */
  md: "text-sm px-4 py-2 rounded-md",
  /** The desktop navbar, whose buttons align on a common height. */
  bar: "text-sm h-10 px-4 rounded-md",
  /** Full-width on a phone; 44pt floor, so it is also the touch size. */
  lg: "text-base min-h-11 px-4 rounded-lg",
} as const;

/**
 * The solid variants' hover and active steps are written as literal hex under
 * `dark:`, and that is deliberate.
 *
 * `globals.css` flips dark mode by re-pointing Tailwind's own colour variables, and
 * the accent ramps flip at their ends: 700 and 800 are the *text* colours drawn on
 * a tinted surface, so they go light. That is right everywhere except here, where
 * `hover:bg-blue-700` means "a step deeper than the resting button" — flipped, it
 * turned a pressed primary button pale with white text still on it. An arbitrary
 * hex never goes through the palette, so these stay put whichever scheme is on.
 * (`bg-*-600` needs no override: 400–600 are exactly the steps the flip leaves
 * alone, so the resting colour is the same in both.)
 *
 * `neutral` is the exception that needs its resting colour overridden too: it is
 * built on the *grey* ramp, which inverts wholesale, so `bg-gray-600` would have
 * come out as a light grey button carrying white text.
 */
const VARIANTS = {
  // Solid — one per page region at most: the thing you came here to do.
  primary:
    "bg-blue-600 text-white not-disabled:hover:bg-blue-700 not-disabled:active:bg-blue-800 dark:not-disabled:hover:bg-[#2563eb] dark:not-disabled:active:bg-[#1d4ed8]",
  success:
    "bg-green-600 text-white not-disabled:hover:bg-green-700 not-disabled:active:bg-green-800 dark:not-disabled:hover:bg-[#15803d] dark:not-disabled:active:bg-[#166534]",
  danger:
    "bg-red-600 text-white not-disabled:hover:bg-red-700 not-disabled:active:bg-red-800 dark:not-disabled:hover:bg-[#b91c1c] dark:not-disabled:active:bg-[#991b1b]",
  neutral:
    "bg-gray-600 text-white not-disabled:hover:bg-gray-700 not-disabled:active:bg-gray-800 dark:bg-[#39414e] dark:not-disabled:hover:bg-[#454e5d] dark:not-disabled:active:bg-[#525c6d]",
  /**
   * Amber, for the two things that mean "careful, this is not the resting state":
   * the confirm button of a warning dialog, and the open half of a View / Hide pair.
   */
  warning:
    "bg-amber-600 text-white not-disabled:hover:bg-amber-700 not-disabled:active:bg-amber-800 dark:not-disabled:hover:bg-[#b45309] dark:not-disabled:active:bg-[#92400e]",
  /** `under_repair`, matching the violet the map draws those routes in. */
  repair:
    "bg-violet-600 text-white not-disabled:hover:bg-violet-700 not-disabled:active:bg-violet-800 dark:not-disabled:hover:bg-[#6d28d9] dark:not-disabled:active:bg-[#5b21b6]",

  // Tinted — secondary actions that sit in a bar or next to a heading, where a row of
  // solid buttons would all shout at once. These need nothing for dark: the tint
  // steps go dark and the text steps go light, which is the flip working as intended.
  softPrimary:
    "bg-blue-100 text-blue-700 not-disabled:hover:bg-blue-200 not-disabled:active:bg-blue-300",
  softSuccess:
    "bg-green-100 text-green-700 not-disabled:hover:bg-green-200 not-disabled:active:bg-green-300",
  softIndigo:
    "bg-indigo-100 text-indigo-700 not-disabled:hover:bg-indigo-200 not-disabled:active:bg-indigo-300",
  softDanger:
    "bg-red-100 text-red-700 not-disabled:hover:bg-red-200 not-disabled:active:bg-red-300",

  // Quiet — Cancel, Reset, pagination, and anything that must not compete with the
  // action beside it.
  subtle:
    "bg-gray-200 text-gray-700 not-disabled:hover:bg-gray-300 not-disabled:active:bg-gray-400",
  outline:
    "bg-surface text-gray-700 border border-gray-300 not-disabled:hover:bg-gray-50 not-disabled:active:bg-gray-100",
  /** Destructive, but not the main action on screen — the menu's Log out. */
  outlineDanger:
    "bg-surface text-red-700 border border-red-200 not-disabled:hover:bg-red-50 not-disabled:active:bg-red-100",
  ghost:
    "text-gray-600 not-disabled:hover:bg-gray-100 not-disabled:hover:text-gray-900 not-disabled:active:bg-gray-200",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** Classes for a padded button, or a link styled as one. Add layout at the call site. */
export function btn(variant: ButtonVariant, size: ButtonSize = "sm"): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

const ICON_SIZES = {
  /** Desktop-density glyph, in a header or card that has no room for 44pt. */
  sm: "w-8 h-8",
  /** The 44pt touch target: navbar and sheet headers. */
  md: "w-11 h-11",
  /** 44pt where a finger might land, dense where one never will. */
  responsive: "w-11 h-11 md:w-6 md:h-6",
} as const;

const ICON_TONES = {
  muted:
    "text-gray-500 not-disabled:hover:bg-gray-100 not-disabled:hover:text-gray-900 not-disabled:active:bg-gray-200",
  danger: "bg-red-100 text-red-700 not-disabled:hover:bg-red-200 not-disabled:active:bg-red-300",
  /** On a coloured surface — the toast's own background. */
  onColor: "text-white/80 not-disabled:hover:text-white not-disabled:active:text-white/70",
} as const;

export type IconButtonSize = keyof typeof ICON_SIZES;
export type IconButtonTone = keyof typeof ICON_TONES;

/** A square, label-less glyph button: close x, back chevron, remove-from-list. */
export function iconBtn(size: IconButtonSize = "md", tone: IconButtonTone = "muted"): string {
  return `inline-flex items-center justify-center flex-shrink-0 rounded-md leading-none transition-colors disabled:opacity-50 ${ICON_SIZES[size]} ${ICON_TONES[tone]}`;
}

/**
 * A text button that reads as a link — "Clear all", "Close" — where a real button
 * would outweigh what it does.
 */
export const LINK_BTN =
  "text-xs text-gray-500 underline underline-offset-2 transition-colors not-disabled:hover:text-gray-700 not-disabled:active:text-gray-900 disabled:opacity-50";

/** One tab in the sidebar tab strips (user and admin). */
export function tabBtn(active: boolean): string {
  return `flex-1 min-h-11 py-3 px-2 md:px-4 text-sm font-medium border-b-2 transition-colors ${
    active
      ? "border-blue-500 text-blue-600 bg-blue-50"
      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 active:bg-gray-100"
  }`;
}

/**
 * A full-width row in a suggestion dropdown or a picker list. `active` is the
 * keyboard/hover cursor, which is a different thing from `:hover` — the arrow keys
 * move it too.
 */
export function optionRow(active: boolean): string {
  return `w-full text-left transition-colors hover:bg-blue-50 active:bg-blue-100 ${
    active ? "bg-blue-50" : ""
  }`;
}
