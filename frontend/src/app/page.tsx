'use client';

import { useEffect, useState } from 'react';
import { signInWithRedirect } from 'aws-amplify/auth';
import '@/app/lib/amplify';

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithRedirect({ provider: 'Google' });
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4 text-gray-900">✈️ FareDrop Tracker</h1>
        <p className="text-xl mb-8 text-gray-600">Monitor flight prices and get alerts</p>
        <button
          onClick={handleSignIn}
          className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg hover:bg-blue-700 transition"
        >
          Sign In with Google
        </button>
      </div>
    </div>
  );
}