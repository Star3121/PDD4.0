export interface RuntimeFont {
  fontId: string;
  storageUrl: string;
}

const PRELOAD_PREFIX = 'custom-font-preload-';
const STYLE_PREFIX = 'custom-font-style-';
const runtimeFontSourceMap = new Map<string, string>();
const runtimeFontFailureSet = new Set<string>();

const ensureUrl = (storageUrl: string) => {
  if (!storageUrl) {
    return '';
  }
  if (storageUrl.startsWith('http://') || storageUrl.startsWith('https://')) {
    return storageUrl;
  }
  return storageUrl.startsWith('/') ? storageUrl : `/${storageUrl}`;
};

const getFontType = (storageUrl: string) => {
  const normalizedUrl = ensureUrl(storageUrl).split('?')[0].toLowerCase();
  if (normalizedUrl.endsWith('.woff2')) {
    return { mimeType: 'font/woff2', format: 'woff2' };
  }
  if (normalizedUrl.endsWith('.woff')) {
    return { mimeType: 'font/woff', format: 'woff' };
  }
  if (normalizedUrl.endsWith('.otf')) {
    return { mimeType: 'font/otf', format: 'opentype' };
  }
  return { mimeType: 'font/ttf', format: 'truetype' };
};

export const collectFontFamiliesFromNode = (node: unknown, collector: Set<string> = new Set<string>()) => {
  if (!node || typeof node !== 'object') {
    return collector;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectFontFamiliesFromNode(item, collector));
    return collector;
  }
  const candidate = node as Record<string, unknown>;
  const fontFamily = typeof candidate.fontFamily === 'string' ? candidate.fontFamily.trim() : '';
  if (fontFamily) {
    collector.add(fontFamily);
  }
  Object.values(candidate).forEach((value) => {
    if (value && typeof value === 'object') {
      collectFontFamiliesFromNode(value, collector);
    }
  });
  return collector;
};

export const registerRuntimeFontFace = async (fontFamily: string, storageUrl: string) => {
  const family = String(fontFamily || '').trim();
  const href = ensureUrl(storageUrl);
  if (!family || !href || typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts?.load) {
    return false;
  }
  const fontKey = `${family}::${href}`;
  if (runtimeFontFailureSet.has(fontKey)) {
    return false;
  }
  const previousUrl = runtimeFontSourceMap.get(family);
  const isReady = typeof document.fonts.check === 'function'
    ? document.fonts.check(`12px "${family}"`)
    : false;
  if (previousUrl === href && isReady) {
    return true;
  }
  try {
    const { format } = getFontType(href);
    const sourceUrl = encodeURI(href);
    const fontFace = new FontFace(family, `url("${sourceUrl}") format('${format}')`);
    const loaded = await fontFace.load();
    (document.fonts as any).add(loaded);
    runtimeFontSourceMap.set(family, href);
    await document.fonts.load(`12px "${family}"`);
    return true;
  } catch {
    runtimeFontFailureSet.add(fontKey);
    return false;
  }
};

export const injectFontRuntime = (font: RuntimeFont) => {
  if (typeof document === 'undefined') {
    return;
  }

  const preloadId = `${PRELOAD_PREFIX}${font.fontId}`;
  const styleId = `${STYLE_PREFIX}${font.fontId}`;
  const href = ensureUrl(font.storageUrl);
  const { mimeType, format } = getFontType(font.storageUrl);

  if (!document.getElementById(preloadId)) {
    const link = document.createElement('link');
    link.id = preloadId;
    link.rel = 'preload';
    link.as = 'font';
    link.type = mimeType;
    link.crossOrigin = 'anonymous';
    link.href = href;
    document.head.appendChild(link);
  }

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `@font-face{font-family:'${font.fontId}';src:url('${href}') format('${format}');font-display:swap;}`;
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
