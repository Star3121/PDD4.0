export interface RuntimeFont {
  fontId: string;
  storageUrl: string;
}

const PRELOAD_PREFIX = 'custom-font-preload-';
const STYLE_PREFIX = 'custom-font-style-';

const ensureUrl = (storageUrl: string) => {
  if (!storageUrl) {
    return '';
  }
  if (storageUrl.startsWith('http://') || storageUrl.startsWith('https://')) {
    return storageUrl;
  }
  return storageUrl.startsWith('/') ? storageUrl : `/${storageUrl}`;
};

export const injectFontRuntime = (font: RuntimeFont) => {
  if (typeof document === 'undefined') {
    return;
  }

  const preloadId = `${PRELOAD_PREFIX}${font.fontId}`;
  const styleId = `${STYLE_PREFIX}${font.fontId}`;
  const href = ensureUrl(font.storageUrl);
  const isOtf = font.storageUrl.toLowerCase().endsWith('.otf');

  if (!document.getElementById(preloadId)) {
    const link = document.createElement('link');
    link.id = preloadId;
    link.rel = 'preload';
    link.as = 'font';
    link.type = isOtf ? 'font/otf' : 'font/ttf';
    link.crossOrigin = 'anonymous';
    link.href = href;
    document.head.appendChild(link);
  }

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `@font-face{font-family:'${font.fontId}';src:url('${href}') format('${isOtf ? 'opentype' : 'truetype'}');font-display:swap;}`;
    document.head.appendChild(style);
  }
};

export const cleanupFontRuntime = (fontId: string) => {
  if (typeof document === 'undefined') {
    return;
  }
  document.getElementById(`${PRELOAD_PREFIX}${fontId}`)?.remove();
  document.getElementById(`${STYLE_PREFIX}${fontId}`)?.remove();
};

export const waitForFontReady = async (fontFamily: string, timeoutMs: number = 6000) => {
  if (typeof document === 'undefined' || !document.fonts?.load) {
    return false;
  }

  try {
    await Promise.race([
      document.fonts.load(`32px "${fontFamily}"`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
};
