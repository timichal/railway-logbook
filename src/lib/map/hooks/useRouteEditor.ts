import { useCallback, useState } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import type { UserProgress } from "@/lib/userActions";
import { loadLayerPrefs, saveLayerPref } from "../layerPrefs";

/**
 * Simplified hook for progress tracking
 * Trip management has been replaced with journey-based system
 */
export function useRouteEditor(dataAccess: DataAccess, selectedCountries?: string[]) {
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [showSpecialLines, setShowSpecialLines] = useState(() => loadLayerPrefs().showSpecialLines);

  // Refresh progress stats
  const refreshProgress = useCallback(async () => {
    try {
      const progressData = await dataAccess.getUserProgress(selectedCountries);
      setProgress(progressData);
    } catch (error) {
      console.error("Error refreshing progress:", error);
    }
  }, [dataAccess, selectedCountries]);

  // Just flips state and persists it; the actual layer filters/visibility are
  // applied by useLayerFilters (single source of truth) reacting to the change.
  const toggleShowSpecialLines = useCallback(() => {
    setShowSpecialLines((prev) => {
      const next = !prev;
      saveLayerPref("showSpecialLines", next);
      return next;
    });
  }, []);

  return {
    refreshProgress,
    progress,
    showSpecialLines,
    toggleShowSpecialLines,
  };
}
