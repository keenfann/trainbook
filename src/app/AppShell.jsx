import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { getDirectionalPageVariants, getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import { resolveRouteOrder, resolveTopLevelPath } from '../features/workout/workout-utils.js';
import AnimatedNavLink from '../ui/nav/AnimatedNavLink.jsx';
import LogPage from '../pages/LogPage.jsx';
import RoutinesPage from '../pages/RoutinesPage.jsx';
import ExercisesPage from '../pages/ExercisesPage.jsx';
import StatsPage from '../pages/StatsPage.jsx';
import SettingsPage from '../pages/SettingsPage.jsx';

function AppShell({ user, onLogout, error }) {
  const location = useLocation();
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const pageTransitionVariants = useMemo(
    () => getDirectionalPageVariants(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [routeDirection, setRouteDirection] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncState, setSyncState] = useState({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    queueSize: 0,
    syncing: false,
    lastError: null,
  });
  const previousRouteOrderRef = useRef(resolveRouteOrder(location.pathname));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSyncState = (event) => {
      setSyncState((previous) => ({
        ...previous,
        ...(event.detail || {}),
      }));
    };
    const onOnline = () => {
      setSyncState((previous) => ({ ...previous, online: true }));
    };
    const onOffline = () => {
      setSyncState((previous) => ({ ...previous, online: false }));
    };
    window.addEventListener('trainbook:sync-state', onSyncState);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('trainbook:sync-state', onSyncState);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const previousOrder = previousRouteOrderRef.current;
    const nextOrder = resolveRouteOrder(location.pathname);
    if (nextOrder === previousOrder) {
      setRouteDirection(0);
    } else {
      setRouteDirection(nextOrder > previousOrder ? 1 : -1);
    }
    previousRouteOrderRef.current = nextOrder;
    setMenuOpen(false);
  }, [location.pathname]);

  const showSyncBanner =
    !syncState.online || syncState.syncing || syncState.queueSize > 0 || Boolean(syncState.lastError);
  const syncMessage = !syncState.online
    ? 'Offline mode: changes are queued on this device.'
    : syncState.syncing
      ? `Syncing ${syncState.queueSize} queued changes…`
      : syncState.queueSize > 0
        ? `${syncState.queueSize} changes queued for sync.`
        : syncState.lastError
          ? syncState.lastError
          : null;
  const pageKey = resolveTopLevelPath(location.pathname);

  return (
    <div className="app-shell" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="inline">
            <div className="brand-group">
              <img src="/logo.png" alt="Trainbook logo" className="brand-logo" />
              <div className="brand">Trainbook</div>
            </div>
            <span className={`tag ${syncState.online ? '' : 'sync-tag-offline'}`}>
              {syncState.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="header-menu">
            <motion.button
              type="button"
              className="header-chip"
              whileHover={
                resolvedReducedMotion
                  ? undefined
                  : { y: motionConfig.hoverLiftY, scale: motionConfig.hoverScale }
              }
              whileTap={resolvedReducedMotion ? undefined : { scale: motionConfig.tapScale }}
              transition={motionConfig.transition.fast}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              {user?.username}
            </motion.button>
            <AnimatePresence>
              {menuOpen ? (
                <motion.div
                  className="menu-panel"
                  variants={motionConfig.variants.scaleIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={(event) => event.stopPropagation()}
                >
                  <NavLink className="menu-item" to="/settings" onClick={() => setMenuOpen(false)}>
                    Settings
                  </NavLink>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    Log out
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {showSyncBanner && syncMessage ? (
            <motion.div
              className={`sync-banner ${syncState.lastError ? 'sync-banner-error' : ''}`}
              variants={motionConfig.variants.fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {syncMessage}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <nav className="navbar">
          <LayoutGroup id="primary-nav">
            <AnimatedNavLink to="/workout">Workout</AnimatedNavLink>
            <AnimatedNavLink to="/routines">Routines</AnimatedNavLink>
            <AnimatedNavLink to="/exercises">Exercises</AnimatedNavLink>
            <AnimatedNavLink to="/stats">Stats</AnimatedNavLink>
          </LayoutGroup>
        </nav>
      </header>

      <main className="page">
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
        <AnimatePresence mode="wait" initial={false} custom={routeDirection}>
          <motion.div
            key={pageKey}
            className="page-transition-shell"
            custom={routeDirection}
            variants={pageTransitionVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <Routes location={location}>
              <Route path="/" element={<Navigate to="/workout" replace />} />
              <Route path="/workout" element={<LogPage />} />
              <Route path="/log" element={<Navigate to="/workout" replace />} />
              <Route path="/routines" element={<RoutinesPage />} />
              <Route path="/exercises" element={<ExercisesPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage user={user} onLogout={onLogout} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default AppShell;
