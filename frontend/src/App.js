import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Dividends from './pages/Dividends';
import Blueprint from './pages/Blueprint';
import Family from './pages/Family';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
      height:'100vh', background:'var(--bg)', color:'var(--lime)', fontSize:'18px' }}>
      Loading Kanalyst…
    </div>
  );
  if (!user) {
    const params = window.location.search;
    // Remember where the user was heading (e.g. /blueprint) so Login can return there
    try { if (window.location.pathname !== '/dashboard') sessionStorage.setItem('sp_next', window.location.pathname); } catch (e) {}
    return <Navigate to={`/login${params}`} replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  // If a ?token= param is in the URL we must let Login.js handle it —
  // never redirect away from /login while token processing is in flight
  const hasToken = new URLSearchParams(window.location.search).has('token');
  if (hasToken) return children;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/dividends" element={<PrivateRoute><Dividends /></PrivateRoute>} />
          <Route path="/blueprint" element={<PrivateRoute><Blueprint /></PrivateRoute>} />
          <Route path="/family" element={<PrivateRoute><Family /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
