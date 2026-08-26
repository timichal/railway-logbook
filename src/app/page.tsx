import { cookies } from "next/headers";
import MainLayout from "@/components/layout/MainLayout";
import { getUser, logout } from "@/lib/authActions";
import { SUPPORTED_COUNTRIES } from "@/lib/constants";
import { DEFAULT_REGION, isRegionId, REGION_COOKIE } from "@/lib/regions";
import { getUserPreferences } from "@/lib/userPreferencesActions";

export default async function Home() {
  // Check if user is authenticated (optional - map works for both logged and unlogged users)
  const user = await getUser();

  // Region comes from a cookie so the first paint is already the right one
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = isRegionId(regionCookie) ? regionCookie : DEFAULT_REGION;

  // Fetch user preferences server-side to avoid flash (only for logged-in users)
  const selectedCountries = user
    ? await getUserPreferences()
    : SUPPORTED_COUNTRIES.map((country) => country.code);

  async function handleLogout() {
    "use server";
    await logout();
  }

  return (
    <div className="h-dvh flex flex-col bg-surface safe-area">
      <MainLayout
        user={user}
        onLogout={handleLogout}
        initialSelectedCountries={selectedCountries}
        initialRegion={initialRegion}
      />
    </div>
  );
}
