import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('chm_token');
    const savedUser = localStorage.getItem('chm_user');
    if (token && savedUser) setUser(JSON.parse(savedUser));
    setReady(true);
  }, []);

  function persistSession(token, userObj) {
    localStorage.setItem('chm_token', token);
    localStorage.setItem('chm_user', JSON.stringify(userObj));
    setUser(userObj);
  }

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    persistSession(data.token, data.user);
    return data.user;
  }

  async function register(payload) {
    const { data } = await api.post('/auth/register', payload);
    persistSession(data.token, data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('chm_token');
    localStorage.removeItem('chm_user');
    setUser(null);
  }

  // Re-fetches the current user from the server — used after actions that
  // change server-side state but not the locally cached user object, e.g.
  // completing the Google Calendar OAuth flow.
  async function refreshUser() {
    try {
      const { data } = await api.get('/auth/me');
      localStorage.setItem('chm_user', JSON.stringify(data));
      setUser(data);
      return data;
    } catch {
      // If the token is stale, the response interceptor in api/client.js
      // already handles redirecting to /login — nothing further to do here.
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
