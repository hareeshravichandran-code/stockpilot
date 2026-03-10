import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Auth.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function Signup() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup, loginWithToken } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle Google OAuth callback — same backend route as login
  useEffect(() => {
    const token = searchParams.get('token');
    const err   = searchParams.get('error');
    if (token) { loginWithToken(token); nav('/dashboard'); }
    if (err)   setError(err === 'google_denied' ? 'Google sign-up was cancelled.' : 'Google sign-up failed. Please try again.');
  }, [searchParams, loginWithToken, nav]);

  const handle = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleGoogle = () => {
    window.location.href = `${API}/api/auth/google`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setLoading(true);
    try {
      await signup(form.name, form.email, form.password);
      nav('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">StockPilot</div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Free forever. Connect your email. Track everything.</p>

        {error && <div className="auth-error">{error}</div>}

        {/* Google Sign Up */}
        <button className="btn-google" onClick={handleGoogle} type="button">
          <svg width="18" height="18" viewBox="0 0 18 18" style={{marginRight:8}}>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.5 10.48A4.8 4.8 0 0 1 4.5 7.5V5.43H1.83a8 8 0 0 0 0 7.14l2.67-2.09z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8 8 0 0 0 1.83 5.43L4.5 7.5a4.77 4.77 0 0 1 4.48-3.92z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form onSubmit={submit} className="auth-form">
          <div className="form-group">
            <label>Your name</label>
            <input type="text" name="name" value={form.name}
              onChange={handle} placeholder="Rajesh Kumar" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" value={form.email}
              onChange={handle} placeholder="you@example.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" name="password" value={form.password}
              onChange={handle} placeholder="Min. 8 characters" required />
          </div>
          <button className="btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account →'}
          </button>
        </form>

        <div className="auth-note">
          🔒 We only read emails. We never send, delete, or modify them.
        </div>
        <div className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
