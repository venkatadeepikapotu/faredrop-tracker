'use client';

import { useEffect, useState } from 'react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { useRouter } from 'next/navigation';
import api from '@/app/lib/api';
import '@/app/lib/amplify';

export default function Dashboard() {
  const router = useRouter();
  const [watches, setWatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    origin: '',
    destination: '',
    departureDate: '',
    priceThreshold: 500,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await fetchAuthSession();
      loadWatches();
    } catch {
      router.push('/');
    }
  };

  const loadWatches = async () => {
    try {
      const data = await api.getWatches();
      setWatches(data.watches || []);
    } catch (error) {
      console.error('Failed to load watches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createWatch(formData);
      setShowForm(false);
      setFormData({ origin: '', destination: '', departureDate: '', priceThreshold: 500 });
      loadWatches();
    } catch (error) {
      console.error('Failed to create watch:', error);
      alert('Failed to create watch');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4">
        <div className="flex justify-between items-center max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold">✈️ FareDrop Tracker</h1>
          <button
            onClick={handleSignOut}
            className="text-gray-600 hover:text-gray-900"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-6">
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Create Watch'}
          </button>
        </div>

        {showForm && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-bold mb-4">Create Price Watch</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="From (JFK)"
                  value={formData.origin}
                  onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                  className="border p-2 rounded"
                  maxLength={3}
                  required
                />
                <input
                  type="text"
                  placeholder="To (LAX)"
                  value={formData.destination}
                  onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                  className="border p-2 rounded"
                  maxLength={3}
                  required
                />
              </div>
              <input
                type="date"
                value={formData.departureDate}
                onChange={(e) => setFormData({ ...formData, departureDate: e.target.value })}
                className="border p-2 rounded w-full"
                required
              />
              <input
                type="number"
                placeholder="Price Threshold"
                value={formData.priceThreshold}
                onChange={(e) => setFormData({ ...formData, priceThreshold: Number(e.target.value) })}
                className="border p-2 rounded w-full"
                required
              />
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Create Watch
              </button>
            </form>
          </div>
        )}

        <div>
          <h2 className="text-xl font-bold mb-4">Your Watches</h2>
          {watches.length === 0 ? (
            <p className="text-gray-500">No watches yet. Create one!</p>
          ) : (
            <div className="grid gap-4">
              {watches.map((watch) => (
                <div key={watch.watchId} className="bg-white p-4 rounded-lg shadow">
                  <div className="font-bold text-lg">
                    {watch.origin} → {watch.destination}
                  </div>
                  <div className="text-gray-600">Date: {watch.departureDate}</div>
                  <div className="text-gray-600">Threshold: ${watch.priceThreshold}</div>
                  {watch.lastPrice && (
                    <div className="text-green-600 font-bold">
                      Last Price: ${watch.lastPrice}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}