import MainLayout from '@/components/MainLayout';
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
    <div className="h-dvh flex flex-col bg-white">
      <MainLayout
        user={user}
        onLogout={handleLogout}
        initialSelectedCountries={selectedCountries}
      />
    </div>
  );
}
