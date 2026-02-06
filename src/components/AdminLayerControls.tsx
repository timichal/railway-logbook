'use client';

interface AdminLayerControlsProps {
  showPartsLayer: boolean;
  setShowPartsLayer: (v: boolean) => void;
  showRoutesLayer: boolean;
  setShowRoutesLayer: (v: boolean) => void;
  showStationsLayer: boolean;
  setShowStationsLayer: (v: boolean) => void;
  showEndpointsLayer: boolean;
  setShowEndpointsLayer: (v: boolean) => void;
  showNotesLayer: boolean;
  setShowNotesLayer: (v: boolean) => void;
}

export default function AdminLayerControls({
  showPartsLayer, setShowPartsLayer,
  showRoutesLayer, setShowRoutesLayer,
  showStationsLayer, setShowStationsLayer,
  showEndpointsLayer, setShowEndpointsLayer,
  showNotesLayer, setShowNotesLayer,
}: AdminLayerControlsProps) {
  const layers = [
    { label: 'Railway Parts', checked: showPartsLayer, toggle: setShowPartsLayer },
    { label: 'Railway Routes', checked: showRoutesLayer, toggle: setShowRoutesLayer },
    { label: 'Stations', checked: showStationsLayer, toggle: setShowStationsLayer },
    { label: 'Route Endpoints', checked: showEndpointsLayer, toggle: setShowEndpointsLayer },
    { label: 'Admin Notes', checked: showNotesLayer, toggle: setShowNotesLayer },
  ];

  return (
    <div className="absolute top-4 left-4 bg-white p-3 rounded shadow-lg text-black z-10">
      <h3 className="font-bold mb-2">Layers</h3>
      <div className="space-y-2">
        {layers.map(({ label, checked, toggle }) => (
          <label key={label} className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(!checked)}
              className="mr-2"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
