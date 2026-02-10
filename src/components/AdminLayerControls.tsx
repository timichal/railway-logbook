'use client';

import { useState } from 'react';

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
  isMobile?: boolean;
}

export default function AdminLayerControls({
  showPartsLayer, setShowPartsLayer,
  showRoutesLayer, setShowRoutesLayer,
  showStationsLayer, setShowStationsLayer,
  showEndpointsLayer, setShowEndpointsLayer,
  showNotesLayer, setShowNotesLayer,
  isMobile = false,
}: AdminLayerControlsProps) {
  const [collapsed, setCollapsed] = useState(isMobile);

  const layers = [
    { label: 'Railway Parts', checked: showPartsLayer, toggle: setShowPartsLayer },
    { label: 'Railway Routes', checked: showRoutesLayer, toggle: setShowRoutesLayer },
    { label: 'Stations', checked: showStationsLayer, toggle: setShowStationsLayer },
    { label: 'Route Endpoints', checked: showEndpointsLayer, toggle: setShowEndpointsLayer },
    { label: 'Admin Notes', checked: showNotesLayer, toggle: setShowNotesLayer },
  ];

  if (isMobile && collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-3 left-3 bg-white p-2 rounded shadow-lg text-black z-10 text-xs font-medium cursor-pointer hover:bg-gray-50"
      >
        Layers
      </button>
    );
  }

  return (
    <div className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
      isMobile ? 'top-3 left-3' : 'top-4 left-4'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">Layers</h3>
        {isMobile && (
          <button
            onClick={() => setCollapsed(true)}
            className="ml-3 text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
            aria-label="Collapse layers"
          >
            &times;
          </button>
        )}
      </div>
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
