import { describe, expect, it } from 'vitest';
import { normalizeDashPattern } from './outlineTracing';

describe('outlineUtils', () => {
  it('normalizes dash pattern output', () => {
    const result = normalizeDashPattern(120, 6);
    expect(result).toBeTruthy();
    expect(result?.dash).toBeGreaterThan(0);
  });
});
