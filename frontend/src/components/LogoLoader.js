import './LogoLoader.css';

/**
 * Kanalyst's house logo as the loading animation: the four rooms light up in turn and the door opens.
 * Use it wherever something loads. size: px of the mark; label: optional line under it.
 */
export default function LogoLoader({ size = 44, label = '', inline = false }) {
  return (
    <div className={`k-loader${inline ? ' inline' : ''}`} role="status" aria-live="polite" aria-label={label || 'Loading'}>
      <svg className="k-loader-mark" width={size} height={size * 60 / 64} viewBox="0 0 64 60" aria-hidden="true">
        <defs><clipPath id="k-loader-house"><path d="M32 3.5 C33.6 3.5 34.6 4.1 35.8 5.1 L59 24.6 C60.4 25.8 61 27 61 28.8 V52 C61 55.3 58.3 58 55 58 H9 C5.7 58 3 55.3 3 52 V28.8 C3 27 3.6 25.8 5 24.6 L28.2 5.1 C29.4 4.1 30.4 3.5 32 3.5 Z" /></clipPath></defs>
        <g clipPath="url(#k-loader-house)">
          <rect className="k-room r1" width="32" height="31" fill="#2f4577" />
          <rect className="k-room r2" x="32" width="32" height="31" fill="#5f7f1f" />
          <rect className="k-room r3" x="32" y="31" width="32" height="29" fill="#e3a018" />
          <rect className="k-room r4" y="31" width="32" height="29" fill="#964062" />
        </g>
        <path className="k-door" d="M26 58 V44 C26 40.7 28.7 38 32 38 C35.3 38 38 40.7 38 44 V58 Z" fill="#FAF7F0" />
      </svg>
      {label && <div className="k-loader-label">{label}</div>}
    </div>
  );
}
