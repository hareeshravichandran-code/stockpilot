import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../lib/api';

const AuthContext = createContext(null);

// Decode JWT payload without verifying signature (client-side only)
// This lets us get user id/email from token without any API call
function decodeToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Check token isn't expired
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload; // { id, email, iat, exp }
  } catch(e) { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const hydrateFromStorage = () => {
    const token = localStorage.getItem('sp_token');
    if (!token) { setLoading(false); return false; }

    // Try cached user first
    const cached = localStorage.getItem('sp_user');
    if (cached) {
      try { setUser(JSON.parse(cached)); } catch(e) {}
    } else {
      const decoded = decodeToken(token);
      if (decoded?.id) {
        setUser({ id: decoded.id, email: decoded.email, name: decoded.name || decoded.email });
      } else {
        // Token is malformed — clear it
        localStorage.removeItem('sp_token');
        setLoading(false);
        return false;
      }
    }
    return true;
  };

  useEffect(() => {
    const ok = hydrateFromStorage();
    if (!ok) return;

    // Refresh from server in background
    authAPI.me()
      .then(res => {
        setUser(res.data);
        localStorage.setItem('sp_user', JSON.stringify(res.data));
      })
      .catch(err => {
        // ONLY clear token on definitive 401 from /me
        // Network errors, CORS, 500s → keep the decoded/cached user
        if (err.response?.status === 401) {
          localStorage.removeItem('sp_token');
          localStorage.removeItem('sp_user');
          setUser(null);
        }
        // Otherwise stay logged in with decoded JWT data
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await authAPI.login({ email, password });
    localStorage.setItem('sp_token', res.data.token);
    localStorage.setItem('sp_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  };

  const signup = async (name, email, password) => {
    const res = await authAPI.signup({ name, email, password });
    localStorage.setItem('sp_token', res.data.token);
    localStorage.setItem('sp_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  };

  const loginWithToken = (token, partialUser) => {
    localStorage.setItem('sp_token', token);
    const decoded = decodeToken(token);
    const minimalUser = decoded?.id
      ? { id: decoded.id, email: decoded.email, name: partialUser?.name || decoded.name || decoded.email }
      : partialUser || null;
    if (minimalUser) {
      setUser(minimalUser);
      localStorage.setItem('sp_user', JSON.stringify(minimalUser));
    }
    // Refresh with full user data in background
    authAPI.me()
      .then(res => {
        setUser(res.data);
        localStorage.setItem('sp_user', JSON.stringify(res.data));
      })
      .catch(() => {});
  };

  const logout = () => {
    localStorage.removeItem('sp_token');
    localStorage.removeItem('sp_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, loginWithToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
