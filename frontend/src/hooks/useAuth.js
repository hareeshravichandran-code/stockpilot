import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sp_token');
    if (token) {
      // Restore cached user immediately so page doesn't flash to login
      const cached = localStorage.getItem('sp_user');
      if (cached) try { setUser(JSON.parse(cached)); } catch(e) {}
      authAPI.me()
        .then(res => {
          setUser(res.data);
          localStorage.setItem('sp_user', JSON.stringify(res.data));
        })
        .catch(err => {
          // Only clear token if explicitly unauthorized — not on network errors
          if (err.response?.status === 401) {
            localStorage.removeItem('sp_token');
          }
          // On other errors (network, 500, etc.) keep token and retry later
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
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
    if (userData) {
      setUser(userData);
      localStorage.setItem('sp_user', JSON.stringify(userData));
    }
    authAPI.me().then(res => {
      setUser(res.data);
      localStorage.setItem('sp_user', JSON.stringify(res.data));
    }).catch(() => {
      // me() failed — fall back to provided userData or cached
      const cached = localStorage.getItem('sp_user');
      if (cached && !userData) try { setUser(JSON.parse(cached)); } catch(e) {}
    });
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
