import { redirect } from 'next/navigation';
import Link from 'next/link';
import AdminMapWrapper from '@/components/AdminMapWrapper';
import { getUser, logout } from '@/lib/auth-actions';

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const user = await getUser();
  
  if (!user) {
    redirect('/login');
  }

  if (user.id !== 1) {
    redirect('/'); // Redirect non-admin users to main page
  }

  async function handleLogout() {
    'use server';
    await logout();
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Admin - Railway Parts Map
            </h1>
            <p className="text-gray-600 mt-1">
              Welcome, {user.name || user.email} - Dynamic loading of railway segments with zoom-based optimization
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
      
      <main className="flex-1 overflow-hidden">
        <AdminMapWrapper className="w-full h-full" />
      </main>
    </div>
  );
}