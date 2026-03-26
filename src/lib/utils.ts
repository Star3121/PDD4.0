import clsx, { type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 格式化时间显示
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  // 如果是今天
  if (diffDays === 0) {
    if (diffHours === 0) {
      if (diffMinutes === 0) {
        return '刚刚';
      }
      return `${diffMinutes}分钟前`;
    }
    return `${diffHours}小时前`;
  }
  
  // 如果是昨天
  if (diffDays === 1) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  
  // 如果是一周内
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }
  
  // 超过一周，显示具体日期
  return date.toLocaleDateString('zh-CN', { 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 格式化相对时间（简短版本）
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays === 0) {
    if (diffHours === 0) {
      if (diffMinutes === 0) {
        return '刚刚';
      }
      return `${diffMinutes}分钟前`;
    }
    return `${diffHours}小时前`;
  }
  
  if (diffDays < 30) {
    return `${diffDays}天前`;
  }
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}个月前`;
  }
  
  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}年前`;
}

// 格式化为年月日时分格式
export function formatYMDHM(dateString: string): string {
  // 检查输入是否有效
  if (!dateString || dateString === 'null' || dateString === 'undefined') {
    return '暂无时间';
  }
  
  // 如果是数据库格式的时间字符串（YYYY-MM-DD HH:MM:SS），直接解析
  if (dateString.includes(' ') && dateString.length === 19) {
    const [datePart, timePart] = dateString.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hours, minutes] = timePart.split(':');
    return `${year}年${month}月${day}日${hours}:${minutes}`;
  }
  
  const date = new Date(dateString);
  
  // 检查日期是否有效
  if (isNaN(date.getTime())) {
    return '时间格式错误';
  }
  
  // 数据库存储的已经是东八区时间，直接格式化
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${year}年${month}月${day}日${hours}:${minutes}`;
}

// 构建图片URL
export function buildImageUrl(imagePath: string): string {
  if (!imagePath) return '';
  
  // 如果已经是完整URL，直接返回
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  
  // 确保路径以/开头
  const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;

  // 获取配置的 API Base URL
  // 开发环境通常是 http://localhost:3001/api
  // 生产环境可能是 /api 或空字符串
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001/api');
  
  // 计算 Origin (去除末尾的 /api)
  // http://localhost:3001/api -> http://localhost:3001
  const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, '');

  let normalizedPath = path;

  // 在生产环境将本地静态路径映射到可访问的API文件路径
  if (import.meta.env.PROD) {
    if (path.startsWith('/uploads/templates/')) {
      const filename = path.split('/').pop() || '';
      normalizedPath = `/api/files/templates/${filename}`;
    } else if (path.startsWith('/uploads/images/')) {
      const filename = path.split('/').pop() || '';
      normalizedPath = `/api/files/images/${filename}`;
    } else if (path.startsWith('/uploads/designs/')) {
      const filename = path.split('/').pop() || '';
      normalizedPath = `/api/files/designs/${filename}`;
    }
  }

  const normalizeAssetFilePath = (value: string) => {
    const fileRouteMatch = value.match(/^\/api\/files\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (fileRouteMatch) {
      const bucket = fileRouteMatch[1];
      const filename = fileRouteMatch[2];
      const decodedFilename = (() => {
        try {
          return decodeURIComponent(filename);
        } catch {
          return filename;
        }
      })();
      return `/api/files/${bucket}/${encodeURIComponent(decodedFilename)}`;
    }
    const uploadRouteMatch = value.match(/^\/uploads\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (uploadRouteMatch) {
      const bucket = uploadRouteMatch[1];
      const filename = uploadRouteMatch[2];
      const decodedFilename = (() => {
        try {
          return decodeURIComponent(filename);
        } catch {
          return filename;
        }
      })();
      return `/uploads/${bucket}/${encodeURIComponent(decodedFilename)}`;
    }
    return value;
  };
  normalizedPath = normalizeAssetFilePath(normalizedPath);

  // 如果路径已经是 /api 开头，而 apiBaseUrl 也包含 /api，则使用 apiOrigin 避免重复
  if (normalizedPath.startsWith('/api/') && apiBaseUrl.endsWith('/api')) {
    return `${apiOrigin}${normalizedPath}`;
  }
  
  // 如果路径是 /uploads 开头（开发环境静态文件），应该直接挂载在 Origin 下
  if (normalizedPath.startsWith('/uploads/')) {
    return `${apiOrigin}${normalizedPath}`;
  }

  // 其他情况直接拼接
  return `${apiBaseUrl}${normalizedPath}`;
}

// 构建缩略图URL
export function buildThumbnailUrl(imagePath: string, size: 'thumb' | 'medium' = 'thumb'): string {
  const fullUrl = buildImageUrl(imagePath);
  // Insert prefix before filename
  const parts = fullUrl.split('/');
  const filename = parts.pop();
  if (!filename) return fullUrl;
  return parts.join('/') + '/' + size + '_' + filename;
}

export function normalizeImageAssetPath(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) return normalized;
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }
  const resolveFilename = (value: string) => {
    const cleanValue = value.split('?')[0].split('#')[0];
    const rawFilename = cleanValue.split('/').pop() || '';
    if (!rawFilename) return '';
    const decodedFilename = (() => {
      try {
        return decodeURIComponent(rawFilename);
      } catch {
        return rawFilename;
      }
    })();
    if (decodedFilename.startsWith('medium_')) return decodedFilename.slice(7);
    if (decodedFilename.startsWith('thumb_')) return decodedFilename.slice(6);
    return decodedFilename;
  };
  if (normalized.startsWith('/api/files/images/') || normalized.startsWith('/uploads/images/')) {
    const filename = resolveFilename(normalized);
    return filename ? `/api/files/images/${filename}` : normalized;
  }
  try {
    const parsed = new URL(normalized, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const routeMatch = parsed.pathname.match(/^\/api\/files\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (routeMatch) {
      const bucket = routeMatch[1].toLowerCase();
      const filename = resolveFilename(routeMatch[2]);
      return filename ? `/api/files/${bucket}/${filename}` : normalized;
    }
    const directBucketMatch = parsed.pathname.match(/^\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (directBucketMatch) {
      const bucket = directBucketMatch[1].toLowerCase();
      const filename = resolveFilename(directBucketMatch[2]);
      return filename ? `/api/files/${bucket}/${filename}` : normalized;
    }
    const supabaseMatch = parsed.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (supabaseMatch) {
      const bucket = supabaseMatch[1].toLowerCase();
      const filename = resolveFilename(supabaseMatch[2]);
      return filename ? `/api/files/${bucket}/${filename}` : normalized;
    }
    if (parsed.pathname.startsWith('/api/files/images/') || parsed.pathname.startsWith('/uploads/images/')) {
      const filename = resolveFilename(parsed.pathname);
      return filename ? `/api/files/images/${filename}` : normalized;
    }
    const r2Match = parsed.pathname.match(/^\/images\/([^/?#]+)$/i);
    if (r2Match) {
      const filename = resolveFilename(r2Match[1]);
      return filename ? `/api/files/images/${filename}` : normalized;
    }
  } catch {
    return normalized;
  }
  return normalized;
}

export function buildImageVariantPath(imagePath: string, size: 'original' | 'medium' | 'thumb' = 'original'): string {
  const normalized = normalizeImageAssetPath(imagePath);
  if (!normalized || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }
  if (size === 'original') {
    return normalized;
  }
  const segments = normalized.split('/');
  const filename = segments.pop();
  if (!filename) return normalized;
  return `${segments.join('/')}/${size}_${filename}`;
}

export function buildProxyFileUrl(url: string): string {
  const normalized = String(url || '').trim();
  if (!normalized) return normalized;
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized, window.location.origin);
    parsed.searchParams.set('proxy', '1');
    return parsed.toString();
  } catch {
    const separator = normalized.includes('?') ? '&' : '?';
    return `${normalized}${separator}proxy=1`;
  }
}

export function resolveCanvasAssetUrl(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) return normalized;
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }
  if (normalized.startsWith('/uploads/') || normalized.startsWith('/api/files/')) {
    return buildProxyFileUrl(buildImageUrl(normalized));
  }
  try {
    const parsed = new URL(normalized);
    const fileRouteMatch = parsed.pathname.match(/^\/api\/files\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (fileRouteMatch) {
      return buildProxyFileUrl(parsed.toString());
    }
    const directBucketMatch = parsed.pathname.match(/^\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (directBucketMatch) {
      const bucket = directBucketMatch[1].toLowerCase();
      const filename = directBucketMatch[2];
      return buildProxyFileUrl(buildImageUrl(`/api/files/${bucket}/${filename}`));
    }
    const supabaseMatch = parsed.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(templates|images|designs|fonts)\/([^/?#]+)$/i);
    if (supabaseMatch) {
      const bucket = supabaseMatch[1].toLowerCase();
      const filename = supabaseMatch[2];
      return buildProxyFileUrl(buildImageUrl(`/api/files/${bucket}/${filename}`));
    }
  } catch {
    return normalized;
  }
  return normalized;
}

export function buildCanvasEditorImageUrl(imagePath: string): string {
  const normalized = String(imagePath || '').trim();
  if (!normalized) return normalized;
  return resolveCanvasAssetUrl(buildImageUrl(buildImageVariantPath(normalized, 'medium')));
}

export type CanvasImageRenderTarget = 'editor' | 'export';

const isCanvasImageNode = (node: Record<string, any>) => {
  return Boolean(node?._isImage || node?._isFrameImage || node?.type === 'image');
};

const resolvePositiveNumber = (value: unknown) => {
  const resolved = Number(value);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
};

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

export const applyImageCropAndScaleFromRatios = (
  node: Record<string, any>,
  options?: {
    naturalWidth?: number;
    naturalHeight?: number;
    preserveDisplaySize?: boolean;
    fallbackToFullImageWhenRatiosMissing?: boolean;
  }
) => {
  const naturalWidth = resolvePositiveNumber(options?.naturalWidth) || resolvePositiveNumber(node._assetNaturalWidth);
  const naturalHeight = resolvePositiveNumber(options?.naturalHeight) || resolvePositiveNumber(node._assetNaturalHeight);
  const cropWidthRatioRaw = Number(node._cropWidthRatio);
  const cropHeightRatioRaw = Number(node._cropHeightRatio);
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
    return false;
  }
  if (!Number.isFinite(cropWidthRatioRaw) || !Number.isFinite(cropHeightRatioRaw)) {
    const previousWidth = Math.max(1, Number(node.width) || 1);
    const previousHeight = Math.max(1, Number(node.height) || 1);
    const previousScaleX = Number(node.scaleX) || 1;
    const previousScaleY = Number(node.scaleY) || 1;
    const cropX = Math.max(0, Number(node.cropX) || 0);
    const cropY = Math.max(0, Number(node.cropY) || 0);
    if (naturalWidth > 0) {
      node._assetNaturalWidth = naturalWidth;
    }
    if (naturalHeight > 0) {
      node._assetNaturalHeight = naturalHeight;
    }
    const hasOriginalAssetPath = typeof node._assetOriginalPath === 'string' && node._assetOriginalPath.trim() !== '';
    const likelySourceSwitchClip = Boolean(
      options?.fallbackToFullImageWhenRatiosMissing
      && options?.preserveDisplaySize
      && hasOriginalAssetPath
      && cropX === 0
      && cropY === 0
      && (previousWidth < naturalWidth * 0.98 || previousHeight < naturalHeight * 0.98)
    );
    if (likelySourceSwitchClip) {
      node.width = naturalWidth;
      node.height = naturalHeight;
      node.scaleX = previousScaleX * (previousWidth / naturalWidth);
      node.scaleY = previousScaleY * (previousHeight / naturalHeight);
      return true;
    }
    return false;
  }
  const previousWidth = Math.max(1, Number(node.width) || 1);
  const previousHeight = Math.max(1, Number(node.height) || 1);
  const previousScaleX = Number(node.scaleX) || 1;
  const previousScaleY = Number(node.scaleY) || 1;
  const minWidthRatio = 1 / naturalWidth;
  const minHeightRatio = 1 / naturalHeight;
  const cropWidthRatio = clampNumber(cropWidthRatioRaw, minWidthRatio, 1);
  const cropHeightRatio = clampNumber(cropHeightRatioRaw, minHeightRatio, 1);
  const cropXRatio = Number(node._cropXRatio) || 0;
  const cropYRatio = Number(node._cropYRatio) || 0;
  const nextWidth = Math.max(1, cropWidthRatio * naturalWidth);
  const nextHeight = Math.max(1, cropHeightRatio * naturalHeight);
  const maxCropX = Math.max(0, naturalWidth - nextWidth);
  const maxCropY = Math.max(0, naturalHeight - nextHeight);
  node.cropX = clampNumber(cropXRatio * naturalWidth, 0, maxCropX);
  node.cropY = clampNumber(cropYRatio * naturalHeight, 0, maxCropY);
  node.width = nextWidth;
  node.height = nextHeight;
  node._assetNaturalWidth = naturalWidth;
  node._assetNaturalHeight = naturalHeight;
  if (options?.preserveDisplaySize) {
    node.scaleX = previousScaleX * (previousWidth / nextWidth);
    node.scaleY = previousScaleY * (previousHeight / nextHeight);
  }
  return true;
};

const applyRelativeCropForRender = (
  node: Record<string, any>,
  options?: {
    preserveDisplaySize?: boolean;
  }
) => {
  applyImageCropAndScaleFromRatios(node, {
    preserveDisplaySize: options?.preserveDisplaySize,
  });
};

const normalizeCanvasImageNodeForRender = (node: Record<string, any>, target: CanvasImageRenderTarget) => {
  const sourceCandidate = node._assetOriginalPath || node._assetEditorPath || node._assetThumbPath || node.src || node._src;
  const normalizedPath = normalizeImageAssetPath(String(sourceCandidate || ''));
  if (normalizedPath && !normalizedPath.startsWith('data:') && !normalizedPath.startsWith('blob:')) {
    node._assetOriginalPath = buildImageVariantPath(normalizedPath, 'original');
    node._assetEditorPath = buildImageVariantPath(normalizedPath, 'medium');
    node._assetThumbPath = buildImageVariantPath(normalizedPath, 'thumb');
    const targetPath = target === 'export' ? node._assetOriginalPath : node._assetEditorPath;
    node.src = resolveCanvasAssetUrl(buildImageUrl(targetPath));
    node._src = node.src;
  } else if (typeof node.src === 'string') {
    node.src = resolveCanvasAssetUrl(node.src);
    node._src = node.src;
  }
  applyRelativeCropForRender(node, { preserveDisplaySize: target === 'export' });
};

const visitCanvasJsonNodes = (node: unknown, visitor: (value: Record<string, any>) => void) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => visitCanvasJsonNodes(item, visitor));
    return;
  }
  visitor(node as Record<string, any>);
  Object.values(node as Record<string, any>).forEach((value) => {
    if (value && typeof value === 'object') {
      visitCanvasJsonNodes(value, visitor);
    }
  });
};

export function prepareCanvasJsonForRender<T = Record<string, any>>(canvasJson: T, target: CanvasImageRenderTarget = 'editor'): T {
  const cloned = JSON.parse(JSON.stringify(canvasJson ?? {})) as T;
  visitCanvasJsonNodes(cloned, (node) => {
    if (!isCanvasImageNode(node)) return;
    normalizeCanvasImageNodeForRender(node, target);
  });
  return cloned;
}

export function prepareCanvasDataForRender(canvasData: string, target: CanvasImageRenderTarget = 'editor'): string {
  if (!canvasData) return canvasData;
  const parsed = JSON.parse(canvasData);
  return JSON.stringify(prepareCanvasJsonForRender(parsed, target));
}

export type CanvasLayerMeta = {
  id: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
};

export type CanvasDataEnvelope = {
  schemaVersion: number;
  compressed: boolean;
  encoding: 'plain' | 'gzip-base64';
  data: string;
  meta: {
    createdAt: number;
    objectCount: number;
    layers: CanvasLayerMeta[];
  };
};

const CANVAS_DATA_SCHEMA_VERSION = 2;

const toBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
};

const fromBase64 = (base64: string) => {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

const supportsCompression = () => {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
};

const gzipString = async (value: string) => {
  const encoder = new TextEncoder();
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode(value));
  await writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return toBase64(new Uint8Array(buffer));
};

const gunzipString = async (value: string) => {
  const bytes = fromBase64(value);
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(buffer);
};

const resolveLayerType = (obj: any) => {
  if (obj?._isFrame) return 'frame';
  if (obj?._isImage || obj?._isFrameImage) return 'image';
  if (obj?.isWaveGroup) return 'wave-text';
  if (obj?.type === 'i-text' || obj?.type === 'text' || obj?.type === 'textbox') return 'text';
  return obj?.type || 'object';
};

export const buildCanvasLayerMetadata = (canvasJson: any): CanvasLayerMeta[] => {
  const objects = Array.isArray(canvasJson?.objects) ? canvasJson.objects : [];
  return objects.map((obj: any, index: number) => {
    const scaleX = Number.isFinite(obj?.scaleX) ? Number(obj.scaleX) : 1;
    const scaleY = Number.isFinite(obj?.scaleY) ? Number(obj.scaleY) : 1;
    const width = Number.isFinite(obj?.width) ? Number(obj.width) : 0;
    const height = Number.isFinite(obj?.height) ? Number(obj.height) : 0;
    const left = Number.isFinite(obj?.left) ? Number(obj.left) : 0;
    const top = Number.isFinite(obj?.top) ? Number(obj.top) : 0;
    const angle = Number.isFinite(obj?.angle) ? Number(obj.angle) : 0;
    const opacity = Number.isFinite(obj?.opacity) ? Number(obj.opacity) : 1;
    const visible = typeof obj?.visible === 'boolean' ? obj.visible : true;
    return {
      id: obj?.__uid || obj?.id || `layer-${index}`,
      type: resolveLayerType(obj),
      left,
      top,
      width: width * scaleX,
      height: height * scaleY,
      angle,
      scaleX,
      scaleY,
      opacity,
      visible,
      zIndex: index
    };
  });
};

export const serializeCanvasData = async (rawCanvasData: string, options?: { compress?: boolean; timeoutMs?: number }) => {
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawCanvasData);
  } catch (error) {
    console.warn('[CanvasData] Invalid canvas JSON, skip envelope:', error);
    return rawCanvasData;
  }
  const layers = buildCanvasLayerMetadata(parsed);
  const envelope: CanvasDataEnvelope = {
    schemaVersion: CANVAS_DATA_SCHEMA_VERSION,
    compressed: false,
    encoding: 'plain',
    data: rawCanvasData,
    meta: {
      createdAt: Date.now(),
      objectCount: layers.length,
      layers
    }
  };
  if (options?.compress && supportsCompression()) {
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? Number(options?.timeoutMs) : 2500;
    try {
      const compressed = await Promise.race([
        gzipString(rawCanvasData),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('canvas compression timeout')), timeoutMs);
        })
      ]);
      envelope.data = compressed;
      envelope.compressed = true;
      envelope.encoding = 'gzip-base64';
    } catch (error) {
      console.warn('[CanvasData] Compression skipped:', error);
    }
  }
  return JSON.stringify(envelope);
};

const isCanvasEnvelope = (payload: any): payload is CanvasDataEnvelope => {
  return payload && typeof payload === 'object' && typeof payload.schemaVersion === 'number' && typeof payload.data === 'string';
};

export const deserializeCanvasData = async (payload: string) => {
  let parsed: any = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { canvasData: payload, envelope: null as CanvasDataEnvelope | null };
  }
  if (!isCanvasEnvelope(parsed)) {
    return { canvasData: payload, envelope: null as CanvasDataEnvelope | null };
  }
  if (parsed.compressed && parsed.encoding === 'gzip-base64') {
    if (!supportsCompression()) {
      throw new Error('当前环境不支持解压画布数据');
    }
    const decompressed = await gunzipString(parsed.data);
    return { canvasData: decompressed, envelope: parsed };
  }
  return { canvasData: parsed.data, envelope: parsed };
};
