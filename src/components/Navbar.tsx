"use client";

import Link from "next/link";
import { useState } from "react";
import type { User } from "@/lib/authActions";
import { useRegion } from "@/lib/regionContext";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";
import ShareMapDialog from "./ShareMapDialog";

interface NavbarProps {
  user: User | null;
  onLogout?: () => void;
  isAdminPage?: boolean;
  /**
   * Hamburger tap, and the auth buttons. Each page decides what it opens (menu
   * sheet / admin drawer); the argument names the sub-view to land on, so the bar
   * can send you straight to a form without owning a second copy of it.
   */
  onOpenMenu?: (view?: "login" | "register") => void;
}

/** Bar icon button: 44pt target, no label. Both bars use it. */
const BAR_BUTTON = iconBtn("md");

/**
 * The navbar picks its bar with `md:` classes rather than with `useIsMobile`,
 * and it is the one component in the app that has to.
 *
 * It is the whole of what the server renders above the map (both maps are
 * `ssr: false`), so it is what a phone *paints* while the JS bundle is still
 * downloading — before any hook has run and before hydration can correct
 * anything. A JS branch therefore showed the desktop bar first, with its
 * two-line title, region switch and five buttons, and swapped to the compact
 * one on hydration: the "flash of the desktop site" on every mobile load.
 * `useIsMobile`'s `useSyncExternalStore` fixes the *hydration* render; it
 * cannot touch the paint that precedes it. CSS can, because the stylesheet is
 * render-blocking and the media query is resolved before the first pixel.
 *
 * The cost is both bars in the DOM at every width, one of them `display: none`.
 * That is cheap here — a handful of buttons, no data — and the shared state
 * (the share dialog) stays single because it is one component.
 */
export default function Navbar({ user, onLogout, isAdminPage = false, onOpenMenu }: NavbarProps) {
  const region = useRegion();
  const [showShareDialog, setShowShareDialog] = useState(false);

  return (
    <header className="bg-white border-b border-gray-200 px-3 py-2 md:p-4 flex-shrink-0">
      {/* Mobile navbar — title, then auth / share / hamburger as icon buttons. Everything
          else (region switch, layer toggles, articles, admin link, back-to-map) lives
          behind the hamburger. */}
      <div className="md:hidden">
        <div className="flex justify-between items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900 truncate">
            {isAdminPage ? "Admin" : "Railway Logbook"}
          </h1>

          {/* Auth first: signing in or out is the most consequential thing in the
              menu, so it gets a bar button of its own rather than two taps. */}
          {user
            ? onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className={BAR_BUTTON}
                  aria-label="Log out"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M17 16l4-4m0 0l-4-4m4 4H9m5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h5a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              )
            : onOpenMenu && (
                <button
                  type="button"
                  onClick={() => onOpenMenu("login")}
                  className={BAR_BUTTON}
                  aria-label="Sign in"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M11 16l-4-4m0 0l4-4m-4 4h12m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h5a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              )}

          {/* Share as the platform share glyph; the region switch moved down into the
              menu, which is where a setting that changes the whole app belongs. */}
          {user && !isAdminPage && (
            <button
              type="button"
              onClick={() => setShowShareDialog(true)}
              className={BAR_BUTTON}
              aria-label="Share map"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M12 16V4m0 0L8.5 7.5M12 4l3.5 3.5M7 11H5.5A1.5 1.5 0 004 12.5v6A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-6A1.5 1.5 0 0018.5 11H17"
                />
              </svg>
            </button>
          )}

          {onOpenMenu && (
            <button
              type="button"
              onClick={() => onOpenMenu()}
              className={BAR_BUTTON}
              aria-label="Open menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Desktop navbar */}
      <div className="hidden md:block">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">
              {isAdminPage ? "Admin - Railway Management" : "The Railway Logbook"}
            </h1>
            <p className="text-gray-600 mt-1">
              {isAdminPage
                ? `Welcome, ${user?.name || user?.email} - Manage railway routes and view raw data`
                : user
                  ? `Welcome, ${user.name || user.email}! Log your rail journeys around ${region.label}.`
                  : `Log your rail journeys around ${region.label}`}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Share map — a logged-in user's own map is the only one there is to
              publish, so this is hidden for anonymous visitors and on the admin page. */}
            {user && !isAdminPage && (
              <button
                type="button"
                onClick={() => setShowShareDialog(true)}
                className={btn("softIndigo", "bar")}
              >
                Share Map
              </button>
            )}

            {/* The Admin link is in the menu too, but it stays in the bar as well:
                switching between the map and the admin view is a constant back and
                forth, and two clicks each way is two too many. */}
            {user?.id === 1 && !isAdminPage && (
              <Link href="/admin" className={btn("primary", "bar")}>
                Admin
              </Link>
            )}
            {isAdminPage && (
              <Link href="/" className={btn("neutral", "bar")}>
                Back to Main Map
              </Link>
            )}

            {/* Auth opens the menu on the matching form rather than a dropdown of its
                own. Two copies of a login form is two places for it to rot, and the
                dropdown was the cramped one — the sheet gives it the whole panel. */}
            {user
              ? onLogout && (
                  <button type="button" onClick={onLogout} className={btn("danger", "bar")}>
                    Log out
                  </button>
                )
              : onOpenMenu && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenMenu("login")}
                      className={btn("primary", "bar")}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenMenu("register")}
                      className={btn("success", "bar")}
                    >
                      Create account
                    </button>
                  </>
                )}

            {/* The same menu the phone gets: region, layer switches, the articles,
                the admin link and the auth forms. The admin page has no menu of its
                own — its hamburger opens the sidebar drawer, which on desktop is
                already on screen. */}
            {!isAdminPage && onOpenMenu && (
              <button
                type="button"
                onClick={() => onOpenMenu()}
                className={BAR_BUTTON}
                aria-label="Open menu"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <ShareMapDialog isOpen={showShareDialog} onClose={() => setShowShareDialog(false)} />
    </header>
  );
}
