import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const USE_MOCK = false;

let mockWatches: any[] = [];

async function makeRequest(endpoint: string, options: RequestInit = {}) {
  if (USE_MOCK) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return mockRequest(endpoint, options);
  }

  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`API Error: ${response.status}`);
    }
    
    if (response.status === 204) return null;
    return response.json();
  } catch (error) {
    console.error('API failed:', error);
    throw error;
  }
}

function mockRequest(endpoint: string, options: RequestInit) {
  console.log('🎭 DEMO MODE: Mock data active');
  
  if (endpoint === '/watches' && options.method === 'POST') {
    const body = JSON.parse(options.body as string);
    const newWatch = {
      ...body,
      watchId: 'watch-' + Date.now(),
      userId: 'demo-user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: 'true',
      lastPrice: Math.floor(Math.random() * 200) + 150,
      lastCheckedAt: new Date().toISOString(),
    };
    mockWatches.push(newWatch);
    return newWatch;
  }

  if (endpoint === '/watches') {
    return { watches: mockWatches };
  }

  if (endpoint.startsWith('/watches/') && options.method === 'DELETE') {
    const watchId = endpoint.split('/')[2];
    mockWatches = mockWatches.filter(w => w.watchId !== watchId);
    return null;
  }

  // ✅ ADD - Mock update
  if (endpoint.startsWith('/watches/') && options.method === 'PUT') {
    const watchId = endpoint.split('/')[2];
    const body = JSON.parse(options.body as string);
    const index = mockWatches.findIndex(w => w.watchId === watchId);
    if (index !== -1) {
      mockWatches[index] = { ...mockWatches[index], ...body, updatedAt: new Date().toISOString() };
      return mockWatches[index];
    }
    return null;
  }

  return { watches: mockWatches };
}

const api = {
  getWatches: async () => makeRequest('/watches'),
  createWatch: async (data: any) => makeRequest('/watches', { method: 'POST', body: JSON.stringify(data) }),
  deleteWatch: async (watchId: string) => makeRequest(`/watches/${watchId}`, { method: 'DELETE' }),
  updateWatch: async (watchId: string, data: any) => makeRequest(`/watches/${watchId}`, { method: 'PUT', body: JSON.stringify(data) }),  // ✅ NEW
};

export default api;