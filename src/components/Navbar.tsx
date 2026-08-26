"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/authActions";
import { useRegion } from "@/lib/regionContext";
import LoginForm from "./LoginForm";
import RegionSwitch from "./RegionSwitch";
import RegisterForm from "./RegisterForm";
import ShareMapDialog from "./ShareMapDialog";

interface NavbarProps {
  user: User | null;
  onLogout?: () => void;
  onAuthSuccess?: () => void;
  onOpenHowTo?: () => void;
  onOpenNotes?: () => void;
  isAdminPage?: boolean;
  isMobile?: boolean;
  /**
   * Hamburger tap, and the mobile Sign in button. Each page decides what it opens
   * (menu sheet / admin drawer); the argument names the sub-view to land on.
   */
  onOpenMenu?: (view?: "login") => void;
}

/** Mobile bar icon button: 44pt target, no label. */
const BAR_BUTTON =
  "w-11 h-11 flex items-center justify-center flex-shrink-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md cursor-pointer";

export default function Navbar({
  user,
  onLogout,
  onAuthSuccess,
  onOpenHowTo,
  onOpenNotes,
  isAdminPage = false,
  isMobile = false,
  onOpenMenu,
}: NavbarProps) {
  const region = useRegion();
  const [showLoginDropdown, setShowLoginDropdown] = useState(false);
  const [showRegisterDropdown, setShowRegisterDropdown] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const registerRef = useRef<HTMLDivElement>(null);

  // Close desktop login/register dropdowns when clicking outside.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (loginRef.current && !loginRef.current.contains(event.target as Node)) {
        setShowLoginDropdown(false);
      }
      if (registerRef.current && !registerRef.current.contains(event.target as Node)) {
        setShowRegisterDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleLoginSuccess = () => {
    setShowLoginDropdown(false);
    if (onAuthSuccess) onAuthSuccess();
  };

  const handleRegisterSuccess = () => {
    setShowRegisterDropdown(false);
    if (onAuthSuccess) onAuthSuccess();
  };

  // Mobile navbar — title, then auth / share / hamburger as icon buttons. Everything
  // else (region switch, layer toggles, articles, admin link, back-to-map) lives
  // behind the hamburger.
  if (isMobile) {
    return (
      <header className="bg-white border-b border-gray-200 px-3 py-2 flex-shrink-0">
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

        <ShareMapDialog isOpen={showShareDialog} onClose={() => setShowShareDialog(false)} />
      </header>
    );
  }

  // Desktop navbar (unchanged)
  return (
    <header className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div>
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

          <div className="flex items-center gap-2 ml-4">
            <RegionSwitch />
            {/* Article views live in the user sidebar only — the admin page has no place to open them. */}
            {!isAdminPage && (
              <>
                <button
                  type="button"
                  onClick={onOpenHowTo}
                  className="bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium inline-flex items-center h-10 px-4 rounded-md text-sm border border-blue-300 cursor-pointer"
                >
                  How To Use
                </button>
                <button
                  type="button"
                  onClick={onOpenNotes}
                  className="bg-green-100 hover:bg-green-200 text-green-700 font-medium inline-flex items-center h-10 px-4 rounded-md text-sm border border-green-300 cursor-pointer"
                >
                  Railway Notes
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Share map — a logged-in user's own map is the only one there is to
              publish, so this is hidden for anonymous visitors and on the admin page. */}
          {user && !isAdminPage && (
            <button
              type="button"
              onClick={() => setShowShareDialog(true)}
              className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium inline-flex items-center h-10 px-4 rounded-md text-sm border border-indigo-300 cursor-pointer"
            >
              Share Map
            </button>
          )}

          {/* Admin link or Back to Main Map */}
          {user?.id === 1 && !isAdminPage && (
            <Link
              href="/admin"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium inline-flex items-center h-10 px-4 rounded-md text-sm"
            >
              Admin
            </Link>
          )}
          {isAdminPage && (
            <Link
              href="/"
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium inline-flex items-center h-10 px-4 rounded-md text-sm"
            >
              Back to Main Map
            </Link>
          )}

          {/* Login/Register or Logout */}
          {user ? (
            onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 text-white font-medium inline-flex items-center h-10 px-4 rounded-md text-sm cursor-pointer"
              >
                Logout
              </button>
            )
          ) : (
            <>
              {/* Login dropdown */}
              <div className="relative" ref={loginRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowLoginDropdown(!showLoginDropdown);
                    setShowRegisterDropdown(false);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium inline-flex items-center h-10 px-4 rounded-md text-sm cursor-pointer"
                >
                  Login
                </button>

                {showLoginDropdown && (
                  <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Sign in to your account
                      </h3>
                      <LoginForm onSuccess={handleLoginSuccess} />
                    </div>
                  </div>
                )}
              </div>

              {/* Register dropdown */}
              <div className="relative" ref={registerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowRegisterDropdown(!showRegisterDropdown);
                    setShowLoginDropdown(false);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white font-medium inline-flex items-center h-10 px-4 rounded-md text-sm cursor-pointer"
                >
                  Register
                </button>

                {showRegisterDropdown && (
                  <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Create your account
                      </h3>
                      <RegisterForm onSuccess={handleRegisterSuccess} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ShareMapDialog isOpen={showShareDialog} onClose={() => setShowShareDialog(false)} />
    </header>
  );
}
