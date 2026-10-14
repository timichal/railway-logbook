"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import MapLoading from "@/components/layout/MapLoading";
import MenuSheet, { type MenuView } from "@/components/layout/MenuSheet";
import Navbar from "@/components/layout/Navbar";
import type { ActiveTab } from "@/components/logbook/UserSidebar";
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
        <EditGuardProvider owner={props.user?.id ?? null}>
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
  const [activeTab, setActiveTab] = useState<ActiveTab>("routes");
  // null = closed. A view name opens the menu straight onto it (the navbar's Sign
  // in button lands on the login form rather than making the user find it).
  const [menuView, setMenuView] = useState<MenuView | null>(null);
  const isMobile = useIsMobile();
  const { sidebarWidth, isResizing, handleMouseDown } = useResizableSidebar({
    storageKey: "railway-sidebar-width",
    isMobile,
  });

  // Signing out swaps the account under My Trips, and the edit guard drops the
  // drafts made against the old one, so it asks first. Also switches to the Route
  // Logger tab, and closes the menu if that is where it came from — only once the
  // answer is in, so Keep editing leaves the menu as it was.
  const confirmDiscard = useConfirmDiscard();
  const handleLogout = () =>
    confirmDiscard(() => {
      setActiveTab("routes");
      setMenuView(null);
      onLogout();
    });

  // The cookie is already gone (the form refreshes the page), and with the account
  // went everything a draft was for, so nothing is asked
  const handleAccountDeleted = () => {
    setActiveTab("routes");
    setMenuView(null);
  };

  // Handle successful login/register - switch to Route Logger tab
  const handleAuthSuccess = () => {
    setActiveTab("routes");
  };

  // Signing in or registering swaps the account too. Asked as the form opens
  // rather than on submit, which would reset the form on Cancel; the open menu
  // keeps the page inert until then, so no edit can start meanwhile. Nothing is
  // dropped until the sign-in goes through.
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
          onAccountDeleted={handleAccountDeleted}
        />
      )}
    </>
  );
}
