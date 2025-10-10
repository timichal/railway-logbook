interface MapLoadingIndicatorProps {
  isLoading: boolean;
}

/**
 * Loading indicator component for map data loading
 */
export default function MapLoadingIndicator({ isLoading }: MapLoadingIndicatorProps) {
  if (!isLoading) return null;

  return (
    <div className="absolute top-4 right-4 bg-white bg-opacity-90 px-3 py-2 rounded-lg shadow-lg z-[1000]">
      <div className="flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <span className="text-sm font-medium">Loading railway data...</span>
      </div>
    </div>
  );
}
