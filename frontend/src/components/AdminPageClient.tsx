'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import AdminMapWrapper from '@/components/AdminMapWrapper';
import AdminSidebar from '@/components/AdminSidebar';
import { logout } from '@/lib/auth-actions';

interface AdminPageClientProps {
  user: {
    id: number;
    name?: string;
    email: string;
  };
}

export default function AdminPageClient({ user }: AdminPageClientProps) {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
  };

  async function handleLogout() {
    await logout();
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Admin - Railway Management
            </h1>
            <p className="text-gray-600 mt-1">
              Welcome, {user.name || user.email} - Manage railway routes and view raw data
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md text-sm"
            >
              Back to Main Map
            </Link>
            <form action={handleLogout}>
              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex">
        <AdminSidebar
          selectedRouteId={selectedRouteId}
          onRouteSelect={handleRouteSelect}
        />
        <div className="flex-1 overflow-hidden">
          <AdminMapWrapper
            className="w-full h-full"
            selectedRouteId={selectedRouteId}
            onRouteSelect={handleRouteSelect}
          />
        </div>
      </main>
    </div>
  );
}
