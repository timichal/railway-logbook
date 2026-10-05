import type { ReactNode } from "react";

/** "1 route", "3 routes" — for the stats line. */
export function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

interface CardHeaderProps {
  title: string;
  /** Before the title, on its line — the trip card's "Trip" tag. */
  badge?: ReactNode;
  description: string | null;
  /** The stats line under the description. */
  meta: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  /**
   * While the card is being edited: collapsing it would drop the edit, so the
   * header stops toggling and Save / Cancel are the way out.
   */
  locked?: boolean;
}

/**
 * The always-visible top of a My Trips card, and the tap target that opens and
 * closes it — the whole row rather than a button beside it, which left the name
 * squeezed into what the buttons did not take.
 *
 * Collapsed, the title and the description each keep to one line and end in an
 * ellipsis; open, both are shown in full.
 */
export default function CardHeader({
  title,
  badge,
  description,
  meta,
  isOpen,
  onToggle,
  locked = false,
}: CardHeaderProps) {
  const clamp = isOpen ? "whitespace-pre-wrap break-words" : "truncate";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={locked}
      aria-expanded={isOpen}
      className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors focus-visible:-outline-offset-2 not-disabled:hover:bg-gray-500/5 not-disabled:active:bg-gray-500/10 disabled:cursor-default ${isOpen ? "rounded-t" : "rounded"}`}
    >
      <span className="flex-1 min-w-0 block">
        <span className="flex items-baseline gap-2 min-w-0">
          {badge}
          <span className={`font-semibold text-sm min-w-0 ${clamp}`}>{title}</span>
        </span>
        {description && (
          <span className={`block text-xs text-gray-500 mt-0.5 ${clamp}`}>{description}</span>
        )}
        <span className="block text-xs text-gray-600 mt-0.5">{meta}</span>
      </span>
      {!locked && (
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}
