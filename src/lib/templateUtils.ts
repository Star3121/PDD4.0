import { buildImageUrl } from './utils';

export const CANVAS_SIZE_LIMITS = {
  min: 300,
  max: 8000
};

export type CanvasPreset = {
  id: string;
  name: string;
  width: number;
  height: number;
  isCustom?: boolean;
};

export const DEFAULT_CANVAS_PRESETS: CanvasPreset[] = [];

export const normalizeCanvasSize = (width: number, height: number) => {
  const safeWidth = Math.max(CANVAS_SIZE_LIMITS.min, Math.min(CANVAS_SIZE_LIMITS.max, Math.round(width)));
  const safeHeight = Math.max(CANVAS_SIZE_LIMITS.min, Math.min(CANVAS_SIZE_LIMITS.max, Math.round(height)));
  return {
    width: safeWidth,
    height: safeHeight,
    isValid: safeWidth === Math.round(width) && safeHeight === Math.round(height)
  };
};

export const calculateContainFit = (imageWidth: number, imageHeight: number, canvasWidth: number, canvasHeight: number) => {
  const scaleX = canvasWidth / imageWidth;
  const scaleY = canvasHeight / imageHeight;
  const scale = Math.min(scaleX, scaleY);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    scale,
    width,
    height,
    left: (canvasWidth - width) / 2,
    top: (canvasHeight - height) / 2
  };
};

export const filterTemplateFiles = (files: File[], maxCount: number, maxSizeMb: number) => {
  const accepted: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
  const maxBytes = maxSizeMb * 1024 * 1024;

  files.forEach((file) => {
    if (!allowedTypes.includes(file.type)) {
      rejected.push({ file, reason: '文件类型不支持' });
      return;
    }
    if (file.size > maxBytes) {
      rejected.push({ file, reason: '文件大小超限' });
      return;
    }
    accepted.push(file);
  });

  const limitedAccepted = accepted.slice(0, maxCount);
  if (accepted.length > maxCount) {
    accepted.slice(maxCount).forEach((file) => {
      rejected.push({ file, reason: '超过上传数量限制' });
    });
  }

  return {
    accepted: limitedAccepted,
    rejected
  };
};

export const isTemplateNameUnique = (name: string, existingNames: string[]) => {
  const normalized = name.trim().toLowerCase();
  return !existingNames.some(existing => existing.trim().toLowerCase() === normalized);
};

export const serializeCanvasData = (data: unknown) => {
  return JSON.stringify(data);
};

export const buildTempTemplateUrl = (filename: string) => {
  return buildImageUrl(`/api/files/templates-temp/${filename}`);
};
