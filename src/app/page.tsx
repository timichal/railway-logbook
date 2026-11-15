import { cookies } from "next/headers";
import MainLayout from "@/components/layout/MainLayout";
import { getUser, logout } from "@/lib/authActions";
import { selectedCountriesForUser } from "@/lib/preferencesQueries";
import { routesTileVersion } from "@/lib/routesTileVersion";
import { SUPPORTED_COUNTRIES } from "@/lib/shared/constants";
import { REGION_COOKIE, regionIdOrDefault } from "@/lib/shared/regions";

export default async function Home() {
  // Check if user is authenticated (optional - map works for both logged and unlogged users).
  // The route tile version is read with every render, never kept: the route tiles
  // fetched under it are cached for a year, so a route saved since the last load
  // must give a new one. It needs nothing else, so it is read alongside.
  const [user, tileVersion] = await Promise.all([getUser(), routesTileVersion()]);

  // Region comes from a cookie so the first paint is already the right one
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = regionIdOrDefault(regionCookie);

  // Fetch user preferences server-side to avoid flash (only for logged-in users),
  // for the user just resolved rather than through an action that resolves the
  // session again. Two quick reads; one statement doing both would save a round
  // trip of well under a millisecond.
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
        routesTileVersion={tileVersion}
        initialRegion={initialRegion}
      />
    </div>
  );
}
