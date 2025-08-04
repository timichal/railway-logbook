import { redirect } from 'next/navigation';
import MapWrapper from '@/components/MapWrapper';
import { getRailwayDataAsGeoJSON } from '@/lib/railway-actions';
import { getUser, logout } from '@/lib/auth-actions';

export default async function Home() {
  // Check if user is authenticated
  const user = await getUser();
  
  if (!user) {
    redirect('/login');
  }

  // Fetch railway data for the authenticated user
  const geoJsonData = await getRailwayDataAsGeoJSON(user.id);

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
              OSM Railway Map
            </h1>
            <p className="text-gray-600 mt-1">
              Welcome, {user.name || user.email} - Interactive railway map of Czech Republic and Austria
            </p>
          </div>
          <form action={handleLogout}>
            <button
              type="submit"
              className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
            >
              Logout
            </button>
          </form>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <MapWrapper className="w-full h-full" geoJsonData={geoJsonData} />
      </main>
    </div>
  );
}
