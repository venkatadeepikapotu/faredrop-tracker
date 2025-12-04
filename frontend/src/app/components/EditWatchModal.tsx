'use client';
import { useState } from 'react';

interface EditWatchModalProps {
  watch: any;
  onClose: () => void;
  onSave: () => void;
}

export function EditWatchModal({ watch, onClose, onSave }: EditWatchModalProps) {
  const [threshold, setThreshold] = useState(watch.priceThreshold);
  const [date, setDate] = useState(watch.departureDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setLoading(true);
    setError('');
    
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/watches/${watch.watchId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            priceThreshold: Number(threshold),
            departureDate: date
          })
        }
      );
      
      if (response.ok) {
        onSave();
        onClose();
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to update watch');
      }
    } catch (err) {
      setError('Error updating watch');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-4">Edit Watch</h2>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Route</label>
          <input 
            value={`${watch.origin} → ${watch.destination}`}
            disabled
            className="w-full p-2 border rounded bg-gray-100"
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Price Threshold ($)</label>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
            min="1"
          />
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Departure Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-300 p-2 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}