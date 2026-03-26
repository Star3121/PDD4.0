import { fabric } from 'fabric';
import {
  buildMarchingSquaresSegments,
  buildOrderedLoopsFromSegments,
  computeLoopLength,
  normalizeDashPattern,
  selectOuterLoop,
} from './outlineTracing';
import { applyImageCropAndScaleFromRatios, deserializeCanvasData, prepareCanvasDataForRender } from './utils';

// 画布配置常量（与CanvasEditor保持一致）
const CANVAS_CONFIG = {
  PHYSICAL_WIDTH_CM: 75,
  PHYSICAL_HEIGHT_CM: 100,
  ASPECT_RATIO: 75 / 100,
  BASE_DISPLAY_WIDTH_PX: 3000,
  BASE_DISPLAY_HEIGHT_PX: 4000,
  PRINT_WIDTH_PX: 3000,
  PRINT_HEIGHT_PX: 4000,
  DISPLAY_DPI: 72,
  PRINT_DPI: 300,
};

type ImageStrokeStyle = 'regular' | 'dashed' | 'solid' | 'double-regular' | 'none';

interface ImageStrokeLayerSettings {
  color: string;
  thickness: number;
  opacity: number;
}

interface ImageStrokeSettings {
  style: ImageStrokeStyle;
  color: string;
  thickness: number;
  opacity: number;
  innerLayer: ImageStrokeLayerSettings;
  outerLayer: ImageStrokeLayerSettings;
}

const DEFAULT_IMAGE_STROKE_SETTINGS: ImageStrokeSettings = {
  style: 'none',
  color: '#000000',
  thickness: 2,
  opacity: 100,
  innerLayer: {
    color: '#000000',
    thickness: 2,
    opacity: 100,
  },
  outerLayer: {
    color: '#000000',
    thickness: 2,
    opacity: 100,
  },
};
const STROKE_INNER_OVERLAP_PX = 3;

const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeImageStrokeSettings = (raw?: Partial<ImageStrokeSettings> | null): ImageStrokeSettings => {
  const source = raw || {};
  const style = source.style || DEFAULT_IMAGE_STROKE_SETTINGS.style;
  const color = typeof source.color === 'string' ? source.color : DEFAULT_IMAGE_STROKE_SETTINGS.color;
  const thickness = clampValue(Number(source.thickness ?? DEFAULT_IMAGE_STROKE_SETTINGS.thickness), 1, 50);
  const opacity = clampValue(Number(source.opacity ?? DEFAULT_IMAGE_STROKE_SETTINGS.opacity), 0, 100);
  const normalizeLayer = (
    rawLayer: Partial<ImageStrokeLayerSettings> | null | undefined,
    fallback: ImageStrokeLayerSettings
  ): ImageStrokeLayerSettings => {
    const layerSource = rawLayer || {};
    return {
      color: typeof layerSource.color === 'string' ? layerSource.color : fallback.color,
      thickness: clampValue(Number(layerSource.thickness ?? fallback.thickness), 1, 50),
      opacity: clampValue(Number(layerSource.opacity ?? fallback.opacity), 0, 100),
    };
  };
  return {
    style: style === 'regular' || style === 'dashed' || style === 'solid' || style === 'double-regular' || style === 'none'
      ? style
      : DEFAULT_IMAGE_STROKE_SETTINGS.style,
    color,
    thickness,
    opacity,
    innerLayer: normalizeLayer(source.innerLayer, {
      color,
      thickness,
      opacity,
    }),
    outerLayer: normalizeLayer(source.outerLayer, DEFAULT_IMAGE_STROKE_SETTINGS.outerLayer),
  };
};

const getImageSourceData = (image: fabric.Image) => {
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | null;
  if (!element) return null;
  const width = image.width || (element as HTMLImageElement).naturalWidth || (element as HTMLCanvasElement).width;
  const height = image.height || (element as HTMLImageElement).naturalHeight || (element as HTMLCanvasElement).height;
  if (!width || !height) return null;
  return { element, width, height };
};

const buildAlphaMaskCanvas = (image: fabric.Image, padding: number, threshold: number) => {
  const sourceData = getImageSourceData(image);
  if (!sourceData) return null;
  const { element, width, height } = sourceData;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width + padding * 2;
  maskCanvas.height = height + padding * 2;
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return null;
  const cropX = image.cropX || 0;
  const cropY = image.cropY || 0;
  ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  ctx.drawImage(
    element,
    cropX,
    cropY,
    width,
    height,
    padding,
    padding,
    width,
    height
  );
  const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha >= threshold) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return maskCanvas;
};

const buildDilatedMask = (maskCanvas: HTMLCanvasElement, radius: number) => {
  if (radius <= 0) return maskCanvas;
  const dilatedCanvas = document.createElement('canvas');
  dilatedCanvas.width = maskCanvas.width;
  dilatedCanvas.height = maskCanvas.height;
  const ctx = dilatedCanvas.getContext('2d');
  if (!ctx) return maskCanvas;
  ctx.clearRect(0, 0, dilatedCanvas.width, dilatedCanvas.height);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.filter = 'none';
  const imageData = ctx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 0) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return dilatedCanvas;
};

const buildMaskArray = (maskCanvas: HTMLCanvasElement) => {
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const data = imageData.data;
  const mask = new Uint8Array(maskCanvas.width * maskCanvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    mask[p] = data[i + 3] > 0 ? 1 : 0;
  }
  return { mask, width: maskCanvas.width, height: maskCanvas.height };
};

const computeSquaredDistanceToMask = (mask: Uint8Array, width: number, height: number) => {
  const INF = 1e20;
  const edt1d = (f: Float64Array, n: number) => {
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1] < q) k += 1;
      const dx = q - v[k];
      d[q] = dx * dx + f[v[k]];
    }
    return d;
  };
  const g = new Float64Array(width * height);
  const fCol = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      fCol[y] = mask[y * width + x] ? 0 : INF;
    }
    const dCol = edt1d(fCol, height);
    for (let y = 0; y < height; y += 1) {
      g[y * width + x] = dCol[y];
    }
  }
  const dist2 = new Float32Array(width * height);
  const fRow = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      fRow[x] = g[rowOffset + x];
    }
    const dRow = edt1d(fRow, width);
    for (let x = 0; x < width; x += 1) {
      dist2[rowOffset + x] = dRow[x];
    }
  }
  return dist2;
};

const buildDistanceRingMaskCanvas = (
  maskData: { mask: Uint8Array; width: number; height: number },
  dist2: Float32Array,
  insideDist2: Float32Array | null,
  innerDistance: number,
  outerDistance: number,
  innerOverlap: number
) => {
  const ringCanvas = document.createElement('canvas');
  ringCanvas.width = maskData.width;
  ringCanvas.height = maskData.height;
  const ringCtx = ringCanvas.getContext('2d');
  if (!ringCtx) return null;
  const imageData = ringCtx.createImageData(maskData.width, maskData.height);
  const data = imageData.data;
  const innerSq = innerDistance * innerDistance;
  const outerSq = outerDistance * outerDistance;
  const overlapSq = innerOverlap * innerOverlap;
  const allowInsideOverlap = innerOverlap > 0 && innerDistance <= 0;
  for (let p = 0; p < maskData.mask.length; p += 1) {
    const isInside = maskData.mask[p] === 1;
    if (isInside) {
      if (!allowInsideOverlap || !insideDist2) continue;
      if (insideDist2[p] > overlapSq) continue;
    } else {
      const d2 = dist2[p];
      if (d2 <= innerSq || d2 > outerSq) continue;
    }
    const i = p * 4;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  ringCtx.putImageData(imageData, 0, 0);
  return ringCanvas;
};

const drawRingMaskLayer = (
  targetCtx: CanvasRenderingContext2D,
  ringMaskCanvas: HTMLCanvasElement,
  color: string,
  opacity: number
) => {
  if (opacity <= 0) return;
  const layerCanvas = document.createElement('canvas');
  layerCanvas.width = ringMaskCanvas.width;
  layerCanvas.height = ringMaskCanvas.height;
  const ringCtx = layerCanvas.getContext('2d');
  if (!ringCtx) return;
  ringCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  ringCtx.drawImage(ringMaskCanvas, 0, 0);
  ringCtx.globalCompositeOperation = 'source-in';
  ringCtx.fillStyle = color;
  ringCtx.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
  ringCtx.globalCompositeOperation = 'source-over';
  targetCtx.save();
  targetCtx.globalAlpha = opacity / 100;
  targetCtx.drawImage(layerCanvas, 0, 0);
  targetCtx.restore();
};

const buildStrokeOverlayCanvas = (image: fabric.Image, settings: ImageStrokeSettings) => {
  const normalized = normalizeImageStrokeSettings(settings);
  const isDoubleRegular = normalized.style === 'double-regular';
  const singleStrokeHidden = normalized.opacity <= 0 || normalized.thickness <= 0;
  const doubleStrokeHidden = normalized.innerLayer.opacity <= 0 && normalized.outerLayer.opacity <= 0;
  if (normalized.style === 'none' || (!isDoubleRegular && singleStrokeHidden) || (isDoubleRegular && doubleStrokeHidden)) {
    return null;
  }
  const threshold = 10;
  if (normalized.style === 'regular') {
    const padding = Math.ceil(normalized.thickness + 4);
    const baseMaskCanvas = buildAlphaMaskCanvas(image, padding, threshold);
    if (!baseMaskCanvas) return null;
    const maskData = buildMaskArray(baseMaskCanvas);
    if (!maskData) return null;
    const dist2 = computeSquaredDistanceToMask(maskData.mask, maskData.width, maskData.height);
    const invertedMask = new Uint8Array(maskData.mask.length);
    for (let i = 0; i < maskData.mask.length; i += 1) {
      invertedMask[i] = maskData.mask[i] ? 0 : 1;
    }
    const insideDist2 = computeSquaredDistanceToMask(invertedMask, maskData.width, maskData.height);
    const ringMaskCanvas = buildDistanceRingMaskCanvas(
      maskData,
      dist2,
      insideDist2,
      0,
      normalized.thickness,
      STROKE_INNER_OVERLAP_PX
    );
    if (!ringMaskCanvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const strokeScaleBoost = normalized.thickness >= 12 ? 1.75 : normalized.thickness >= 6 ? 1.5 : 1.25;
    const renderScale = Math.min(2.5, dpr * strokeScaleBoost);
    const outlineCanvas = document.createElement('canvas');
    outlineCanvas.width = ringMaskCanvas.width * renderScale;
    outlineCanvas.height = ringMaskCanvas.height * renderScale;
    const ctx = outlineCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, ringMaskCanvas.width, ringMaskCanvas.height);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
    }
    drawRingMaskLayer(ctx, ringMaskCanvas, normalized.color, normalized.opacity);
    return { canvas: outlineCanvas, padding, renderScale };
  }
  if (isDoubleRegular) {
    const totalThickness = normalized.innerLayer.thickness + normalized.outerLayer.thickness;
    const padding = Math.ceil(totalThickness + 4);
    const baseMaskCanvas = buildAlphaMaskCanvas(image, padding, threshold);
    if (!baseMaskCanvas) return null;
    const maskData = buildMaskArray(baseMaskCanvas);
    if (!maskData) return null;
    const dist2 = computeSquaredDistanceToMask(maskData.mask, maskData.width, maskData.height);
    const invertedMask = new Uint8Array(maskData.mask.length);
    for (let i = 0; i < maskData.mask.length; i += 1) {
      invertedMask[i] = maskData.mask[i] ? 0 : 1;
    }
    const insideDist2 = computeSquaredDistanceToMask(invertedMask, maskData.width, maskData.height);
    const innerRingMaskCanvas = buildDistanceRingMaskCanvas(
      maskData,
      dist2,
      insideDist2,
      0,
      normalized.innerLayer.thickness,
      STROKE_INNER_OVERLAP_PX
    );
    const outerRingMaskCanvas = buildDistanceRingMaskCanvas(
      maskData,
      dist2,
      insideDist2,
      normalized.innerLayer.thickness,
      totalThickness,
      0
    );
    if (!innerRingMaskCanvas || !outerRingMaskCanvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const strokeScaleBoost = totalThickness >= 12 ? 1.75 : totalThickness >= 6 ? 1.5 : 1.25;
    const renderScale = Math.min(2.5, dpr * strokeScaleBoost);
    const outlineCanvas = document.createElement('canvas');
    outlineCanvas.width = baseMaskCanvas.width * renderScale;
    outlineCanvas.height = baseMaskCanvas.height * renderScale;
    const ctx = outlineCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, baseMaskCanvas.width, baseMaskCanvas.height);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
    }
    drawRingMaskLayer(ctx, innerRingMaskCanvas, normalized.innerLayer.color, normalized.innerLayer.opacity);
    drawRingMaskLayer(ctx, outerRingMaskCanvas, normalized.outerLayer.color, normalized.outerLayer.opacity);
    return { canvas: outlineCanvas, padding, renderScale };
  }
  const gap = Math.max(2, normalized.thickness * 0.6);
  const padding = Math.ceil(gap + normalized.thickness + 4);
  const baseMaskCanvas = buildAlphaMaskCanvas(image, padding, threshold);
  if (!baseMaskCanvas) return null;
  const radius = gap + normalized.thickness / 2;
  const contourMaskCanvas = radius > 0 ? buildDilatedMask(baseMaskCanvas, radius) : baseMaskCanvas;
  const maskData = buildMaskArray(contourMaskCanvas);
  if (!maskData) return null;
  const segments = buildMarchingSquaresSegments(maskData.mask, maskData.width, maskData.height);
  if (segments.length === 0) return null;
  const loops = buildOrderedLoopsFromSegments(segments);
  const best = selectOuterLoop(loops);
  if (!best) return null;
  const outlineLength = computeLoopLength(best);
  if (outlineLength <= 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const strokeScaleBoost = normalized.thickness >= 12 ? 1.75 : normalized.thickness >= 6 ? 1.5 : 1.25;
  const renderScale = Math.min(2.5, dpr * strokeScaleBoost);
  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = contourMaskCanvas.width * renderScale;
  outlineCanvas.height = contourMaskCanvas.height * renderScale;
  const ctx = outlineCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, contourMaskCanvas.width, contourMaskCanvas.height);
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  }
  ctx.strokeStyle = normalized.color;
  ctx.globalAlpha = normalized.opacity / 100;
  ctx.lineWidth = normalized.thickness;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 10;
  if (normalized.style === 'dashed') {
    const dashPattern = normalizeDashPattern(outlineLength, normalized.thickness);
    if (dashPattern) {
      ctx.setLineDash([dashPattern.dash, dashPattern.gap]);
    } else {
      ctx.setLineDash([]);
    }
  } else {
    ctx.setLineDash([]);
  }
  const outlinePath = new Path2D();
  outlinePath.moveTo(best[0].x, best[0].y);
  for (let i = 1; i < best.length; i += 1) {
    outlinePath.lineTo(best[i].x, best[i].y);
  }
  outlinePath.closePath();
  ctx.stroke(outlinePath);
  return { canvas: outlineCanvas, padding, renderScale };
};

const applyImageStrokeOverlay = (fabricCanvas: fabric.Canvas) => {
  const images = fabricCanvas.getObjects().filter((obj) => obj.type === 'image') as fabric.Image[];
  images.forEach((image) => {
    const rawSettings = (image as any)._imageStrokeSettings;
    const normalized = normalizeImageStrokeSettings(rawSettings);
    const isUnderlayStroke = normalized.style === 'regular' || normalized.style === 'double-regular';
    if (
      normalized.style === 'none' ||
      (normalized.style !== 'double-regular' && (normalized.opacity <= 0 || normalized.thickness <= 0)) ||
      (normalized.style === 'double-regular' && normalized.innerLayer.opacity <= 0 && normalized.outerLayer.opacity <= 0)
    ) return;
    const result = buildStrokeOverlayCanvas(image, normalized);
    if (!result) return;
    const { canvas, padding, renderScale } = result;
    const center = image.getCenterPoint();
    const overlay = new fabric.Image(canvas, {
      left: center.x,
      top: center.y,
      scaleX: (image.scaleX || 1) / renderScale,
      scaleY: (image.scaleY || 1) / renderScale,
      angle: image.angle,
      originX: 'center',
      originY: 'center',
      flipX: image.flipX,
      flipY: image.flipY,
      skewX: image.skewX,
      skewY: image.skewY,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      excludeFromExport: false,
    });
    (image as any)._strokeOverlay = overlay;
    (image as any)._strokePadding = padding;
    (image as any)._strokeRenderScale = renderScale;
    const imageIndex = fabricCanvas.getObjects().indexOf(image);
    fabricCanvas.add(overlay);
    if (imageIndex >= 0) {
      fabricCanvas.moveTo(overlay, isUnderlayStroke ? imageIndex : imageIndex + 1);
    }
  });
};

/**
 * 从canvas_data生成高分辨率图片
 * @param canvasData 画布数据JSON字符串
 * @param backgroundType 背景类型
 * @param highResolution 是否生成高分辨率图片
 * @returns Promise<string> Base64格式的图片数据
 */
export async function renderCanvasToHighResImage(
  canvasData: string,
  backgroundType: 'white' | 'transparent' = 'white',
  _highResolution: boolean = true,
  canvasSize?: { width?: number; height?: number },
  options?: {
    maxWidth?: number;
    imageFormat?: 'png' | 'jpeg';
    quality?: number;
    useOriginalAssets?: boolean;
  }
): Promise<string> {
  let resolved: { canvasData: string };
  try {
    resolved = await deserializeCanvasData(canvasData);
  } catch (error) {
    console.warn('画布数据解码失败:', error);
    throw error;
  }
  return new Promise((resolve, reject) => {
    const resolvedWidth = Number(canvasSize?.width);
    const resolvedHeight = Number(canvasSize?.height);
    const displayWidth = Number.isFinite(resolvedWidth) && resolvedWidth > 0
      ? Math.round(resolvedWidth)
      : CANVAS_CONFIG.BASE_DISPLAY_WIDTH_PX;
    const displayHeight = Number.isFinite(resolvedHeight) && resolvedHeight > 0
      ? Math.round(resolvedHeight)
      : CANVAS_CONFIG.BASE_DISPLAY_HEIGHT_PX;
    const safeMaxWidth = typeof options?.maxWidth === 'number' && Number.isFinite(options.maxWidth) && options.maxWidth > 0
      ? options.maxWidth
      : displayWidth;
    const rawMultiplier = safeMaxWidth / displayWidth;
    const multiplier = Math.min(4, Math.max(0.1, Number.isFinite(rawMultiplier) ? rawMultiplier : 1));
    const imageFormat = options?.imageFormat === 'jpeg' ? 'jpeg' : 'png';
    const normalizedQuality = Math.max(0.1, Math.min(1, Number(options?.quality ?? 1) || 1));
    const preparedCanvasData = prepareCanvasDataForRender(
      resolved.canvasData,
      options?.useOriginalAssets === false ? 'editor' : 'export'
    );
    const resetViewportTransform = (fabricCanvas: fabric.Canvas) => {
      fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    };
    const syncLoadedImageObjectsForExport = (fabricCanvas: fabric.Canvas) => {
      fabricCanvas.getObjects().forEach((obj) => {
        if (obj.type !== 'image') return;
        const image = obj as fabric.Image;
        const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | null;
        if (!element) return;
        const naturalWidth = element instanceof HTMLImageElement
          ? element.naturalWidth || element.width
          : element.width;
        const naturalHeight = element instanceof HTMLImageElement
          ? element.naturalHeight || element.height
          : element.height;
        applyImageCropAndScaleFromRatios(image as unknown as Record<string, any>, {
          naturalWidth,
          naturalHeight,
          preserveDisplaySize: true,
          fallbackToFullImageWhenRatiosMissing: true,
        });
        image.setCoords();
      });
    };

    const cleanupCanvas = (fabricCanvas: fabric.Canvas | null) => {
      if (!fabricCanvas || typeof fabricCanvas.dispose !== 'function') return;
      try {
        const canvasElement = fabricCanvas.getElement();
        if (canvasElement) {
          const ctx = canvasElement.getContext('2d');
          ctx?.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }
      } catch (error) {
        console.warn('[CanvasRenderer] Canvas context clearRect failed:', error);
      }
      try {
        fabricCanvas.dispose();
      } catch (error) {
        console.warn('[CanvasRenderer] Canvas cleanup failed:', error);
      }
    };

    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = displayWidth;
      tempCanvas.height = displayHeight;

      const fabricCanvas = new fabric.Canvas(tempCanvas, {
        width: displayWidth,
        height: displayHeight,
        backgroundColor: '#ffffff',
        preserveObjectStacking: true,
      });
      resetViewportTransform(fabricCanvas);

      fabricCanvas.loadFromJSON(preparedCanvasData, () => {
        try {
          resetViewportTransform(fabricCanvas);
          syncLoadedImageObjectsForExport(fabricCanvas);
          applyImageStrokeOverlay(fabricCanvas);
          resetViewportTransform(fabricCanvas);
          const previousBackground = fabricCanvas.backgroundColor;
          const exportOptions: any = {
            format: imageFormat,
            quality: normalizedQuality,
            left: 0,
            top: 0,
            width: displayWidth,
            height: displayHeight,
            multiplier,
            withoutTransform: true,
            enableRetinaScaling: false,
          };
          if (backgroundType === 'white' || imageFormat === 'jpeg') {
            exportOptions.backgroundColor = '#ffffff';
          } else {
            fabricCanvas.setBackgroundColor('transparent', () => {
              fabricCanvas.renderAll();
            });
          }
          const dataUrl = fabricCanvas.toDataURL(exportOptions);
          fabricCanvas.setBackgroundColor(previousBackground || '', () => {
            fabricCanvas.renderAll();
          });
          cleanupCanvas(fabricCanvas);
          resolve(dataUrl);
        } catch (error) {
          console.warn('[CanvasRenderer] Canvas导出失败，可能是由于CORS污染:', error);
          try {
            const fallbackCanvas = document.createElement('canvas');
            fallbackCanvas.width = Math.max(1, Math.round(displayWidth * multiplier));
            fallbackCanvas.height = Math.max(1, Math.round(displayHeight * multiplier));
            const fallbackCtx = fallbackCanvas.getContext('2d');
            if (!fallbackCtx) {
              throw new Error('无法创建临时Canvas上下文');
            }
            if (backgroundType === 'white' || imageFormat === 'jpeg') {
              fallbackCtx.fillStyle = '#ffffff';
              fallbackCtx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
            }
            fallbackCtx.fillStyle = backgroundType === 'transparent' ? '#333333' : '#666666';
            fallbackCtx.font = '16px Arial';
            fallbackCtx.textAlign = 'center';
            fallbackCtx.fillText('设计预览', fallbackCanvas.width / 2, fallbackCanvas.height / 2 - 20);
            fallbackCtx.fillText('(包含外部图片，无法完整导出)', fallbackCanvas.width / 2, fallbackCanvas.height / 2 + 20);
            cleanupCanvas(fabricCanvas);
            if (imageFormat === 'jpeg') {
              resolve(fallbackCanvas.toDataURL('image/jpeg', normalizedQuality));
              return;
            }
            resolve(fallbackCanvas.toDataURL('image/png'));
          } catch (fallbackError) {
            console.error('[CanvasRenderer] 备用导出方案也失败:', fallbackError);
            const placeholderCanvas = document.createElement('canvas');
            placeholderCanvas.width = 400;
            placeholderCanvas.height = 300;
            const placeholderCtx = placeholderCanvas.getContext('2d');
            if (!placeholderCtx) {
              cleanupCanvas(fabricCanvas);
              reject(new Error('无法创建占位图'));
              return;
            }
            if (backgroundType === 'white' || imageFormat === 'jpeg') {
              placeholderCtx.fillStyle = '#f0f0f0';
              placeholderCtx.fillRect(0, 0, 400, 300);
            }
            placeholderCtx.fillStyle = backgroundType === 'transparent' ? '#333333' : '#999999';
            placeholderCtx.font = '14px Arial';
            placeholderCtx.textAlign = 'center';
            placeholderCtx.fillText('无法导出设计预览', 200, 150);
            cleanupCanvas(fabricCanvas);
            if (imageFormat === 'jpeg') {
              resolve(placeholderCanvas.toDataURL('image/jpeg', normalizedQuality));
              return;
            }
            resolve(placeholderCanvas.toDataURL('image/png'));
          }
        }
      });
    } catch (error) {
      console.error('Canvas渲染失败:', error);
      reject(error);
    }
  });
}

/**
 * 将dataURL转换为Blob
 * @param dataUrl Base64格式的图片数据
 * @returns Blob对象
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * 从Blob推断文件扩展名
 * @param blob Blob对象
 * @returns 文件扩展名
 */
export function getBlobExtension(blob: Blob): string {
  const mimeType = blob.type;
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}
