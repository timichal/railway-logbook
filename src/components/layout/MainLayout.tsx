"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import MapLoading from "@/components/layout/MapLoading";
import MenuSheet, { type MenuView } from "@/components/layout/MenuSheet";
import Navbar from "@/components/layout/Navbar";
import type { ActiveTab, SetActiveTab } from "@/components/logbook/UserSidebar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import type { User } from "@/lib/authActions";
import { LayerPrefsProvider } from "@/lib/map/layerPrefsContext";
import { RegionProvider } from "@/lib/regionContext";
import type { RegionId } from "@/lib/shared/regions";
import { EditGuardProvider, useConfirmDiscard } from "@/lib/ui/editGuard";

// Dynamically import the map component to avoid SSR issues with MapLibre
const RailwayMap = dynamic(() => import("@/components/map/RailwayMap"), {
  ssr: false,
  loading: MapLoading,
});

interface MainLayoutProps {
  user: User | null;
  onLogout: () => void;
  initialSelectedCountries: string[];
  initialRegion: RegionId;
}

export default function MainLayout({ initialRegion, ...props }: MainLayoutProps) {
  return (
    <RegionProvider initialRegion={initialRegion}>
      <LayerPrefsProvider>
        <EditGuardProvider>
          <MainPage {...props} />
        </EditGuardProvider>
      </LayerPrefsProvider>
    </RegionProvider>
  );
}

function MainPage({
  user,
  onLogout,
  initialSelectedCountries,
}: Omit<MainLayoutProps, "initialRegion">) {
  const [activeTab, setActiveTabNow] = useState<ActiveTab>("routes");
  // null = closed. A view name opens the menu straight onto it (the navbar's Sign
  // in button lands on the login form rather than making the user find it).
  const [menuView, setMenuView] = useState<MenuView | null>(null);
  const isMobile = useIsMobile();
  const { sidebarWidth, isResizing, handleMouseDown } = useResizableSidebar({
    storageKey: "railway-sidebar-width",
    isMobile,
  });

  // Leaving My Trips unmounts it, and with it a journey or trip being edited
  const confirmDiscard = useConfirmDiscard();
  const setActiveTab = useCallback<SetActiveTab>(
    (tab, then) => {
      if (tab === activeTab) {
        then?.();
        return;
      }
      confirmDiscard(() => {
        setActiveTabNow(tab);
        then?.();
      });
    },
    [activeTab, confirmDiscard],
  );

  // Wrap logout to also switch to Route Logger tab. Signing out swaps the store
  // under My Journeys, so an edit there would go with it.
  const handleLogout = () =>
    confirmDiscard(() => {
      setActiveTabNow("routes");
      onLogout();
    });

  // Handle successful login/register - switch to Route Logger tab
  const handleAuthSuccess = () => {
    setActiveTabNow("routes");
  };

  // Signing in or registering swaps the store under My Journeys too. Asked as the
  // form opens rather than on submit, which would reset the form on Cancel; the
  // open menu keeps the page inert until then, so no edit can start meanwhile.
  const openMenu = (view?: MenuView) => {
    if (view === "login" || view === "register") confirmDiscard(() => setMenuView(view));
    else setMenuView(view ?? "menu");
  };

  return (
    <>
      <Navbar user={user} onLogout={handleLogout} onOpenMenu={openMenu} />

      <main className="flex-1 overflow-hidden">
        <RailwayMap
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
    </>
  );
}
