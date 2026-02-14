import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { getMotionConfig } from '../../motion.js';
import { useMotionPreferences } from '../../motion-preferences.jsx';

function AnimatedModal({ onClose, panelClassName = '', children }) {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  return (
    <motion.div
      className="modal-backdrop"
      variants={motionConfig.variants.modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={() => onClose?.()}
    >
      <motion.div
        className={`modal-panel ${panelClassName}`.trim()}
        variants={motionConfig.variants.modalPanel}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export default AnimatedModal;
