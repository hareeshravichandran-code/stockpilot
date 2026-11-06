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
  syncNAV:         ()     => api.post('/api/mf/sync-nav', {}, { timeout: 60000 }),
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
  getEntries:          (p)          => api.get('/api/expense/entries', { params: p }),
  addEntry:            (data)       => api.post('/api/expense/entries', data),
  updateEntry:         (id, data)   => api.put(`/api/expense/entries/${id}`, data),
  deleteEntry:         (id)         => api.delete(`/api/expense/entries/${id}`),
  uploadReceipt:       (id, form)   => api.post(`/api/expense/entries/${id}/receipt`, form, { headers:{'Content-Type':'multipart/form-data'} }),
  scan:                ()           => api.post('/api/expense/scan'),
  categorize:          (data)       => api.post('/api/expense/categorize', data),
  // Rules
  getRules:            ()           => api.get('/api/expense/rules'),
  createRule:          (data)       => api.post('/api/expense/rules', data),
  updateRule:          (id, data)   => api.put(`/api/expense/rules/${id}`, data),
  deleteRule:          (id)         => api.delete(`/api/expense/rules/${id}`),
  // Categories
  categories:          ()           => api.get('/api/expense/categories'),
  createCategory:      (data)       => api.post('/api/expense/categories', data),
  updateCategory:      (id, data)   => api.put(`/api/expense/categories/${id}`, data),
  deleteCategory:      (id)         => api.delete(`/api/expense/categories/${id}`),
  // SMS Rules
  getSmsRules:         ()           => api.get('/api/expense/sms-rules'),
  createSmsRule:       (data)       => api.post('/api/expense/sms-rules', data),
  updateSmsRule:       (id, data)   => api.put(`/api/expense/sms-rules/${id}`, data),
  deleteSmsRule:       (id)         => api.delete(`/api/expense/sms-rules/${id}`),
  // Bulk categorize
  bulkCategorize:      (txnIds, categoryId) => api.post('/api/expense/transactions/bulk-categorize', { txnIds, categoryId }),
  // Transactions (Android SMS data)
  getTransactions:     (p)          => api.get('/api/expense/transactions', { params: p }),
  updateTransaction:   (id, data)   => api.put(`/api/expense/transactions/${id}`, data),
  // Budgets
  getBudgets:          (month)      => api.get('/api/expense/budgets', { params: { month } }),
  upsertBudget:        (data)       => api.post('/api/expense/budgets', data),
  deleteBudget:        (id)         => api.delete(`/api/expense/budgets/${id}`),
  // Custom fields
  getCustomFields:     ()           => api.get('/api/expense/custom-fields'),
  createCustomField:   (data)       => api.post('/api/expense/custom-fields', data),
  updateCustomField:   (id, data)   => api.put(`/api/expense/custom-fields/${id}`, data),
  deleteCustomField:   (id)         => api.delete(`/api/expense/custom-fields/${id}`),
  // Sheet config
  getSheetConfig:      ()           => api.get('/api/expense/sheet-config'),
  saveSheetConfig:     (data)       => api.post('/api/expense/sheet-config', data),
};

export const goalsAPI = {
  getAll:       (p)        => api.get('/api/goals', { params: p }),
  create:       (data)     => api.post('/api/goals', data),
  update:       (id, data) => api.put(`/api/goals/${id}`, data),
  delete:       (id)       => api.delete(`/api/goals/${id}`),
  uploadPic:    (id, form) => api.post(`/api/goals/${id}/picture`, form, { headers:{'Content-Type':'multipart/form-data'} }),
  getAssets:    (id)       => api.get(`/api/goals/${id}/assets`),
  linkAsset:    (id, data) => api.post(`/api/goals/${id}/assets`, data),
  unlinkAsset:  (id, assetId) => api.delete(`/api/goals/${id}/assets/${assetId}`),
  recompute:    (id)       => api.post(`/api/goals/${id}/progress`),
  getCycles:    (id)       => api.get(`/api/goals/${id}/cycles`),
  closeCycle:   (id, data) => api.post(`/api/goals/${id}/cycles`, data),
  durationTypes:()         => api.get('/api/goals/duration-types'),
};

export const familyAPI = {
  status:           ()         => api.get('/api/family/status'),
  invite:           (data)     => api.post('/api/family/invite', data),
  acceptInvite:     (id)       => api.post(`/api/family/invites/${id}/accept`),
  rejectInvite:     (id)       => api.post(`/api/family/invites/${id}/reject`),
  removeMember:     (userId)   => api.delete(`/api/family/members/${userId}`),
  combinedPortfolio:()         => api.get('/api/family/combined/portfolio'),
  combinedMF:       ()         => api.get('/api/family/combined/mf'),
  combinedIncome:   ()         => api.get('/api/family/combined/income'),
  combinedExpenses: ()         => api.get('/api/family/combined/expenses'),
  combinedGoals:    ()         => api.get('/api/family/combined/goals'),
};

export const portfolioHistoryAPI = {
  get:           (years)           => api.get('/api/portfolio/history', { params: { years } }),
  detail:        (date)            => api.get(`/api/portfolio/history/detail/${date}`),
  snapshot:      ()                => api.post('/api/portfolio/history/snapshot'),
  backfill:      (fromDate,toDate) => api.post('/api/portfolio/history/backfill', { fromDate, toDate }),
  backfillStatus:()                => api.get('/api/portfolio/history/backfill/status'),
  npsStatus:     ()                => api.get('/api/portfolio/history/nps/status'),
};

export const npsAPI = {
  get:    ()         => api.get('/api/nps'),
  debug:  ()         => api.get('/api/nps/debug'),
  sync:   (fromDate) => api.post('/api/nps/sync', { fromDate }),
  manual: (data)     => api.post('/api/nps/manual', data),
  update: (id, data) => api.put(`/api/nps/${id}`, data),
  delete: (id)       => api.delete(`/api/nps/${id}`),
};

export const fdAPI = {
  getAll:  ()         => api.get('/api/fd'),
  create:  (data)     => api.post('/api/fd', data),
  update:  (id, data) => api.put(`/api/fd/${id}`, data),
  delete:  (id)       => api.delete(`/api/fd/${id}`),
};

export const rdAPI = {
  getAll:  ()         => api.get('/api/rd'),
  create:  (data)     => api.post('/api/rd', data),
  update:  (id, data) => api.put(`/api/rd/${id}`, data),
  delete:  (id)       => api.delete(`/api/rd/${id}`),
};

const crudAPI = (base) => ({
  list: () => api.get(base),
  create: (body) => api.post(base, body),
  update: (id, body) => api.put(`${base}/${id}`, body),
  remove: (id) => api.delete(`${base}/${id}`),
});
export const householdAPI = {
  overview: () => api.get('/api/household/overview', { timeout: 45000 }),
  calendar: (from, to) => api.get('/api/household/calendar', { params: { from, to }, timeout: 45000 }),
  members: crudAPI('/api/household/members'),
  policies: crudAPI('/api/household/policies'),
  documents: crudAPI('/api/household/documents'),
  events: crudAPI('/api/household/events'),
};

export const mastersAPI = {
  list:    ()            => api.get('/api/masters'),
  create:  (data)        => api.post('/api/masters', data, { timeout: 45000 }),
  update:  (id, data)    => api.put(`/api/masters/${id}`, data, { timeout: 45000 }),
  remove:  (id)          => api.delete(`/api/masters/${id}`),
  detail:  (id)          => api.get(`/api/masters/${id}/detail`),
  link:    (id, txnIds)  => api.post(`/api/masters/${id}/link`, { txn_ids: txnIds }),
  unlink:  (id, txnId)   => api.delete(`/api/masters/${id}/link/${txnId}`),
  linkRun: ()            => api.post('/api/masters/link-run', {}, { timeout: 45000 }),
  month:   (month)       => api.get('/api/masters/month', { params: { month }, timeout: 45000 }),
};

export const blueprintAPI = {
  get:           ()             => api.get('/api/blueprint'),
  assets:        ()             => api.get('/api/blueprint/assets'),
  saveLayout:    (data)         => api.post('/api/blueprint/layout', data),
  createBoard:   (data)         => api.post('/api/blueprint/boards', data),
  updateBoard:   (id, data)     => api.put(`/api/blueprint/boards/${id}`, data),
  deleteBoard:   (id)           => api.delete(`/api/blueprint/boards/${id}`),
  createLayer:   (data)         => api.post('/api/blueprint/layers', data),
  updateLayer:   (id, data)     => api.put(`/api/blueprint/layers/${id}`, data),
  deleteLayer:   (id)           => api.delete(`/api/blueprint/layers/${id}`),
  createBucket:  (data)         => api.post('/api/blueprint/buckets', data),
  updateBucket:  (id, data)     => api.put(`/api/blueprint/buckets/${id}`, data),
  deleteBucket:  (id)           => api.delete(`/api/blueprint/buckets/${id}`),
  complete:      (id)           => api.post(`/api/blueprint/buckets/${id}/complete`),
  reopen:        (id)           => api.post(`/api/blueprint/buckets/${id}/reopen`),
  closeCycle:    (id, data)     => api.post(`/api/blueprint/buckets/${id}/cycle`, data),
  setEmi:        (id, data)     => api.post(`/api/blueprint/buckets/${id}/emi`, data),
  mapAsset:      (id, data)     => api.post(`/api/blueprint/buckets/${id}/assets`, data),
  unmapAsset:    (id, assetId)  => api.delete(`/api/blueprint/buckets/${id}/assets/${assetId}`),
  createLink:    (data)         => api.post('/api/blueprint/links', data),
  updateLink:    (id, data)     => api.put(`/api/blueprint/links/${id}`, data),
  deleteLink:    (id)           => api.delete(`/api/blueprint/links/${id}`),
  notes:         (id)           => api.get(`/api/blueprint/buckets/${id}/notes`),
  addComment:    (id, body)     => api.post(`/api/blueprint/buckets/${id}/comments`, { body }),
  deleteComment: (id)           => api.delete(`/api/blueprint/comments/${id}`),
  upload:        (id, form)     => api.post(`/api/blueprint/buckets/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }),
  fileUrl:       (id)           => api.get(`/api/blueprint/attachments/${id}/url`),
  deleteFile:    (id)           => api.delete(`/api/blueprint/attachments/${id}`),
};

export const retirementAPI = {
  autofill:   ()            => api.get('/api/retirement/autofill', { timeout: 60000 }),
  get:        ()            => api.get('/api/retirement'),
  save:       (data, goal)  => api.put('/api/retirement', { data, goal }),
  linkGoal:   (body)        => api.post('/api/retirement/goal', body),
  unlinkGoal: ()            => api.delete('/api/retirement/goal'),
};

export default api;
