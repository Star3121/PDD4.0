import { describe, expect, it } from 'vitest';
import {
  buildMarchingSquaresSegments,
  buildOrderedLoopsFromSegments,
  computeLoopLength,
  normalizeDashPattern,
  selectOuterLoop,
} from './outlineTracing';

const buildMask = (width: number, height: number, fill: (x: number, y: number) => boolean) => {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = fill(x, y) ? 1 : 0;
    }
  }
  return mask;
};

describe('outline tracing integration', () => {
  it('handles complex star-like contour without shortcut', () => {
    const width = 64;
    const height = 64;
    const mask = buildMask(width, height, (x, y) => {
      const cx = 32;
      const cy = 32;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const spikes = 6;
      const wave = Math.abs(Math.sin(angle * spikes)) * 8;
      return r < 22 + wave;
    });
    const segments = buildMarchingSquaresSegments(mask, width, height);
    const loops = buildOrderedLoopsFromSegments(segments);
    const outer = selectOuterLoop(loops);
    expect(outer).toBeTruthy();
    const length = computeLoopLength(outer!);
    expect(length).toBeGreaterThan(120);
    const dash = normalizeDashPattern(length, 6);
    expect(dash).toBeTruthy();
  });
});
