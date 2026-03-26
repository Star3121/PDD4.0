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

describe('outline tracing', () => {
  it('traces outer loop for rectangle', () => {
    const width = 20;
    const height = 16;
    const mask = buildMask(width, height, (x, y) => x >= 4 && x <= 15 && y >= 3 && y <= 12);
    const segments = buildMarchingSquaresSegments(mask, width, height);
    const loops = buildOrderedLoopsFromSegments(segments);
    const outer = selectOuterLoop(loops);
    expect(outer).toBeTruthy();
    const length = computeLoopLength(outer!);
    const expected = 2 * ((15 - 4 + 1) + (12 - 3 + 1));
    expect(length).toBeGreaterThan(expected - 4);
    expect(length).toBeLessThan(expected + 4);
  });

  it('ignores inner hole by selecting largest loop', () => {
    const width = 20;
    const height = 20;
    const mask = buildMask(width, height, (x, y) => {
      const outer = x >= 2 && x <= 17 && y >= 2 && y <= 17;
      const inner = x >= 7 && x <= 12 && y >= 7 && y <= 12;
      return outer && !inner;
    });
    const segments = buildMarchingSquaresSegments(mask, width, height);
    const loops = buildOrderedLoopsFromSegments(segments);
    const outer = selectOuterLoop(loops);
    expect(outer).toBeTruthy();
    const length = computeLoopLength(outer!);
    expect(length).toBeGreaterThan(40);
  });

  it('normalizes dash pattern', () => {
    const totalLength = 100;
    const pattern = normalizeDashPattern(totalLength, 5);
    expect(pattern).toBeTruthy();
    expect(pattern!.dash).toBeGreaterThan(0);
    expect(pattern!.gap).toBeGreaterThan(0);
  });
});
