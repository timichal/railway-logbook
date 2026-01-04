import { redirect } from 'next/navigation';
import { getUser } from '@/lib/authActions';
import AdminPageClient from '@/components/AdminPageClient';

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const user = await getUser();

  if (!user || user.id !== 1) {
    redirect('/');
  }

  return <AdminPageClient user={user} />;
}
