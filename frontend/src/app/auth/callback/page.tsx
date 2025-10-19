'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, signInWithRedirect } from 'aws-amplify/auth';
import '@/app/lib/amplify';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const completeLogin = async () => {
      try {
        // Try to fetch the current session.
        const session = await fetchAuthSession();

        if (session.tokens?.idToken) {
          // ✅ Already signed in
          router.push('/dashboard');
          return;
        }

        // If not, restart the redirect flow (handles code exchange internally)
        await signInWithRedirect();
      } catch (err) {
        console.error('Redirect completion failed:', err);
        router.push('/error');
      }
    };

    completeLogin();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p>Completing sign-in…</p>
      </div>
    </div>
  );
}
