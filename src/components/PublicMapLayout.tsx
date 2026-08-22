"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import { RegionProvider } from "@/lib/regionContext";
import type { RegionId } from "@/lib/regions";
import RegionSwitch from "./RegionSwitch";

// Same reason as the interactive map: MapLibre can't be server-rendered.
const PublicRailwayMap = dynamic(() => import("./PublicRailwayMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

interface PublicMapLayoutProps {
  token: string;
  ownerId: number;
  ownerName: string;
  selectedCountries: string[];
  initialRegion: RegionId;
}

/**
 * Chrome around a shared map: whose map it is, the region switch, and the way
 * out to the visitor's own map. Nothing else — no auth controls, no articles,
 * no sidebar to toggle, so the bar stays the same on mobile as on desktop.
 */
export default function PublicMapLayout({
  token,
  ownerId,
  ownerName,
  selectedCountries,
  initialRegion,
}: PublicMapLayoutProps) {
  const isMobile = useIsMobile();

  return (
    <RegionProvider initialRegion={initialRegion}>
      <header className="bg-white border-b border-gray-200 px-3 py-2 md:px-4 md:py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold text-gray-900 truncate">
              {ownerName}&apos;s Railway Logbook
            </h1>
            <p className="hidden md:block text-gray-600 mt-1 text-sm">
              A shared, read-only view of someone else&apos;s rail journeys.
            </p>
          </div>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <RegionSwitch compact={isMobile} />
            <Link
              href="/"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 md:py-2 md:px-4 rounded-md text-xs md:text-sm whitespace-nowrap"
            >
              Go to my own map
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <PublicRailwayMap
          token={token}
          ownerId={ownerId}
          selectedCountries={selectedCountries}
          isMobile={isMobile}
        />
      </main>
    </RegionProvider>
  );
}
