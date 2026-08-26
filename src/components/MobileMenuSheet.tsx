"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import type { User } from "@/lib/authActions";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";
import HowToUseArticle from "./HowToUseArticle";
import LayerToggles from "./LayerToggles";
import LoginForm from "./LoginForm";
import RailwayNotesArticle from "./RailwayNotesArticle";
import RegionSwitch from "./RegionSwitch";
import RegisterForm from "./RegisterForm";

/**
 * What the hamburger opens on mobile: a full-height menu, separate from the tab
 * content of the bottom sheet.
 *
 * It replaces `MobileMenuPanel`, which was a permanent two-row chip strip pinned
 * inside the sidebar — it ate the top of a pane that has no room to spare, and it
 * expanded Login/Register *inline*, so signing in meant scrolling a form inside a
 * ~300px box. Here the form gets the whole sheet.
 *
 * The articles open as a **drill-down of the menu** rather than as a sidebar tab:
 * they are full-screen reading, they have nothing to do with logging a journey, and
 * arriving at one through the menu means the way back out is the same back arrow
 * that brought you in. (Desktop still opens them in the sidebar from the navbar.)
 *
 * **The rows are deliberately monochrome.** Colouring each entry differently (the
 * chip strip's blue/green/indigo/red) reads as decoration and says nothing: in a
 * list where everything is coloured, colour cannot mark out the one row that is
 * destructive. So the rows are neutral, the icon carries the identity, and red is
 * spent only on Logout.
 *
 * Mounted only while open (the caller conditions on it), so closing resets the view
 * and the slide-up animation runs on every open.
 */

interface MobileMenuSheetProps {
  user: User | null;
  onClose: () => void;
  onLogout: () => void;
  onAuthSuccess: () => void;
  /** Opened straight into a sub-view — the navbar's Sign in button lands on "login". */
  initialView?: MenuView;
}

export type MenuView = "menu" | "login" | "register" | "howto" | "notes";

const ICON_PATHS = {
  howTo:
    "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  notes:
    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  admin:
    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
} as const;

function Icon({ path, className = "w-5 h-5" }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={path} />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="w-4 h-4 text-gray-300 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Full-width list row; 56px clears the 44pt touch floor without feeling stretched. */
const ROW =
  "w-full flex items-center gap-3.5 min-h-14 px-4 text-left text-base text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100";

function Row({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      <Icon path={icon} className="w-5 h-5 text-gray-400 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      <Chevron />
    </button>
  );
}

const CHEVRON_LEFT = "M15 19l-7-7 7-7";
const CROSS = "M6 18L18 6M6 6l12 12";

function IconButton({
  onClick,
  label,
  path,
}: {
  onClick: () => void;
  label: string;
  path: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={iconBtn("md")}>
      <Icon path={path} />
    </button>
  );
}

export default function MobileMenuSheet({
  user,
  onClose,
  onLogout,
  onAuthSuccess,
  initialView = "menu",
}: MobileMenuSheetProps) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  const [view, setView] = useState<MenuView>(initialView);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleAuthSuccess = () => {
    onAuthSuccess();
    onClose();
  };

  const backToMenu = () => setView("menu");

  const TITLES: Record<MenuView, string> = {
    menu: "Menu",
    login: "Sign in",
    register: "Create account",
    howto: "How To Use",
    notes: "Railway Notes",
  };

  let body: ReactNode;
  if (view === "login") {
    body = (
      <div className="p-4">
        <LoginForm onSuccess={handleAuthSuccess} />
      </div>
    );
  } else if (view === "register") {
    body = (
      <div className="p-4">
        <RegisterForm onSuccess={handleAuthSuccess} />
      </div>
    );
  } else if (view === "howto") {
    body = <HowToUseArticle onClose={backToMenu} showHeader={false} />;
  } else if (view === "notes") {
    body = <RailwayNotesArticle onClose={backToMenu} showHeader={false} />;
  } else {
    body = (
      <>
        {user && (
          <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
            <span className="w-10 h-10 flex-shrink-0 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center uppercase">
              {(user.name || user.email).charAt(0)}
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-gray-900 truncate">
                {user.name || user.email}
              </span>
              {user.name && (
                <span className="block text-sm text-gray-500 truncate">{user.email}</span>
              )}
            </span>
          </div>
        )}

        {/* The region is the one setting that changes what the whole app is showing,
            so it leads the menu instead of hiding in the navbar's spare corner. */}
        <div className="px-4 py-4 border-b border-gray-100">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
            Region
          </span>
          <RegionSwitch stretch />
        </div>

        {/* The layer switches used to sit in the map's own corner box. They are
            settings, not readouts, and map space on a phone is the scarcest thing
            here — so they live in the menu and the box keeps only the numbers. */}
        <div className="px-4 py-4 border-b border-gray-100">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
            Show on map
          </span>
          <LayerToggles prefs={layerPrefs} region={region} />
        </div>

        <nav className="divide-y divide-gray-100">
          <Row icon={ICON_PATHS.howTo} label="How To Use" onClick={() => setView("howto")} />
          <Row icon={ICON_PATHS.notes} label="Railway Notes" onClick={() => setView("notes")} />
          {user?.id === 1 && (
            <Link href="/admin" className={ROW}>
              <Icon path={ICON_PATHS.admin} className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <span className="flex-1">Admin</span>
              <Chevron />
            </Link>
          )}
        </nav>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col sheet-slide-up safe-area">
      <header className="flex items-center gap-1 border-b border-gray-200 px-3 py-2 flex-shrink-0">
        {view !== "menu" && (
          <IconButton onClick={backToMenu} label="Back to menu" path={CHEVRON_LEFT} />
        )}
        <h2
          className={`flex-1 text-lg font-semibold text-gray-900 truncate ${
            view === "menu" ? "px-1" : ""
          }`}
        >
          {TITLES[view]}
        </h2>
        <IconButton onClick={onClose} label="Close menu" path={CROSS} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">{body}</div>

      {/* Auth lives in a footer, not in the list: it is the one action a visitor is
          most likely here for, and Logout must not look like another navigation row. */}
      {view === "menu" && (
        <div className="border-t border-gray-200 p-4 flex-shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className={`${btn("outlineDanger", "lg")} w-full`}
            >
              Log out
            </button>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setView("login")}
                className={`${btn("primary", "lg")} w-full`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setView("register")}
                className={`${btn("outline", "lg")} w-full`}
              >
                Create account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
