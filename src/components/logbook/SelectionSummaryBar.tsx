"use client";

import { useBottomSheet } from "@/components/ui/MobileBottomSheet";
import { selectionLengthKm } from "@/lib/selectedRoutes";
import type { SelectedRoute } from "@/lib/shared/types";
import { btn } from "@/lib/ui/buttonStyles";

interface SelectionSummaryBarProps {
  routes: SelectedRoute[];
  /** Brings the new-journey form into view; the sheet is raised here, first. */
  onLog: () => void;
  /**
   * Why no journey can be created (the anonymous journey limit). Shown in place of
   * the button, which would otherwise lead only to a disabled one.
   */
  blockedReason?: string | null;
}

/**
 * What the mobile sheet shows at its peek snap while routes are selected: how many,
 * how far, and the way to the form. Routes are picked on the map with the sheet
 * mostly down, and this is the one line worth keeping in sight while doing so.
 */
export default function SelectionSummaryBar({
  routes,
  onLog,
  blockedReason,
}: SelectionSummaryBarProps) {
  const sheet = useBottomSheet();

  return (
    <div className="h-full flex items-center gap-3 px-4 pb-2 text-fg">
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold">
          {routes.length} route{routes.length === 1 ? "" : "s"} ·{" "}
          {selectionLengthKm(routes).toFixed(1)} km
        </div>
        <div className={`text-xs ${blockedReason ? "text-orange-700" : "text-gray-500"}`}>
          {blockedReason ?? "Selected for a new journey"}
        </div>
      </div>
      {!blockedReason && (
        <button
          type="button"
          onClick={() => {
            sheet?.snapTo("full");
            onLog();
          }}
          className={`${btn("success", "lg")} flex-shrink-0`}
        >
          Log journey
        </button>
      )}
    </div>
  );
}
