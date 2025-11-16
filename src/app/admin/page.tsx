import { redirect } from 'next/navigation';
import { getUser } from '@/lib/authActions';
import AdminPageClient from '@/components/AdminPageClient';

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const user = await getUser();
  
  if (!user) {
    redirect('/login');
  }

  if (user.id !== 1) {
    redirect('/'); // Redirect non-admin users to main page
  }

  return <AdminPageClient user={user} />;
}
