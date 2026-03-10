import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:4000',
  timeout: 30000,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('sp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    // Only force logout on 401 for non-auth endpoints
    // Don't redirect on /me failure — useAuth handles that gracefully
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/me')) {
      localStorage.removeItem('sp_token');
      localStorage.removeItem('sp_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  signup:        (data) => api.post('/api/auth/signup', data),
  login:         (data) => api.post('/api/auth/login', data),
  me:            ()     => api.get('/api/auth/me'),
  saveProfile:   (data) => api.put('/api/auth/profile', data),
  getProfile:    ()     => api.get('/api/auth/me'),
};

export const portfolioAPI = {
  get:          () => api.get('/api/portfolio'),
  addHolding:   (data) => api.post('/api/portfolio/holding', data),
  transactions: () => api.get('/api/portfolio/transactions'),
  dividends:    () => api.get('/api/dividends'),
  assets:       () => api.get('/api/portfolio/assets'),
  saveAssets:   (d) => api.post('/api/portfolio/assets', d),
  tax:          () => api.get('/api/portfolio/tax'),
  syncPrices:   () => api.post('/api/portfolio/sync-prices'),
};

export const emailAPI = {
  connectGmail: () => api.get('/api/email/gmail/connect'),
  syncCAS:      () => api.post('/api/email/sync/cas'),
  status:       () => api.get('/api/email/status'),
  // Admin panel
  sessions:     ()            => api.get('/api/email/sessions'),
  sessionLogs:  (sessionId)   => api.get(`/api/email/sessions/${sessionId}/logs`),
  failures:     ()            => api.get('/api/email/failures'),
};

export const priceAPI = {
  get:  (symbol)  => api.get(`/api/prices/${symbol}`),
  bulk: (symbols) => api.post('/api/prices/bulk', { symbols }),
};

export default api;
