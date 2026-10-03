import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { getMotionConfig } from '../../motion.js';
import { useMotionPreferences } from '../../motion-preferences.jsx';

// Exit animations can overlap the next dialog (for example, workout completion).
// Hold the background lock until the last dialog has actually unmounted.
const modalStack = [];
let restoreBackground = null;

function AnimatedModal({ onClose, panelClassName = '', label = 'Details', children }) {
  const { resolvedReducedMotion } = useMotionPreferences();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );

  useEffect(() => {
    const previousFocus = document.activeElement;
    const panel = panelRef.current;
    if (!modalStack.length) {
      const previousOverflow = document.body.style.overflow;
      const appRoot = document.getElementById('root');
      const wasInert = appRoot?.hasAttribute('inert');
      document.body.style.overflow = 'hidden';
      appRoot?.setAttribute('inert', '');
      restoreBackground = () => {
        document.body.style.overflow = previousOverflow;
        if (!wasInert) appRoot?.removeAttribute('inert');
        if (previousFocus?.isConnected) previousFocus.focus?.();
      };
    }
    modalStack.push(panel);
    panel?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();
      }
      if (event.key !== 'Tab' || !panel) return;
      const controls = [...panel.querySelectorAll('*')].filter((element) =>
        element.matches('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')
        && !element.closest('[hidden], [inert]')
        && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY')
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener('keydown', handleKeyDown);
    return () => {
      panel?.removeEventListener('keydown', handleKeyDown);
      modalStack.splice(modalStack.indexOf(panel), 1);
      if (!modalStack.length) {
        restoreBackground?.();
        restoreBackground = null;
      } else {
        const topPanel = modalStack.at(-1);
        if (!topPanel?.contains(document.activeElement)) {
          if (previousFocus?.isConnected && topPanel?.contains(previousFocus)) previousFocus.focus();
          else topPanel?.focus();
        }
      }
    };
  }, []);

  return createPortal(
    <motion.div
      className="modal-backdrop"
      variants={motionConfig.variants.modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={() => onClose?.()}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`modal-panel ${panelClassName}`.trim()}
        variants={motionConfig.variants.modalPanel}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default AnimatedModal;
