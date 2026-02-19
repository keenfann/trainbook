import { describe, expect, it } from 'vitest';

import {
  getChartAnimationConfig,
  getDirectionalPageVariants,
  getMotionConfig,
} from '../src/motion.js';

describe('motion helpers', () => {
  it('builds full-motion config with ios-inspired defaults', () => {
    const config = getMotionConfig(false);

    expect(config.reducedMotion).toBe(false);
    expect(config.transition.fast).toEqual({
      duration: 0.2,
      ease: [0.22, 1, 0.36, 1],
    });
    expect(config.variants.fadeUp.hidden.y).toBe(10);
    expect(config.variants.fadeUp.exit.y).toBe(-6);
    expect(config.variants.listStagger.visible.transition).toEqual({
      staggerChildren: 0.04,
      delayChildren: 0.02,
    });
    expect(config.tapScale).toBe(0.985);
    expect(config.hoverLiftY).toBe(-1.5);
    expect(config.hoverScale).toBe(1.01);
  });

  it('builds reduced-motion config without movement offsets', () => {
    const config = getMotionConfig(true);

    expect(config.reducedMotion).toBe(true);
    expect(config.transition.fast).toEqual({ duration: 0.01 });
    expect(config.transition.spring).toEqual({ duration: 0.01 });
    expect(config.variants.fadeUp.hidden.y).toBe(0);
    expect(config.variants.fadeUp.exit.y).toBe(0);
    expect(config.variants.modalPanel.hidden.scale).toBe(1);
    expect(config.variants.listStagger.visible.transition).toEqual({ duration: 0.01 });
    expect(config.tapScale).toBe(1);
    expect(config.hoverLiftY).toBe(0);
    expect(config.hoverScale).toBe(1);
  });

  it('resolves directional page variants based on direction and reduced motion', () => {
    const fullMotion = getDirectionalPageVariants(false);
    expect(fullMotion.initial(1)).toMatchObject({ x: 22, scale: 0.996, opacity: 0 });
    expect(fullMotion.initial(-1)).toMatchObject({ x: -22, scale: 0.996, opacity: 0 });
    expect(fullMotion.exit(1)).toMatchObject({ x: -18, scale: 0.996, opacity: 0 });
    expect(fullMotion.exit(-1)).toMatchObject({ x: 18, scale: 0.996, opacity: 0 });

    const reduced = getDirectionalPageVariants(true);
    expect(reduced.initial(1)).toMatchObject({ x: 0, scale: 1, opacity: 0 });
    expect(reduced.exit(-1)).toMatchObject({ x: 0, scale: 1, opacity: 0 });
    expect(reduced.animate.transition).toEqual({ duration: 0.01 });
  });

  it('builds chart animation config for reduced and full modes', () => {
    expect(getChartAnimationConfig(true)).toEqual({
      isAnimationActive: false,
      animationDuration: 0,
      animationBegin: 0,
      animationEasing: 'ease',
    });

    expect(getChartAnimationConfig(false, 'initial')).toEqual({
      isAnimationActive: true,
      animationDuration: 680,
      animationBegin: 70,
      animationEasing: 'ease-out',
    });

    expect(getChartAnimationConfig(false, 'update')).toEqual({
      isAnimationActive: true,
      animationDuration: 360,
      animationBegin: 0,
      animationEasing: 'ease-in-out',
    });
  });
});
