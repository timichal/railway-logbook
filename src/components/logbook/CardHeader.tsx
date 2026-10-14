import type { ReactNode } from "react";
import Icon from "@/components/ui/Icon";

interface CardHeaderProps {
  title: string;
  /** Before the title, on its line — the trip card's "Trip" tag. */
  badge?: ReactNode;
  description: string | null;
  /** The stats line under the description. */
  meta: string;
  isOpen: boolean;
  onToggle: () => void;
  /**
   * The card has an edit that isn't saved. Shown open or closed: a card closed
   * mid-edit keeps the edit (see `editGuard`) and picks it up when reopened.
   */
  unsaved?: boolean;
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
  unsaved = false,
}: CardHeaderProps) {
  const clamp = isOpen ? "whitespace-pre-wrap break-words" : "truncate";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors focus-visible:-outline-offset-2 hover:bg-gray-500/5 active:bg-gray-500/10 ${isOpen ? "rounded-t" : "rounded"}`}
    >
      <span className="flex-1 min-w-0 block">
        <span className="flex items-baseline gap-2 min-w-0">
          {badge}
          <span
            className={`font-semibold text-sm min-w-0 ${clamp}`}
            title={isOpen ? undefined : title}
          >
            {title}
          </span>
          {unsaved && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 flex-shrink-0 tracking-wide">
              Unsaved
            </span>
          )}
        </span>
        {description && (
          <span
            className={`block text-xs text-gray-500 mt-0.5 ${clamp}`}
            title={isOpen ? undefined : description}
          >
            {description}
          </span>
        )}
        <span className="block text-xs text-gray-600 mt-0.5">{meta}</span>
      </span>
      <Icon
        name="chevronRight"
        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
      />
    </button>
  );
}
