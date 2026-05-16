// Kanalyst design tokens — use these in inline JSX styles
// Maps 1:1 to the CSS variables in kanalyst-tokens.css
export const C = {
  // Core surfaces
  bg:       '#efe8d7',
  bg2:      '#e8e0cc',
  surface:  '#faf5e8',
  surface2: '#f3ecd9',
  surface3: '#e8dfc7',

  // Text (ink scale)
  text:  '#1a1612',
  text2: '#5b4e3a',
  text3: '#8a7d6a',
  text4: '#b8ad97',

  // Borders
  border:  'rgba(26,22,18,0.08)',
  border2: 'rgba(26,22,18,0.14)',
  border3: 'rgba(26,22,18,0.22)',

  // Accent system — one colour, one job
  lime:   '#6b8e23',   // moss — signature, hero & active nav
  limeSoft: 'rgba(107,142,35,0.12)',
  mint:   '#1f6b4a',   // forest — positive / gains
  mintSoft: 'rgba(31,107,74,0.10)',
  coral:  '#a82c2c',   // madder — negative / losses / expenses
  coralSoft: 'rgba(168,44,44,0.10)',
  gold:   '#a8741a',   // sienna — dividends
  goldSoft: 'rgba(168,116,26,0.10)',
  violet: '#5d3b78',   // aubergine — mutual funds
  violetSoft: 'rgba(93,59,120,0.10)',
  teal:   '#2d6b6b',   // deep teal — EPF
  tealSoft: 'rgba(45,107,107,0.10)',
  peach:  '#b8551f',   // terracotta — bank deposits / expenses
  peachSoft: 'rgba(184,85,31,0.10)',
  rose:   '#964062',   // mulberry — SSY
  roseSoft: 'rgba(150,64,98,0.10)',
  indigo: '#34487a',   // prussian — NPS / family / invested
  indigoSoft: 'rgba(52,72,122,0.10)',
};

// Recharts tooltip style — reuse everywhere
export const TOOLTIP_STYLE = {
  background: '#faf5e8',
  border: '1px solid rgba(26,22,18,0.12)',
  borderRadius: 8,
  fontSize: 12,
  color: '#1a1612',
  boxShadow: '0 4px 14px rgba(26,22,18,0.08)',
};

// Sector colours mapped to the muted palette
export const SECTOR_COLORS = {
  IT:     '#2d6b6b',   // teal
  Auto:   '#a8741a',   // gold
  Bank:   '#1f6b4a',   // mint
  Infra:  '#6b8e23',   // lime
  Pharma: '#5d3b78',   // violet
  FMCG:   '#a82c2c',   // coral
  Energy: '#b8551f',   // peach
  Other:  '#8a7d6a',   // text3
};

// Generic chart colour palette (10 muted accents)
export const CHART_COLORS = [
  '#6b8e23','#1f6b4a','#2d6b6b','#34487a','#5d3b78',
  '#964062','#a82c2c','#a8741a','#b8551f','#8a7d6a',
];

// Asset allocation pie colours (by asset class)
export const ASSET_COLORS = {
  Stocks:         '#6b8e23',
  'Mutual Funds': '#5d3b78',
  PPF:            '#a8741a',
  EPF:            '#2d6b6b',
  NPS:            '#34487a',
  'Bank Deposits':'#b8551f',
  SSY:            '#964062',
};
