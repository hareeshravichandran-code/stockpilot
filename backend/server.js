require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const emailRoutes = require('./routes/email');
const dividendRoutes = require('./routes/dividends');
const priceRoutes  = require('./routes/prices');
const mfRoutes     = require('./routes/mf');
const incomeRoutes   = require('./routes/income');
const expenseRoutes  = require('./routes/expense');
const goalsRoutes    = require('./routes/goals');
const familyRoutes   = require('./routes/family');
const portfolioHistoryRoutes = require('./routes/portfolioHistory');
const npsRoutes      = require('./routes/nps');
const fdRoutes       = require('./routes/fd');
const rdRoutes       = require('./routes/rd');

const app = express();

// ── Security middleware ──
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// ── CORS ──
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origin.includes('vercel.app') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ── Trust Railway proxy ──
app.set('trust proxy', 1);

// ── Rate limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many login attempts, please try again in 15 minutes.' }
});
app.use('/api/', limiter);
app.use('/api/auth', authLimiter);

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/dividends', dividendRoutes);
app.use('/api/prices',  priceRoutes);
app.use('/api/mf',      mfRoutes);
app.use('/api/income',   incomeRoutes);
app.use('/api/expense',  expenseRoutes);
app.use('/api/expense', require('./routes/expenseTransactions'));
app.use('/api/expense', require('./routes/expenseCategories'));
app.use('/api/expense', require('./routes/expenseManage'));
app.use('/api/expense', require('./routes/expenseBudgets'));
app.use('/api/expense', require('./routes/expenseSync'));
app.use('/api/expense', require('./routes/expenseSmsRules'));
app.use('/api/goals',    goalsRoutes);
app.use('/api/family',   familyRoutes);
app.use('/api/portfolio/history', portfolioHistoryRoutes);
app.use('/api/nps',      npsRoutes);
app.use('/api/fd',       fdRoutes);
app.use('/api/rd',       rdRoutes);

// ── Health check ──
// Debug endpoint - check PDF tools
app.get('/debug/pdf-tools', async (req, res) => {
  const { spawnSync } = require('child_process');
  
  const python = spawnSync('python3', ['--version']);
  const pikepdf = spawnSync('python3', ['-c', 'import pikepdf; print(pikepdf.__version__)']);
  const pdfminer = spawnSync('python3', ['-c', 'import pdfminer; print("ok")']);
  const qpdf = spawnSync('qpdf', ['--version']);
  
  res.json({
    python: python.stdout?.toString().trim() || python.stderr?.toString().trim() || 'NOT FOUND',
    pikepdf: pikepdf.stdout?.toString().trim() || pikepdf.stderr?.toString().trim() || 'NOT FOUND',
    pdfminer: pdfminer.stdout?.toString().trim() || pdfminer.stderr?.toString().trim() || 'NOT FOUND',
    qpdf: qpdf.stdout?.toString().trim() || qpdf.stderr?.toString().trim() || 'NOT FOUND',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const PORT = process.env.PORT || 4000;

// Export for Vercel serverless
module.exports = app;

// Listen for Railway/local (not needed on Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 StockPilot backend running on port ${PORT}`);
    const { spawnSync } = require('child_process');
    const qpdfCheck = spawnSync('qpdf', ['--version']);
    if (qpdfCheck.status === 0) {
      console.log(JSON.stringify({ event: 'QPDF_AVAILABLE', version: qpdfCheck.stdout?.toString().trim() }));
    } else {
      console.log(JSON.stringify({ event: 'QPDF_NOT_FOUND', error: 'qpdf not installed' }));
    }
  });
}
