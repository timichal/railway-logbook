"use client";

import Link from "next/link";
import { useState } from "react";
import ShareMapDialog from "@/components/sharing/ShareMapDialog";
import IconButton from "@/components/ui/IconButton";
import RegionSwitch from "@/components/ui/RegionSwitch";
import ThemeSwitch, { ThemeCycleButton } from "@/components/ui/ThemeSwitch";
import type { User } from "@/lib/authActions";
import { useRegion } from "@/lib/regionContext";
import { btn } from "@/lib/ui/buttonStyles";

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
    <header className="bg-surface border-b border-gray-200 px-3 py-2 md:p-4 flex-shrink-0">
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
            ? onLogout && <IconButton icon="logOut" label="Log out" onClick={onLogout} />
            : onOpenMenu && (
                <IconButton icon="logIn" label="Sign in" onClick={() => onOpenMenu("login")} />
              )}

          {/* The admin page has no menu, so its region and colour-scheme switches have
              to live in the bar. The user map's are in the menu, where settings that
              change the whole app belong. The scheme is one cycling button here: three
              more 44pt segments would not fit beside the region switch on a phone. */}
          {isAdminPage && <RegionSwitch compact />}
          {isAdminPage && <ThemeCycleButton />}

          {/* Share as the platform share glyph. */}
          {user && !isAdminPage && (
            <IconButton icon="share" label="Share map" onClick={() => setShowShareDialog(true)} />
          )}

          {onOpenMenu && <IconButton icon="menu" label="Open menu" onClick={() => onOpenMenu()} />}
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
            {/* Admin only — see the mobile bar above. */}
            {isAdminPage && <RegionSwitch />}
            {isAdminPage && <ThemeSwitch compact />}

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
              <IconButton icon="menu" label="Open menu" onClick={() => onOpenMenu()} />
            )}
          </div>
        </div>
      </div>

      <ShareMapDialog isOpen={showShareDialog} onClose={() => setShowShareDialog(false)} />
    </header>
  );
}
