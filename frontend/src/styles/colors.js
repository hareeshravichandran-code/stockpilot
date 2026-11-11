// Kanalyst design tokens — use these in inline JSX styles
// Maps 1:1 to the CSS variables in kanalyst-tokens.css
export const C = {
  // Core surfaces
  bg:       '#F3EEE3',
  bg2:      '#ECE6D8',
  surface:  '#FAF7F0',
  surface2: '#EFE9DC',
  surface3: '#E6DFCF',

  // Text (ink scale)
  text:  '#111111',
  text2: '#4A4741',
  text3: '#85817A',
  text4: '#B5B0A6',

  // Borders
  border:  'rgba(17,17,17,0.08)',
  border2: 'rgba(17,17,17,0.14)',
  border3: 'rgba(17,17,17,0.22)',

  // Accent system — one colour, one job
  lime:   '#D9541E',   // burnt orange — the one accent: buttons, active, due-now
  limeSoft: 'rgba(217,84,30,0.10)',
  pop:    '#D9541E',
  sand:   '#CFC6B4',
  mint:   '#2F6B45',   // forest — positive / gains
  mintSoft: 'rgba(47,107,69,0.10)',
  coral:  '#9E2B25',   // madder — negative / losses / expenses
  coralSoft: 'rgba(158,43,37,0.10)',
  gold:   '#A39B8B',   // sienna — dividends
  goldSoft: 'rgba(163,155,139,0.10)',
  violet: '#111111',   // aubergine — mutual funds
  violetSoft: 'rgba(17,17,17,0.10)',
  teal:   '#6F6A61',   // deep teal — EPF
  tealSoft: 'rgba(90,86,79,0.10)',
  peach:  '#8C8270',   // terracotta — bank deposits / expenses
  peachSoft: 'rgba(140,130,112,0.10)',
  rose:   '#B9B09E',   // mulberry — SSY
  roseSoft: 'rgba(111,106,97,0.10)',
  indigo: '#4A4741',   // prussian — NPS / family / invested
  indigoSoft: 'rgba(58,56,51,0.10)',
};

// Recharts tooltip style — reuse everywhere
export const TOOLTIP_STYLE = {
  background: '#FAF7F0',
  border: '1px solid rgba(17,17,17,0.12)',
  borderRadius: 8,
  fontSize: 12,
  color: '#111111',
  boxShadow: '0 4px 14px rgba(17,17,17,0.08)',
};

// Sector colours mapped to the muted palette
export const SECTOR_COLORS = {
  // Charts: ink → sand steps (orange is kept for actions, red for losses)
  IT:     '#111111',
  Auto:   '#A39B8B',
  Bank:   '#4A4741',
  Infra:  '#8C8270',
  Pharma: '#6F6A61',
  FMCG:   '#2F2D29',
  Energy: '#CFC6B4',
  Metal:  '#5A564F',
  Other:  '#B9B09E',
};

// Generic chart colour palette (10 muted accents)
export const CHART_COLORS = [
  '#111111','#4A4741','#8C8270','#CFC6B4','#2F2D29',
  '#6F6A61','#A39B8B','#5A564F','#B9B09E','#85817A',
];

// Asset allocation pie colours (by asset class)
export const ASSET_COLORS = {
  'Mutual Funds': '#111111',
  NPS:            '#4A4741',
  EPF:            '#6F6A61',
  'Bank Deposits':'#8C8270',
  Stocks:         '#CFC6B4',
  PPF:            '#A39B8B',
  SSY:            '#B9B09E',
};
