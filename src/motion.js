export const IOS_EASINGS = {
  standard: [0.22, 1, 0.36, 1],
  snappy: [0.2, 0.95, 0.22, 1],
  soft: [0.16, 1, 0.3, 1],
};

export const IOS_DURATIONS = {
  xs: 0.14,
  sm: 0.2,
  md: 0.3,
  lg: 0.42,
};

export const IOS_SPRINGS = {
  standard: {
    type: 'spring',
    stiffness: 340,
    damping: 32,
    mass: 0.8,
  },
  snappy: {
    type: 'spring',
    stiffness: 420,
    damping: 34,
    mass: 0.75,
  },
  soft: {
    type: 'spring',
    stiffness: 260,
    damping: 30,
    mass: 0.85,
  },
};

const REDUCED_DURATION = 0.01;

export function getMotionConfig(reducedMotion = false) {
  const transition = {
    fast: reducedMotion
      ? { duration: REDUCED_DURATION }
      : { duration: IOS_DURATIONS.sm, ease: IOS_EASINGS.standard },
    standard: reducedMotion
      ? { duration: REDUCED_DURATION }
      : { duration: IOS_DURATIONS.md, ease: IOS_EASINGS.standard },
    soft: reducedMotion
      ? { duration: REDUCED_DURATION }
      : { duration: IOS_DURATIONS.lg, ease: IOS_EASINGS.soft },
    spring: reducedMotion ? { duration: REDUCED_DURATION } : IOS_SPRINGS.standard,
    springSoft: reducedMotion ? { duration: REDUCED_DURATION } : IOS_SPRINGS.soft,
    springSnappy: reducedMotion ? { duration: REDUCED_DURATION } : IOS_SPRINGS.snappy,
  };

  const variants = {
    fade: {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: transition.standard },
      exit: { opacity: 0, transition: transition.fast },
    },
    fadeUp: {
      hidden: { opacity: 0, y: reducedMotion ? 0 : 10 },
      visible: { opacity: 1, y: 0, transition: transition.standard },
      exit: { opacity: 0, y: reducedMotion ? 0 : -6, transition: transition.fast },
    },
    scaleIn: {
      hidden: {
        opacity: 0,
        scale: reducedMotion ? 1 : 0.985,
      },
      visible: { opacity: 1, scale: 1, transition: transition.springSoft },
      exit: {
        opacity: 0,
        scale: reducedMotion ? 1 : 0.985,
        transition: transition.fast,
      },
    },
    modalBackdrop: {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: transition.fast },
      exit: { opacity: 0, transition: transition.fast },
    },
    modalPanel: {
      hidden: {
        opacity: 0,
        y: reducedMotion ? 0 : 14,
        scale: reducedMotion ? 1 : 0.985,
      },
      visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: transition.springSoft,
      },
      exit: {
        opacity: 0,
        y: reducedMotion ? 0 : 10,
        scale: reducedMotion ? 1 : 0.99,
        transition: transition.fast,
      },
    },
    listStagger: {
      hidden: {},
      visible: {
        transition: reducedMotion
          ? { duration: REDUCED_DURATION }
          : { staggerChildren: 0.04, delayChildren: 0.02 },
      },
    },
    listItem: {
      hidden: { opacity: 0, y: reducedMotion ? 0 : 8 },
      visible: { opacity: 1, y: 0, transition: transition.standard },
    },
  };

  return {
    reducedMotion,
    transition,
    variants,
    tapScale: reducedMotion ? 1 : 0.985,
    hoverLiftY: reducedMotion ? 0 : -1.5,
    hoverScale: reducedMotion ? 1 : 1.01,
  };
}

export function getDirectionalPageVariants(reducedMotion = false) {
  const transition = reducedMotion
    ? { duration: REDUCED_DURATION }
    : { duration: IOS_DURATIONS.lg, ease: IOS_EASINGS.soft };

  return {
    initial: (direction = 0) => ({
      opacity: 0,
      x: reducedMotion ? 0 : direction > 0 ? 22 : direction < 0 ? -22 : 0,
      scale: reducedMotion ? 1 : 0.996,
    }),
    animate: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition,
    },
    exit: (direction = 0) => ({
      opacity: 0,
      x: reducedMotion ? 0 : direction > 0 ? -18 : direction < 0 ? 18 : 0,
      scale: reducedMotion ? 1 : 0.996,
      transition,
    }),
  };
}

export function getChartAnimationConfig(reducedMotion = false, mode = 'initial') {
  if (reducedMotion) {
    return {
      isAnimationActive: false,
      animationDuration: 0,
      animationBegin: 0,
      animationEasing: 'ease',
    };
  }

  const isInitial = mode === 'initial';
  return {
    isAnimationActive: true,
    animationDuration: isInitial ? 680 : 360,
    animationBegin: isInitial ? 70 : 0,
    animationEasing: isInitial ? 'ease-out' : 'ease-in-out',
  };
}
