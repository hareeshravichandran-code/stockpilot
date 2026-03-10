import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Auth.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'forgot' | 'reset'
  const [form, setForm] = useState({ email: '', password: '', otp: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithToken } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle Google OAuth callback — token in URL
  useEffect(() => {
    const token = searchParams.get('token');
    const err   = searchParams.get('error');
    const reason = searchParams.get('reason');

    if (token) {
      // Save token — useAuth will decode it immediately on /dashboard load
      // No need for API call here; decodeToken() in useAuth handles it
      localStorage.setItem('sp_token', token);
      localStorage.removeItem('sp_user'); // force fresh decode from JWT
      window.location.replace('/dashboard');
      return;
    }

    if (err) setError(
      err === 'google_denied' ? 'Google sign-in was cancelled.' :
      err === 'create_failed' ? 'Could not create account. Please try email signup.' :
      `Google sign-in failed${reason ? ': ' + reason : '. Please try again.'}`
    );
  }, [searchParams]);

  const handle = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await login(form.email, form.password);
      nav('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('A 6-digit reset code has been sent to your email.');
      setMode('reset');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleReset = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    if (form.newPassword !== form.confirmPassword)
      return setError('Passwords do not match.') || setLoading(false);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, otp: form.otp, newPassword: form.newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('Password reset! You can now log in.');
      setMode('login');
      setForm(p => ({ ...p, password: '' }));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleGoogle = () => {
    window.location.href = `${API}/api/auth/google`;
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">StockPilot</div>

        {mode === 'login' && <>
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-sub">Sign in to view your portfolio</p>

          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          {/* Google Sign In */}
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

          <form onSubmit={handleLogin} className="auth-form">
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" value={form.email} onChange={handle} placeholder="you@example.com" required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" name="password" value={form.password} onChange={handle} placeholder="••••••••" required />
            </div>
            <div className="auth-forgot-row">
              <button type="button" className="btn-link" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}>
                Forgot password?
              </button>
            </div>
            <button className="btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          <div className="auth-switch">
            Don't have an account? <Link to="/signup">Sign up free</Link>
          </div>
        </>}

        {mode === 'forgot' && <>
          <h1 className="auth-title">Reset Password</h1>
          <p className="auth-sub">Enter your email to receive a reset code</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleForgot} className="auth-form">
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" value={form.email} onChange={handle} placeholder="you@example.com" required />
            </div>
            <button className="btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send Reset Code →'}
            </button>
          </form>

          <div className="auth-switch">
            <button type="button" className="btn-link" onClick={() => { setMode('login'); setError(''); }}>
              ← Back to login
            </button>
          </div>
        </>}

        {mode === 'reset' && <>
          <h1 className="auth-title">Enter Reset Code</h1>
          <p className="auth-sub">Check your email for the 6-digit code</p>

          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          <form onSubmit={handleReset} className="auth-form">
            <div className="form-group">
              <label>6-Digit Code</label>
              <input type="text" name="otp" value={form.otp} onChange={handle}
                placeholder="123456" maxLength={6} required
                style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" name="newPassword" value={form.newPassword} onChange={handle} placeholder="Min 8 characters" required />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" name="confirmPassword" value={form.confirmPassword} onChange={handle} placeholder="••••••••" required />
            </div>
            <button className="btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Resetting…' : 'Reset Password →'}
            </button>
          </form>

          <div className="auth-switch">
            <button type="button" className="btn-link"
              onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}>
              Resend code
            </button>
            {' · '}
            <button type="button" className="btn-link" onClick={() => { setMode('login'); setError(''); }}>
              Back to login
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}
