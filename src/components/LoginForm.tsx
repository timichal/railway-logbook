'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/authActions';
import { LocalStorageManager } from '@/lib/localStorage';
import { migrateLocalTrips } from '@/lib/migrationActions';
import { useToast } from '@/lib/toast';

interface LoginFormProps {
  onSuccess?: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { showSuccess, showConfirm } = useToast();

  async function handleSubmit(formData: FormData) {
    setError('');
    setLoading(true);

    try {
      await login(formData);

      // Check if there are localStorage trips to merge
      const tripCount = LocalStorageManager.getTripCount();

      if (tripCount > 0) {
        // Show confirmation dialog for merging trips
        showConfirm({
          title: 'Merge Local Trips?',
          message: `You have ${tripCount} trip${tripCount !== 1 ? 's' : ''} stored locally. Would you like to merge them with your account?\n\nDuplicates will be skipped automatically.\n\nIf you choose "Keep Local", these trips will remain in your browser but won't be visible until you log out.`,
          confirmLabel: `Merge ${tripCount} Trip${tripCount !== 1 ? 's' : ''}`,
          cancelLabel: 'Keep Local',
          thirdLabel: 'Delete Local',
          variant: 'info',
          onConfirm: async () => {
            try {
              const localTrips = LocalStorageManager.exportTrips();
              const result = await migrateLocalTrips(localTrips);

              // Clear localStorage after successful migration
              LocalStorageManager.clearTrips();

              if (result.migrated > 0) {
                showSuccess(`${result.migrated} trip${result.migrated !== 1 ? 's' : ''} merged successfully!`);
              } else {
                showSuccess('All trips were duplicates, none merged.');
              }

              // Refresh to show merged data
              router.refresh();
            } catch (err) {
              console.error('Error migrating trips:', err);
              showSuccess('Login successful, but trip migration failed. Your local trips are still saved.');
            }
          },
          onCancel: () => {
            // User chose to keep local - trips stay in localStorage but invisible
            showSuccess('Login successful! Your local trips remain in browser storage.');
          },
          onThird: () => {
            // User chose to delete local trips
            LocalStorageManager.clearTrips();
            showSuccess('Login successful! Local trips have been deleted.');
            router.refresh();
          }
        });
      }

      // Call onSuccess callback if provided (for dropdown mode)
      if (onSuccess) {
        onSuccess();
        // Refresh only if no trips to merge (otherwise refresh happens in merge callback)
        if (tripCount === 0) {
          router.refresh();
        }
      } else {
        // Redirect to home page (for standalone login page)
        if (tripCount === 0) {
          router.push('/');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        action={handleSubmit}
      >
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

        <div>
          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 cursor-pointer"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
