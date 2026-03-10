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

  useEffect(() => {
    const token = localStorage.getItem('sp_token');
    if (!token) { setLoading(false); return; }

    // Step 1: Try cached sp_user first (instant, no flicker)
    const cached = localStorage.getItem('sp_user');
    if (cached) {
      try { setUser(JSON.parse(cached)); } catch(e) {}
    } else {
      // Step 2: No cache — decode JWT immediately as minimal user
      // This guarantees user is never null as long as token is valid
      const decoded = decodeToken(token);
      if (decoded?.id) {
        setUser({ id: decoded.id, email: decoded.email, name: decoded.name || decoded.email });
      }
    }

    // Step 3: Always refresh from server in background
    authAPI.me()
      .then(res => {
        setUser(res.data);
        localStorage.setItem('sp_user', JSON.stringify(res.data));
      })
      .catch(err => {
        if (err.response?.status === 401) {
          // Token is invalid — clear everything
          localStorage.removeItem('sp_token');
          localStorage.removeItem('sp_user');
          setUser(null);
        }
        // Any other error (network, 500) — keep the cached/decoded user
        // App remains usable even if backend is briefly down
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

  const loginWithToken = (token, userData) => {
    localStorage.setItem('sp_token', token);
    // Decode token immediately as fallback
    const decoded = decodeToken(token);
    const minimalUser = userData || (decoded?.id ? { id: decoded.id, email: decoded.email, name: decoded.name || decoded.email } : null);
    if (minimalUser) {
      setUser(minimalUser);
      localStorage.setItem('sp_user', JSON.stringify(minimalUser));
    }
    // Refresh with full user data in background
    authAPI.me().then(res => {
      setUser(res.data);
      localStorage.setItem('sp_user', JSON.stringify(res.data));
    }).catch(() => {});
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
