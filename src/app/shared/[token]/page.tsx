import { cookies } from "next/headers";
import Link from "next/link";
import PublicMapLayout from "@/components/sharing/PublicMapLayout";
import { getPublicMapOwner } from "@/lib/publicMapActions";
import { DEFAULT_REGION, isRegionId, REGION_COOKIE } from "@/lib/regions";
import { btn } from "@/lib/ui/buttonStyles";

/**
 * A user's map, shared read-only.
 *
 * The token is resolved server-side so an unshared or unknown link renders the
 * "not available" page rather than an empty map, and so the owner's country
 * filter is already applied on the first paint. Sharing can be switched off
 * while someone is looking: every data call the client makes re-checks the
 * token, so the map simply stops answering rather than going stale silently.
 */
export default async function SharedMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { token } = await params;
  const { view } = await searchParams;
  const owner = await getPublicMapOwner(token);

  // `?view=` is what the sharer was looking at when they copied the link, so it
  // wins: a shared map is shared as a view of something, and the visitor's own
  // cookie has no bearing on which region the sender meant. Falls back to that
  // cookie (a visitor last on Japan lands on Japan) for links made before the
  // parameter existed, and to the default region otherwise.
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = isRegionId(view)
    ? view
    : isRegionId(regionCookie)
      ? regionCookie
      : DEFAULT_REGION;

  if (!owner) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-surface px-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">This map is not available</h1>
        <p className="text-gray-600 mt-2 max-w-md">
          The link is either wrong or its owner has turned public sharing off.
        </p>
        <Link href="/" className={`${btn("primary", "md")} mt-6`}>
          Go to my own map
        </Link>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-surface safe-area">
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
