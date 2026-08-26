import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminPageClient from "@/components/admin/AdminPageClient";
import { getUser } from "@/lib/authActions";
import { DEFAULT_REGION, isRegionId, REGION_COOKIE } from "@/lib/regions";

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const user = await getUser();

  if (user?.id !== 1) {
    redirect("/");
  }

  // Shared with the main map: the same cookie, so switching region on one page
  // carries over to the other.
  const regionCookie = (await cookies()).get(REGION_COOKIE)?.value;
  const initialRegion = isRegionId(regionCookie) ? regionCookie : DEFAULT_REGION;

  return <AdminPageClient user={user} initialRegion={initialRegion} />;
}
