import VectorMapWrapper from '@/components/VectorMapWrapper';
import Navbar from '@/components/Navbar';
import { getUser, logout } from '@/lib/authActions';
import { getUserPreferences } from '@/lib/userPreferencesActions';
import { SUPPORTED_COUNTRIES } from '@/lib/constants';

export default async function Home() {
  // Check if user is authenticated (optional - map works for both logged and unlogged users)
  const user = await getUser();

  // Fetch user preferences server-side to avoid flash (only for logged-in users)
  const selectedCountries = user ? await getUserPreferences() : SUPPORTED_COUNTRIES.map((country) => country.code);

  async function handleLogout() {
    'use server';
    await logout();
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <Navbar user={user} onLogout={handleLogout} />

      <main className="flex-1 overflow-hidden">
        <VectorMapWrapper
          className="w-full h-full"
          user={user}
          initialSelectedCountries={selectedCountries}
        />
      </main>
    </div>
  );
}
