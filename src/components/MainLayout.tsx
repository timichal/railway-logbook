"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import type { User } from "@/lib/authActions";
import { LayerPrefsProvider } from "@/lib/map/layerPrefsContext";
import { RegionProvider } from "@/lib/regionContext";
import type { RegionId } from "@/lib/regions";
import MenuSheet, { type MenuView } from "./MenuSheet";
import Navbar from "./Navbar";
import type { ActiveTab } from "./UserSidebar";

// Dynamically import the map component to avoid SSR issues with MapLibre
const VectorRailwayMap = dynamic(() => import("./VectorRailwayMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

interface MainLayoutProps {
  user: User | null;
  onLogout: () => void;
  initialSelectedCountries: string[];
  initialRegion: RegionId;
}

export default function MainLayout({
  user,
  onLogout,
  initialSelectedCountries,
  initialRegion,
}: MainLayoutProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("routes");
  // null = closed. A view name opens the menu straight onto it (the navbar's Sign
  // in button lands on the login form rather than making the user find it).
  const [menuView, setMenuView] = useState<MenuView | null>(null);
  const isMobile = useIsMobile();
  const { sidebarWidth, isResizing, handleMouseDown } = useResizableSidebar({ isMobile });

  // Wrap logout to also switch to Route Logger tab
  const handleLogout = () => {
    setActiveTab("routes");
    onLogout();
  };

  // Handle successful login/register - switch to Route Logger tab
  const handleAuthSuccess = () => {
    setActiveTab("routes");
  };

  return (
    <RegionProvider initialRegion={initialRegion}>
      <LayerPrefsProvider>
        <Navbar
          user={user}
          onLogout={handleLogout}
          onOpenMenu={(view) => setMenuView(view ?? "menu")}
        />

        <main className="flex-1 overflow-hidden">
          <VectorRailwayMap
            className="w-full h-full"
            user={user}
            initialSelectedCountries={initialSelectedCountries}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            sidebarWidth={sidebarWidth}
            onSidebarResize={handleMouseDown}
            isResizing={isResizing}
            isMobile={isMobile}
          />
        </main>

        {/* The hamburger's menu, at every width: a sheet of its own, not a strip inside
            the sidebar and not a row of buttons in the bar. */}
        {menuView && (
          <MenuSheet
            user={user}
            initialView={menuView}
            onClose={() => setMenuView(null)}
            onLogout={handleLogout}
            onAuthSuccess={handleAuthSuccess}
          />
        )}
      </LayerPrefsProvider>
    </RegionProvider>
  );
}
