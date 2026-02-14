import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetch } from '../api.js';
import { getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';

function AuthPage({ mode, onAuth }) {
  const navigate = useNavigate();
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === 'login';

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/api/auth/${isLogin ? 'login' : 'register'}`,
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        }
      );
      onAuth(data.user);
      navigate('/workout');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <motion.form
        className="auth-card"
        onSubmit={onSubmit}
        variants={motionConfig.variants.scaleIn}
        initial="hidden"
        animate="visible"
      >
        <div className="auth-title">{isLogin ? 'Welcome back' : 'Create account'}</div>
        <p className="muted">
          {isLogin
            ? 'Log in to keep training momentum.'
            : 'Start logging workouts and watch progress stack up.'}
        </p>
        <AnimatePresence initial={false}>
          {error ? (
            <motion.div
              className="notice"
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {error}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="stack">
          <div>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. coach"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
            />
          </div>
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Working…' : isLogin ? 'Log in' : 'Create account'}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => navigate(isLogin ? '/register' : '/login')}
          >
            {isLogin ? 'Need an account? Sign up' : 'Already have an account? Log in'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

export default AuthPage;
