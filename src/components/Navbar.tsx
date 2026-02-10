'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { User } from '@/lib/authActions';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';

interface NavbarProps {
  user: User | null;
  onLogout?: () => void;
  onAuthSuccess?: () => void;
  onOpenHowTo?: () => void;
  onOpenNotes?: () => void;
  isAdminPage?: boolean;
  isMobile?: boolean;
  onToggleSidebar?: () => void;
}

export default function Navbar({ user, onLogout, onAuthSuccess, onOpenHowTo, onOpenNotes, isAdminPage = false, isMobile = false, onToggleSidebar }: NavbarProps) {
  const [showLoginDropdown, setShowLoginDropdown] = useState(false);
  const [showRegisterDropdown, setShowRegisterDropdown] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const registerRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (loginRef.current && !loginRef.current.contains(event.target as Node)) {
        setShowLoginDropdown(false);
      }
      if (registerRef.current && !registerRef.current.contains(event.target as Node)) {
        setShowRegisterDropdown(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close mobile menu when switching to desktop
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  // Close dropdown after successful login/register
  const handleLoginSuccess = () => {
    setShowLoginDropdown(false);
    setMobileMenuOpen(false);
    if (onAuthSuccess) {
      onAuthSuccess();
    }
  };

  const handleRegisterSuccess = () => {
    setShowRegisterDropdown(false);
    setMobileMenuOpen(false);
    if (onAuthSuccess) {
      onAuthSuccess();
    }
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // Mobile navbar
  if (isMobile) {
    return (
      <header className="bg-white border-b border-gray-200 px-3 py-2 flex-shrink-0" ref={mobileMenuRef}>
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-bold text-gray-900 truncate">
            {isAdminPage ? 'Admin' : 'Railway Logbook'}
          </h1>

          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md cursor-pointer"
                aria-label="Toggle sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}

            {/* Hamburger menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md cursor-pointer"
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown panel */}
        {mobileMenuOpen && (
          <div className="mt-2 pb-2 border-t border-gray-200 pt-2 space-y-2">
            <p className="text-xs text-gray-500 px-1">
              {isAdminPage
                ? `Welcome, ${user?.name || user?.email}`
                : user
                  ? `Welcome, ${user.name || user.email}!`
                  : 'Log your rail journeys around Europe'}
            </p>

            <div className="flex flex-wrap gap-2">
              {!isAdminPage && (
                <>
                  <button
                    onClick={() => { onOpenHowTo?.(); closeMobileMenu(); }}
                    className="bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium py-1.5 px-3 rounded-md text-xs border border-blue-300 cursor-pointer"
                  >
                    How To Use
                  </button>
                  <button
                    onClick={() => { onOpenNotes?.(); closeMobileMenu(); }}
                    className="bg-green-100 hover:bg-green-200 text-green-700 font-medium py-1.5 px-3 rounded-md text-xs border border-green-300 cursor-pointer"
                  >
                    Railway Notes
                  </button>
                </>
              )}

              {user?.id === 1 && !isAdminPage && (
                <Link
                  href="/admin"
                  onClick={closeMobileMenu}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded-md text-xs"
                >
                  Admin
                </Link>
              )}
              {isAdminPage && (
                <Link
                  href="/"
                  onClick={closeMobileMenu}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-1.5 px-3 rounded-md text-xs"
                >
                  Back to Map
                </Link>
              )}
            </div>

            {/* Auth controls */}
            {user ? (
              onLogout && (
                <button
                  onClick={() => { onLogout(); closeMobileMenu(); }}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-3 rounded-md text-sm cursor-pointer"
                >
                  Logout
                </button>
              )
            ) : (
              <div className="space-y-2">
                {/* Login section */}
                <div>
                  <button
                    onClick={() => {
                      setShowLoginDropdown(!showLoginDropdown);
                      setShowRegisterDropdown(false);
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 rounded-md text-sm cursor-pointer"
                  >
                    Login
                  </button>
                  {showLoginDropdown && (
                    <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Sign in to your account</h3>
                      <LoginForm onSuccess={handleLoginSuccess} />
                    </div>
                  )}
                </div>

                {/* Register section */}
                <div>
                  <button
                    onClick={() => {
                      setShowRegisterDropdown(!showRegisterDropdown);
                      setShowLoginDropdown(false);
                    }}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-3 rounded-md text-sm cursor-pointer"
                  >
                    Register
                  </button>
                  {showRegisterDropdown && (
                    <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Create your account</h3>
                      <RegisterForm onSuccess={handleRegisterSuccess} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
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
              {isAdminPage ? 'Admin - Railway Management' : 'The Railway Logbook'}
            </h1>
            <p className="text-gray-600 mt-1">
              {isAdminPage
                ? `Welcome, ${user?.name || user?.email} - Manage railway routes and view raw data`
                : user
                  ? `Welcome, ${user.name || user.email}! Log your rail journeys around Europe.`
                  : 'Log your rail journeys around Europe'}
            </p>
          </div>

          <div className="flex gap-2 ml-4">
            <button
              onClick={onOpenHowTo}
              className="bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium py-2 px-4 rounded-md text-sm border border-blue-300 cursor-pointer"
            >
              How To Use
            </button>
            <button
              onClick={onOpenNotes}
              className="bg-green-100 hover:bg-green-200 text-green-700 font-medium py-2 px-4 rounded-md text-sm border border-green-300 cursor-pointer"
            >
              Railway Notes
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Admin link or Back to Main Map */}
          {user?.id === 1 && !isAdminPage && (
            <Link
              href="/admin"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm"
            >
              Admin
            </Link>
          )}
          {isAdminPage && (
            <Link
              href="/"
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md text-sm"
            >
              Back to Main Map
            </Link>
          )}

          {/* Login/Register or Logout */}
          {user ? (
            onLogout && (
              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Logout
              </button>
            )
          ) : (
            <>
              {/* Login dropdown */}
              <div className="relative" ref={loginRef}>
                <button
                  onClick={() => {
                    setShowLoginDropdown(!showLoginDropdown);
                    setShowRegisterDropdown(false);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
                >
                  Login
                </button>

                {showLoginDropdown && (
                  <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Sign in to your account</h3>
                      <LoginForm onSuccess={handleLoginSuccess} />
                    </div>
                  </div>
                )}
              </div>

              {/* Register dropdown */}
              <div className="relative" ref={registerRef}>
                <button
                  onClick={() => {
                    setShowRegisterDropdown(!showRegisterDropdown);
                    setShowLoginDropdown(false);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
                >
                  Register
                </button>

                {showRegisterDropdown && (
                  <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Create your account</h3>
                      <RegisterForm onSuccess={handleRegisterSuccess} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
