import { useCallback, useState } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import type { UserProgress } from "@/lib/progressQueries";

/**
 * Simplified hook for progress tracking
 * Trip management has been replaced with journey-based system
 */
export function useRouteEditor(dataAccess: DataAccess, selectedCountries?: string[]) {
  const [progress, setProgress] = useState<UserProgress | null>(null);

  // Refresh progress stats
  const refreshProgress = useCallback(async () => {
    try {
      const progressData = await dataAccess.getUserProgress(selectedCountries);
      setProgress(progressData);
    } catch (error) {
      console.error("Error refreshing progress:", error);
    }
  }, [dataAccess, selectedCountries]);

  // The layer toggles live in LayerPrefsProvider — they are also driven from the
  // mobile menu, which is a sibling of the map rather than a child of it.
  return {
    refreshProgress,
    progress,
  };
}
