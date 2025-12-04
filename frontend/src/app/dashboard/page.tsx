'use client';

import { useEffect, useState } from 'react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { useRouter } from 'next/navigation';
import api from '@/app/lib/api';
import '@/app/lib/amplify';
import { EditWatchModal } from '@/app/components/EditWatchModal';

export default function Dashboard() {
  const router = useRouter();
  const [editingWatch, setEditingWatch] = useState<any>(null);
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
  
  // ✅ NEW - Delete function
  const handleDelete = async (watchId: string) => {
    if (!confirm('Are you sure you want to delete this watch?')) {
      return;
    }
    
    try {
      await api.deleteWatch(watchId);
      loadWatches(); // Reload watches after delete
    } catch (error) {
      console.error('Failed to delete watch:', error);
      alert('Failed to delete watch');
    }
  };

  const handleSignOut = async () => {
   // Clear authentication
    localStorage.clear();
    sessionStorage.clear();
  
    // Redirect to home
    window.location.href = '/';
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
          <h1 className="text-2xl font-bold">✈ FareDrop Tracker</h1>
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
                  onChange={(e) => setFormData({ ...formData, origin: e.target.value.toUpperCase() })}
                  className="border p-2 rounded"
                  maxLength={3}
                  required
                />
                <input
                  type="text"
                  placeholder="To (LAX)"
                  value={formData.destination}
                  onChange={(e) => setFormData({ ...formData, destination: e.target.value.toUpperCase() })}
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
                min={new Date().toISOString().split('T')[0]}
              />
              <input
                type="number"
                placeholder="Price Threshold ($)"
                value={formData.priceThreshold}
                onChange={(e) => setFormData({ ...formData, priceThreshold: Number(e.target.value) })}
                className="border p-2 rounded w-full"
                min="1"
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
            <div className="text-center py-12">
              <div className="text-6xl mb-4">✈️</div>
              <p className="text-gray-500 text-lg">No watches yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {watches.map((watch) => (
                <div key={watch.watchId} className="bg-white p-4 rounded-lg shadow">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-bold text-lg">
                        {watch.origin} → {watch.destination}
                      </div>
                      <div className="text-gray-600 text-sm mt-1">
                        📅 Departure: {watch.departureDate}
                      </div>
                      <div className="text-gray-600 text-sm">
                         Threshold: ${watch.priceThreshold}
                      </div>
                      {watch.lastPrice && (
                        <div className={`font-bold mt-2 ${
                          watch.lastPrice <= watch.priceThreshold 
                            ? 'text-green-600' 
                            : 'text-orange-600'
                        }`}>
                          Last Price: ${watch.lastPrice}
                          {watch.lastPrice <= watch.priceThreshold && ' Below threshold!'}
                        </div>
                      )}
                      {watch.lastCheckedAt && (
                        <div className="text-gray-500 text-xs mt-1">
                          Last checked: {new Date(watch.lastCheckedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    
                    {/* ✅ NEW - Action buttons */}
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => setEditingWatch(watch)}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                        title="Edit watch"
                      >
                         Edit
                      </button>
                      <button
                        onClick={() => handleDelete(watch.watchId)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                        title="Delete watch"
                      >
                         Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ✅ NEW - Edit Modal */}
      {editingWatch && (
        <EditWatchModal
          watch={editingWatch}
          onClose={() => setEditingWatch(null)}
          onSave={() => {
            setEditingWatch(null);
            loadWatches();
          }}
        />
      )}
    </div>
  );
}