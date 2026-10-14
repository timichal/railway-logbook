"use client";

import { useState } from "react";
import IconButton from "@/components/ui/IconButton";
import {
  ADMIN_LAYERS,
  type AdminLayerKey,
  type AdminLayerVisibility,
} from "@/lib/map/hooks/useAdminLayerVisibility";
import { useRegion } from "@/lib/regionContext";

interface AdminLayerControlsProps {
  visible: AdminLayerVisibility;
  toggle: (key: AdminLayerKey) => void;
  isMobile?: boolean;
}

export default function AdminLayerControls({
  visible,
  toggle,
  isMobile = false,
}: AdminLayerControlsProps) {
  const [collapsed, setCollapsed] = useState(isMobile);
  const region = useRegion();
  const layers = ADMIN_LAYERS.filter((layer) => !("offeredIn" in layer) || layer.offeredIn(region));

  if (isMobile && collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="absolute top-3 left-3 bg-surface p-2 rounded shadow-lg text-fg z-10 text-xs font-medium transition-colors hover:bg-gray-50 active:bg-gray-100"
      >
        Layers
      </button>
    );
  }

  return (
    <div
      className={`absolute bg-surface p-3 rounded shadow-lg text-fg z-10 ${
        isMobile ? "top-3 left-3" : "top-4 left-4"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">Layers</h3>
        {isMobile && (
          <IconButton
            icon="close"
            label="Collapse layers"
            onClick={() => setCollapsed(true)}
            size="sm"
            className="ml-3"
          />
        )}
      </div>
      <div className="space-y-2">
        {layers.map(({ key, label }) => (
          <label key={key} className="flex items-center">
            <input
              type="checkbox"
              checked={visible[key]}
              onChange={() => toggle(key)}
              className="mr-2"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
