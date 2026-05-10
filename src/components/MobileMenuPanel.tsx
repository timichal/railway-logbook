'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { User } from '@/lib/authActions';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';

interface MobileMenuPanelProps {
  user: User | null;
  onLogout: () => void;
  onAuthSuccess: () => void;
  onOpenHowTo: () => void;
  onOpenNotes: () => void;
}

export default function MobileMenuPanel({
  user,
  onLogout,
  onAuthSuccess,
  onOpenHowTo,
  onOpenNotes,
}: MobileMenuPanelProps) {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  const handleLoginSuccess = () => {
    setShowLogin(false);
    onAuthSuccess();
  };

  const handleRegisterSuccess = () => {
    setShowRegister(false);
    onAuthSuccess();
  };

  return (
    <div className="border-b border-gray-200 px-3 py-2 space-y-2 flex-shrink-0">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onOpenHowTo}
          className="bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium py-1.5 px-3 rounded-md text-xs border border-blue-300 cursor-pointer"
        >
          How To Use
        </button>
        <button
          onClick={onOpenNotes}
          className="bg-green-100 hover:bg-green-200 text-green-700 font-medium py-1.5 px-3 rounded-md text-xs border border-green-300 cursor-pointer"
        >
          Railway Notes
        </button>
        {user?.id === 1 && (
          <Link
            href="/admin"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded-md text-xs"
          >
            Admin
          </Link>
        )}

        {user ? (
          <button
            onClick={onLogout}
            className="bg-red-600 hover:bg-red-700 text-white font-medium py-1.5 px-3 rounded-md text-xs cursor-pointer ml-auto"
          >
            Logout
          </button>
        ) : (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => { setShowLogin(v => !v); setShowRegister(false); }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded-md text-xs cursor-pointer"
            >
              Login
            </button>
            <button
              onClick={() => { setShowRegister(v => !v); setShowLogin(false); }}
              className="bg-green-600 hover:bg-green-700 text-white font-medium py-1.5 px-3 rounded-md text-xs cursor-pointer"
            >
              Register
            </button>
          </div>
        )}
      </div>

      {showLogin && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Sign in</h3>
          <LoginForm onSuccess={handleLoginSuccess} />
        </div>
      )}
      {showRegister && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Create account</h3>
          <RegisterForm onSuccess={handleRegisterSuccess} />
        </div>
      )}
    </div>
  );
}
