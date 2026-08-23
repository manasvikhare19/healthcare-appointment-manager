import axios from 'axios';

// In dev, '/api' works via the Vite proxy (see vite.config.js). In
// production (e.g. frontend deployed as a Render Static Site, separate
// from the backend), there's no proxy — so VITE_API_BASE_URL must point
// directly at the deployed backend, e.g. https://your-backend.onrender.com/api.
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('chm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const message = err.response?.data?.error || err.message || 'Something went wrong';

    // A 401 means the stored token is invalid/expired/signed with an old
    // secret — e.g. after a backend restart with a new JWT_SECRET, or a
    // switch to a fresh database. Leaving the stale token in place just
    // causes every protected call (booking, appointments, chat) to keep
    // failing silently. Clear the session and bounce to login so the
    // person gets a clean, obvious path back in instead of scattered errors.
    if (status === 401) {
      localStorage.removeItem('chm_token');
      localStorage.removeItem('chm_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?sessionExpired=1';
      }
    }

    return Promise.reject(new Error(message));
  }
);

export default api;
