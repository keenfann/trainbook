import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getMotionConfig } from '../../motion.js';
import { useMotionPreferences } from '../../motion-preferences.jsx';

function AnimatedNavLink({ to, children }) {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      {({ isActive }) => (
        <span className="nav-link-inner">
          <AnimatePresence>
            {isActive ? (
              <motion.span
                layoutId="primary-nav-active-pill"
                className="nav-link-active-bg"
                transition={motionConfig.transition.springSoft}
              />
            ) : null}
          </AnimatePresence>
          <motion.span
            className="nav-link-label"
            whileTap={resolvedReducedMotion ? undefined : { scale: motionConfig.tapScale }}
            transition={motionConfig.transition.fast}
          >
            {children}
          </motion.span>
        </span>
      )}
    </NavLink>
  );
}

export default AnimatedNavLink;
