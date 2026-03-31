import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupFontRuntime, collectFontFamiliesFromNode, injectFontRuntime, registerRuntimeFontFace, waitForFontReady } from './fontRuntime';

const originalDocument = (globalThis as any).document;
const originalFontFace = (globalThis as any).FontFace;

const createMockDocument = () => {
  const elements = new Map<string, any>();
  const head = {
    _innerHTML: '',
    appendChild(node: any) {
      if (node?.id) {
        elements.set(node.id, node);
      }
      return node;
    },
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value: string) {
      this._innerHTML = value;
      elements.clear();
    }
  };
  return {
    head,
    fonts: {
      add: vi.fn(),
      load: vi.fn().mockResolvedValue([]),
      check: vi.fn().mockReturnValue(false)
    },
    createElement: vi.fn().mockImplementation(() => {
      const node: any = {
        remove: vi.fn().mockImplementation(() => {
          if (node.id) {
            elements.delete(node.id);
          }
        })
      };
      return node;
    }),
    getElementById: vi.fn().mockImplementation((id: string) => elements.get(id) ?? null)
  };
};

describe('fontRuntime', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: createMockDocument(),
      configurable: true
    });
    document.head.innerHTML = '';
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true
    });
    Object.defineProperty(globalThis, 'FontFace', {
      value: originalFontFace,
      configurable: true
    });
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

  it('collects unique font families from nested canvas data', () => {
    const families = collectFontFamiliesFromNode({
      objects: [
        { type: 'text', fontFamily: 'Font A' },
        { type: 'group', objects: [{ type: 'text', fontFamily: 'Font B' }] },
        { type: 'text', styles: { 0: { 0: { fontFamily: 'Font A' } } } }
      ]
    });
    expect(Array.from(families)).toEqual(['Font A', 'Font B']);
  });

  it('registers runtime font faces with the detected format', async () => {
    const add = vi.fn();
    const load = vi.fn().mockResolvedValue([]);
    const check = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'fonts', {
      value: { add, load, check },
      configurable: true
    });
    const fontFaceLoad = vi.fn().mockResolvedValue({ family: 'Fancy Font' });
    const fontFaceConstructor = vi.fn().mockImplementation(function FontFace(this: any, family: string, source: string) {
      this.family = family;
      this.source = source;
      this.load = fontFaceLoad;
    });
    Object.defineProperty(globalThis, 'FontFace', {
      value: fontFaceConstructor,
      configurable: true
    });

    await expect(registerRuntimeFontFace('Fancy Font', '/api/files/fonts/fancy.woff2')).resolves.toBe(true);

    expect(fontFaceConstructor).toHaveBeenCalledWith('Fancy Font', `url("${encodeURI('/api/files/fonts/fancy.woff2')}") format('woff2')`);
    expect(fontFaceLoad).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('12px "Fancy Font"');
  });
});
