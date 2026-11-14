"use client";

import dynamic from "next/dynamic";
import { useEffect, useReducer, useState } from "react";
import MapLoading from "@/components/layout/MapLoading";
import type { MenuSheetProps, MenuView } from "@/components/layout/MenuSheet";
import Navbar from "@/components/layout/Navbar";
import type { ActiveTab } from "@/components/logbook/UserSidebar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import type { User } from "@/lib/authActions";
import { usePrefetchMap } from "@/lib/map/hooks/usePrefetchMap";
import { LayerPrefsProvider } from "@/lib/map/layerPrefsContext";
import { RegionProvider } from "@/lib/regionContext";
import type { RegionId } from "@/lib/shared/regions";
import { useToast } from "@/lib/toast";
import { EditGuardProvider, useConfirmDiscard } from "@/lib/ui/editGuard";

// Dynamically import the map component to avoid SSR issues with MapLibre
const RailwayMap = dynamic(() => import("@/components/map/RailwayMap"), {
  ssr: false,
  loading: MapLoading,
});

// The menu is its own chunk: the articles and the auth forms it carries are no
// part of the first paint, and it only mounts once opened. It is preloaded once the
// page has settled (`usePreloadMenuSheet`), so the first open doesn't wait on the
// network, and a page left open across a deploy, whose chunk names the server no
// longer has, still has it. Opened before that and failing to load, it says so and
// closes again rather than throwing out of the render, which would take the page.
const loadMenuSheet = () => import("@/components/layout/MenuSheet");
const MenuSheet = dynamic(() => loadMenuSheet().catch(() => MenuUnavailable));

function MenuUnavailable({ onClose }: MenuSheetProps) {
  const { showError } = useToast();
  useEffect(() => {
    showError("Couldn't open the menu. Reload the page and try again.");
    onClose();
  }, [showError, onClose]);
  return null;
}

function usePreloadMenuSheet(): void {
  useEffect(() => {
    const preload = () => {
      loadMenuSheet().catch(() => {
        // Opening the menu asks again
      });
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(preload, { timeout: 5000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 2000);
    return () => clearTimeout(timer);
  }, []);
}

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
  usePrefetchMap();
  usePreloadMenuSheet();
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

  // A session that ended under the page (see `useSessionKeepAlive`). Sign in goes
  // straight to the form, without `openMenu`'s question: signing back in to the
  // same account keeps the drafts, and saving them is the point. Not now leaves
  // the page as it is; its saves then say why they fail.
  // Each later check is a return to the page, after which the map re-reads the
  // rides (`sessionRechecks` on RailwayMap).
  const { showConfirm } = useToast();
  const [sessionRechecks, countSessionRecheck] = useReducer((count: number) => count + 1, 0);
  useSessionKeepAlive(
    user?.id ?? null,
    () =>
      showConfirm({
        title: "Signed out",
        message: "Your session has ended. Sign in again to keep logging and to save your changes.",
        confirmLabel: "Sign in",
        cancelLabel: "Not now",
        variant: "info",
        onConfirm: () => setMenuView("login"),
      }),
    countSessionRecheck,
  );

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
          sessionRechecks={sessionRechecks}
        />
      </main>

      {/* The hamburger's menu, at every width: a sheet of its own, not a strip inside
          the sidebar and not a row of buttons in the bar. */}
      {/* Keyed by the view it opens on: the sheet reads `initialView` once, and the
          Signed out dialog's Sign in can land on a sheet already open. */}
      {menuView && (
        <MenuSheet
          key={menuView}
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
