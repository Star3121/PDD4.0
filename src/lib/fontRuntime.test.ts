import { beforeEach, describe, expect, it } from 'vitest';
import { cleanupFontRuntime, injectFontRuntime, waitForFontReady } from './fontRuntime';

describe('fontRuntime', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('injects preload and style nodes', () => {
    injectFontRuntime({ fontId: 'font-a', storageUrl: '/fonts/a.ttf' });
    expect(document.getElementById('custom-font-preload-font-a')).toBeTruthy();
    expect(document.getElementById('custom-font-style-font-a')).toBeTruthy();
  });

  it('cleans up injected runtime nodes', () => {
    injectFontRuntime({ fontId: 'font-b', storageUrl: '/fonts/b.otf' });
    cleanupFontRuntime('font-b');
    expect(document.getElementById('custom-font-preload-font-b')).toBeNull();
    expect(document.getElementById('custom-font-style-font-b')).toBeNull();
  });

  it('returns false when fonts API is unavailable', async () => {
    const originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    await expect(waitForFontReady('font-c')).resolves.toBe(false);
    Object.defineProperty(document, 'fonts', { value: originalFonts, configurable: true });
  });
});
