import { redirect } from "next/navigation";
import AdminPageClient from "@/components/AdminPageClient";
import { getUser } from "@/lib/authActions";

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const user = await getUser();

  if (user?.id !== 1) {
    redirect("/");
  }

  return <AdminPageClient user={user} />;
}
