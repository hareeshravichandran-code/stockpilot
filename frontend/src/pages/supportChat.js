import { useRef, useState } from 'react';

// Shared chat pieces for the user's Support page and the admin inbox
export const fmtWhen = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

/** Shrinks an image to at most 1600px and returns { type, data } (base64 JPEG). */
export function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function Bubbles({ messages, mine, onDiag }) {
  if (!messages.length) return <div className="sp-empty">No messages yet.</div>;
  return (
    <div className="sp-bubbles">
      {messages.map(m => (
        <div key={m.id} className={`sp-msg ${mine(m) ? 'me' : 'them'}`}>
          {m.body && <div className="sp-text">{m.body}</div>}
          {m.images?.length > 0 && (
            <div className="sp-imgs">{m.images.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="attachment" /></a>)}</div>
          )}
          {m.diag_id && <button className="sp-diag" onClick={() => onDiag && onDiag(m.diag_id)} disabled={!onDiag}>📦 Diagnostics attached</button>}
          <div className="sp-when">{m.from_admin ? 'Kanalyst support · ' : ''}{fmtWhen(m.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

export function Composer({ onSend, placeholder }) {
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const add = async (files) => {
    const out = [];
    for (const f of [...files].slice(0, 4 - imgs.length)) { try { out.push(await readImage(f)); } catch { /* skip unreadable */ } }
    setImgs(v => [...v, ...out]);
  };
  const send = async () => {
    if (!text.trim() && !imgs.length) return;
    setBusy(true); setErr('');
    try { await onSend({ body: text.trim(), images: imgs }); setText(''); setImgs([]); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="sp-composer" onPaste={e => { const f = [...e.clipboardData.files]; if (f.length) add(f); }}>
      {imgs.length > 0 && (
        <div className="sp-thumbs">{imgs.map((im, i) => (
          <span key={i}><img src={im.data} alt="" /><button onClick={() => setImgs(v => v.filter((_, j) => j !== i))}>×</button></span>))}</div>
      )}
      <div className="sp-row">
        <button className="sp-attach" title="Add a screenshot or photo" onClick={() => fileRef.current?.click()}>📎</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <textarea rows={2} value={text} placeholder={placeholder} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        <button className="sp-send" disabled={busy || (!text.trim() && !imgs.length)} onClick={send}>{busy ? '…' : 'Send'}</button>
      </div>
      {err && <div className="sp-err">{err}</div>}
      <div className="sp-hint">Paste a screenshot, or tap 📎. Ctrl+Enter sends.</div>
    </div>
  );
}
