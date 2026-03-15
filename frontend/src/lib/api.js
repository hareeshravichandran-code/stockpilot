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
  signup:      (data) => api.post('/api/auth/signup', data),
  login:       (data) => api.post('/api/auth/login', data),
  me:          ()     => api.get('/api/auth/me'),
  saveProfile: (data) => api.put('/api/auth/profile', data),
  getProfile:  ()     => api.get('/api/auth/me'),
};

export const portfolioAPI = {
  get:          ()     => api.get('/api/portfolio'),
  addHolding:   (data) => api.post('/api/portfolio/holding', data),
  searchStocks: (q)    => api.get(`/api/portfolio/search?q=${encodeURIComponent(q)}`),
  transactions: ()     => api.get('/api/portfolio/transactions'),
  dividends:    ()     => api.get('/api/dividends'),
  assets:       ()     => api.get('/api/portfolio/assets'),
  saveAssets:   (d)    => api.post('/api/portfolio/assets', d),
  tax:          ()     => api.get('/api/portfolio/tax'),
  syncPrices:   ()     => api.post('/api/portfolio/sync-prices'),
};

export const emailAPI = {
  connectGmail: ()            => api.get('/api/email/gmail/connect'),
  syncCAS:      ()            => api.post('/api/email/sync/cas', {}, { timeout: 120000 }),
  status:       ()            => api.get('/api/email/status'),
  sessions:     ()            => api.get('/api/email/sessions'),
  sessionLogs:  (sessionId)   => api.get(`/api/email/sessions/${sessionId}/logs`),
  failures:     ()            => api.get('/api/email/failures'),
};

export const priceAPI = {
  get:  (symbol)  => api.get(`/api/prices/${symbol}`),
  bulk: (symbols) => api.post('/api/prices/bulk', { symbols }),
};

export const mfAPI = {
  get:             ()     => api.get('/api/mf'),
  requestCAS:      ()     => api.post('/api/mf/request-cas'),
  syncStatements:  ()     => api.post('/api/mf/sync-statements', {}, { timeout: 120000 }),
  delete:          (id)   => api.delete(`/api/mf/${id}`),
};

export const incomeAPI = {
  getRules:    ()          => api.get('/api/income/rules'),
  createRule:  (data)      => api.post('/api/income/rules', data),
  updateRule:  (id, data)  => api.put(`/api/income/rules/${id}`, data),
  deleteRule:  (id)        => api.delete(`/api/income/rules/${id}`),
  scan:        ()          => api.post('/api/income/scan'),
  getEntries:  (p)         => api.get('/api/income/entries', { params: p }),
  addEntry:    (data)      => api.post('/api/income/entries', data),
  deleteEntry: (id)        => api.delete(`/api/income/entries/${id}`),
  categories:  ()          => api.get('/api/income/categories'),
  getBanks:    ()          => api.get('/api/income/banks'),
};

export const expenseAPI = {
  getEntries:   (p)         => api.get('/api/expense/entries', { params: p }),
  addEntry:     (data)      => api.post('/api/expense/entries', data),
  updateEntry:  (id, data)  => api.put(`/api/expense/entries/${id}`, data),
  deleteEntry:  (id)        => api.delete(`/api/expense/entries/${id}`),
  uploadReceipt:(id, form)  => api.post(`/api/expense/entries/${id}/receipt`, form, { headers:{'Content-Type':'multipart/form-data'} }),
  scan:         ()          => api.post('/api/expense/scan'),
  categorize:   (data)      => api.post('/api/expense/categorize', data),
  getRules:     ()          => api.get('/api/expense/rules'),
  createRule:   (data)      => api.post('/api/expense/rules', data),
  updateRule:   (id, data)  => api.put(`/api/expense/rules/${id}`, data),
  deleteRule:   (id)        => api.delete(`/api/expense/rules/${id}`),
  categories:   ()          => api.get('/api/expense/categories'),
};

export default api;
