import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:4000',
  timeout: 15000,
});

// Attach JWT to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('sp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sp_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  signup: (data) => api.post('/api/auth/signup', data),
  login: (data) => api.post('/api/auth/login', data),
  me: () => api.get('/api/auth/me'),
};

export const portfolioAPI = {
  get: () => api.get('/api/portfolio'),
  addHolding: (data) => api.post('/api/portfolio/holding', data),
  transactions: () => api.get('/api/portfolio/transactions'),
  dividends: () => api.get('/api/portfolio/dividends'),
  tax: () => api.get('/api/portfolio/tax'),
};

export const emailAPI = {
  connectGmail: () => api.get('/api/email/gmail/connect'),
  sync: () => api.post('/api/email/sync'),
  status: () => api.get('/api/email/status'),
};

export const priceAPI = {
  get: (symbol) => api.get(`/api/prices/${symbol}`),
  bulk: (symbols) => api.post('/api/prices/bulk', { symbols }),
};

export default api;
