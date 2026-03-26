import { describe, expect, it } from 'vitest';
import fontsRouter, { setDatabase } from './fonts';

describe('fonts route module', () => {
  it('exports router instance', () => {
    expect(typeof fontsRouter).toBe('function');
  });

  it('exports setDatabase function', () => {
    expect(typeof setDatabase).toBe('function');
  });
});
