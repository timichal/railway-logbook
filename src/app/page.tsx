import { cookies } from "next/headers";
import MainLayout from "@/components/layout/MainLayout";
import { getUser, logout } from "@/lib/authActions";
import { selectedCountriesForUser } from "@/lib/preferencesQueries";
import { SUPPORTED_COUNTRIES } from "@/lib/shared/constants";
import { REGION_COOKIE, regionIdOrDefault } from "@/lib/shared/regions";

export default async function Home() {
  // Check if user is authenticated (optional - map works for both logged and unlogged users)
  const user = await getUser();

  // Region comes from a cookie so the first paint is already the right one
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = regionIdOrDefault(regionCookie);

  // Fetch user preferences server-side to avoid flash (only for logged-in users),
  // for the user just resolved rather than through an action that resolves the
  // session again
  const selectedCountries = user
    ? await selectedCountriesForUser(user.id)
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
