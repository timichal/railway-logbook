interface LayerControlsProps {
  showPartsLayer: boolean;
  showRoutesLayer: boolean;
  onTogglePartsLayer: () => void;
  onToggleRoutesLayer: () => void;
}

/**
 * Map layer toggle controls component
 */
export default function LayerControls({
  showPartsLayer,
  showRoutesLayer,
  onTogglePartsLayer,
  onToggleRoutesLayer
}: LayerControlsProps) {
  return (
    <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-[1000] min-w-[160px]">
      <div className="text-sm font-semibold text-gray-700 mb-2">Map Layers</div>
      <div className="space-y-2">
        <button
          onClick={onTogglePartsLayer}
          className={`flex items-center gap-2 w-full text-left p-2 rounded-md text-sm transition-colors ${
            showPartsLayer
              ? 'bg-blue-100 text-blue-800 border border-blue-300'
              : 'bg-gray-100 text-gray-600 border border-gray-300'
          }`}
        >
          <div className={`w-3 h-3 rounded-full ${showPartsLayer ? 'bg-blue-600' : 'bg-gray-400'}`}></div>
          <span>Railway Parts</span>
          <div className="text-xs text-gray-500 ml-auto">
            {showPartsLayer ? 'ON' : 'OFF'}
          </div>
        </button>

        <button
          onClick={onToggleRoutesLayer}
          className={`flex items-center gap-2 w-full text-left p-2 rounded-md text-sm transition-colors ${
            showRoutesLayer
              ? 'bg-red-100 text-red-800 border border-red-300'
              : 'bg-gray-100 text-gray-600 border border-gray-300'
          }`}
        >
          <div className={`w-3 h-3 rounded-full ${showRoutesLayer ? 'bg-red-600' : 'bg-gray-400'}`}></div>
          <span>Railway Routes</span>
          <div className="text-xs text-gray-500 ml-auto">
            {showRoutesLayer ? 'ON' : 'OFF'}
          </div>
        </button>
      </div>
    </div>
  );
}
