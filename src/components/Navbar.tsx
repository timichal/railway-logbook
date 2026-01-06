'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { User } from '@/lib/authActions';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';

interface NavbarProps {
  user: User | null;
  onLogout?: () => void;
  onOpenHowTo?: () => void;
  onOpenNotes?: () => void;
  isAdminPage?: boolean;
}

export default function Navbar({ user, onLogout, onOpenHowTo, onOpenNotes, isAdminPage = false }: NavbarProps) {
  const [showLoginDropdown, setShowLoginDropdown] = useState(false);
  const [showRegisterDropdown, setShowRegisterDropdown] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const registerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (loginRef.current && !loginRef.current.contains(event.target as Node)) {
        setShowLoginDropdown(false);
      }
      if (registerRef.current && !registerRef.current.contains(event.target as Node)) {
        setShowRegisterDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close dropdown after successful login/register
  const handleLoginSuccess = () => {
    setShowLoginDropdown(false);
  };

  const handleRegisterSuccess = () => {
    setShowRegisterDropdown(false);
  };

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
