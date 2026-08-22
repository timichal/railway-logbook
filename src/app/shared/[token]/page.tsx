import { cookies } from "next/headers";
import Link from "next/link";
import PublicMapLayout from "@/components/PublicMapLayout";
import { getPublicMapOwner } from "@/lib/publicMapActions";
import { DEFAULT_REGION, isRegionId, REGION_COOKIE } from "@/lib/regions";

/**
 * A user's map, shared read-only.
 *
 * The token is resolved server-side so an unshared or unknown link renders the
 * "not available" page rather than an empty map, and so the owner's country
 * filter is already applied on the first paint. Sharing can be switched off
 * while someone is looking: every data call the client makes re-checks the
 * token, so the map simply stops answering rather than going stale silently.
 */
export default async function SharedMapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await getPublicMapOwner(token);

  // Region comes from the same cookie as the main map, so a visitor who was
  // last looking at Japan lands on Japan here too.
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = isRegionId(regionCookie) ? regionCookie : DEFAULT_REGION;

  if (!owner) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-white px-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">This map is not available</h1>
        <p className="text-gray-600 mt-2 max-w-md">
          The link is either wrong or its owner has turned public sharing off.
        </p>
        <Link
          href="/"
          className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm"
        >
          Go to my own map
        </Link>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-white">
      <PublicMapLayout
        token={token}
        ownerId={owner.userId}
        ownerName={owner.displayName}
        selectedCountries={owner.selectedCountries}
        initialRegion={initialRegion}
      />
    </div>
  );
}
