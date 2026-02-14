import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from './api.js';
import RequireAuth from './app/RequireAuth.jsx';
import AppShell from './app/AppShell.jsx';
import AuthPage from './pages/AuthPage.jsx';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      setLogoutError(err.message);
    } finally {
      setUser(null);
    }
  };

  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/me')
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="auth-layout">
        <div className="auth-card">Loading Trainbook…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={<AuthPage mode="login" onAuth={setUser} />}
      />
      <Route
        path="/register"
        element={<AuthPage mode="register" onAuth={setUser} />}
      />
      <Route
        path="/*"
        element={
          <RequireAuth user={user}>
            <AppShell user={user} onLogout={handleLogout} error={logoutError || error} />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
