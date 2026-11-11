// Shared look for money flow and events: one colour and one icon per kind.
// Used by the dashboard month strip, the Masters tab and anywhere else money appears.

export const KIND = {
  // money in
  salary:       { c: '#2F6B45', label: 'Salary',        icon: 'briefcase' },
  dividend:     { c: '#A39B8B', label: 'Dividend',      icon: 'coin' },
  rental:       { c: '#5A564F', label: 'Rent received', icon: 'key' },
  interest:     { c: '#5A564F', label: 'Interest',      icon: 'coin' },
  freelance:    { c: '#2F6B45', label: 'Freelance',     icon: 'briefcase' },
  income:       { c: '#2F6B45', label: 'Income',        icon: 'in' },
  refund:       { c: '#85817A', label: 'Refund',        icon: 'in' },
  maturity:     { c: '#2F6B45', label: 'Maturity',      icon: 'flag' },
  // money out
  expense:      { c: '#8C8270', label: 'Spend',         icon: 'bag' },
  loan:         { c: '#3A3833', label: 'Loan / EMI',    icon: 'bank' },
  emi:          { c: '#3A3833', label: 'EMI',           icon: 'bank' },
  card:         { c: '#4A4741', label: 'Card bill',     icon: 'card' },
  card_due:     { c: '#4A4741', label: 'Card bill due', icon: 'card' },
  sip:          { c: '#111111', label: 'SIP',           icon: 'chart' },
  invest:       { c: '#111111', label: 'Invested',      icon: 'chart' },
  rd:           { c: '#111111', label: 'RD',            icon: 'piggy' },
  rd_instalment:{ c: '#111111', label: 'RD instalment', icon: 'piggy' },
  instalment:   { c: '#111111', label: 'Instalment',    icon: 'piggy' },
  insurance:    { c: '#3A3833', label: 'Insurance',     icon: 'shield' },
  premium:      { c: '#3A3833', label: 'Premium',       icon: 'shield' },
  rent:         { c: '#6F6A61', label: 'Rent',          icon: 'house' },
  school_fee:   { c: '#6F6A61', label: 'School fee',    icon: 'bill' },
  maid:         { c: '#6F6A61', label: 'Help / maid',   icon: 'bill' },
  utility:      { c: '#8C8270', label: 'Utility',       icon: 'bill' },
  subscription: { c: '#8C8270', label: 'Subscription',  icon: 'repeat' },
  bill:         { c: '#8C8270', label: 'Bill',          icon: 'bill' },
  other:        { c: '#85817A', label: 'Other',         icon: 'bill' },
};
export const kindOf = (k) => KIND[k] || KIND.other;

const P = {
  briefcase: 'M3 8h18v12H3z M8 8V5h8v3 M3 13h18',
  coin: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16 M14.5 9h-3.2a1.6 1.6 0 0 0 0 3.2h1.4a1.6 1.6 0 0 1 0 3.2H9.5 M12 7.5v1.5 M12 15.4v1.1',
  key: 'M8 14a4 4 0 1 1 3.4-6l9.6 0v3h-2v2h-3v-2h-4.6A4 4 0 0 1 8 14z',
  in: 'M12 4v10 M8 10l4 4 4-4 M4 19h16',
  flag: 'M6 21V4h11l-2 4 2 4H6',
  bag: 'M6 8h12l-1 12H7z M9 8a3 3 0 0 1 6 0',
  bank: 'M3 10l9-6 9 6 M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 20h18',
  card: 'M3 6h18v12H3z M3 10h18 M7 15h4',
  chart: 'M4 19h16 M5 15l4-5 4 3 6-7',
  piggy: 'M5 12a7 5.5 0 0 1 14 0v3.5H5z M8 15.5V19 M16 15.5V19 M15 9.5h.01',
  shield: 'M12 3l7 3v6c0 4.2-3 7.2-7 9-4-1.8-7-4.8-7-9V6z',
  house: 'M4 11l8-7 8 7v9H4z M10 20v-5h4v5',
  repeat: 'M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6',
  bill: 'M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21z M9.5 8h5 M9.5 12h5',
};

export function KindIcon({ kind, size = 16, color, stroke = 1.8 }) {
  const k = kindOf(kind);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || k.c} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[k.icon] || P.bill} /></svg>
  );
}

export const inrShort = (v) => {
  const x = Math.abs(+v || 0);
  const t = (y) => (Math.round(y * 10) / 10).toString().replace(/\.0$/, '');
  if (x >= 1e7) return '₹' + t(x / 1e7) + 'Cr';
  if (x >= 1e5) return '₹' + t(x / 1e5) + 'L';
  if (x >= 1e3) return '₹' + t(x / 1e3) + 'K';
  return '₹' + Math.round(x);
};
