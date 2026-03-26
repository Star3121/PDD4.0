import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ordersAPI, designsAPI, templatesAPI, uploadAPI } from '../api';
import { Order, Design, Template, CustomFont } from '../api/index';
import CanvasEditor, { CanvasEditorRef, UploadToastItem } from '../components/CanvasEditor';
import CanvasTemplateLibrary from '../components/CanvasTemplateLibrary';
import { buildImageUrl, deserializeCanvasData, resolveCanvasAssetUrl } from '../lib/utils';
import LayerPanel from '../components/LayerPanel';
import TextEditorPanel from '../components/TextEditorPanel';

type ImageAdjustments = {
  temperature: number;
  tint: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
};

type ImageStrokeStyle = 'regular' | 'dashed' | 'solid' | 'double-regular' | 'none';

type ImageStrokeLayerSettings = {
  color: string;
  thickness: number;
  opacity: number;
};

type ImageStrokeSettings = {
  style: ImageStrokeStyle;
  color: string;
  thickness: number;
  opacity: number;
  innerLayer: ImageStrokeLayerSettings;
  outerLayer: ImageStrokeLayerSettings;
};

const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  temperature: 0,
  tint: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
};

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

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeImageAdjustments = (raw?: Partial<ImageAdjustments> | null): ImageAdjustments => {
  const source = raw || {};
  return {
    temperature: clampNumber(Number(source.temperature ?? 0), -100, 100),
    tint: clampNumber(Number(source.tint ?? 0), -180, 180),
    brightness: clampNumber(Number(source.brightness ?? 0), -100, 100),
    contrast: clampNumber(Number(source.contrast ?? 0), -100, 100),
    highlights: clampNumber(Number(source.highlights ?? 0), -100, 100),
    shadows: clampNumber(Number(source.shadows ?? 0), -100, 100),
    whites: clampNumber(Number(source.whites ?? 0), -100, 100),
    blacks: clampNumber(Number(source.blacks ?? 0), -100, 100),
  };
};

const isValidColorValue = (value: string) => {
  if (!value) return false;
  if (typeof CSS !== 'undefined' && typeof (CSS as any).supports === 'function') {
    return (CSS as any).supports('color', value);
  }
  return true;
};

const normalizeStrokeLayerSettings = (
  raw: Partial<ImageStrokeLayerSettings> | null | undefined,
  fallback: ImageStrokeLayerSettings
): ImageStrokeLayerSettings => {
  const source = raw || {};
  const color = typeof source.color === 'string' && isValidColorValue(source.color)
    ? source.color
    : fallback.color;
  return {
    color,
    thickness: clampNumber(Number(source.thickness ?? fallback.thickness), 1, 50),
    opacity: clampNumber(Number(source.opacity ?? fallback.opacity), 0, 100),
  };
};

const normalizeImageStrokeSettings = (raw?: Partial<ImageStrokeSettings> | null): ImageStrokeSettings => {
  const source = raw || {};
  const style = source.style || DEFAULT_IMAGE_STROKE_SETTINGS.style;
  const color = typeof source.color === 'string' && isValidColorValue(source.color)
    ? source.color
    : DEFAULT_IMAGE_STROKE_SETTINGS.color;
  const thickness = clampNumber(Number(source.thickness ?? DEFAULT_IMAGE_STROKE_SETTINGS.thickness), 1, 50);
  const opacity = clampNumber(Number(source.opacity ?? DEFAULT_IMAGE_STROKE_SETTINGS.opacity), 0, 100);
  const innerFallback: ImageStrokeLayerSettings = {
    color,
    thickness,
    opacity,
  };
  const outerFallback: ImageStrokeLayerSettings = { ...DEFAULT_IMAGE_STROKE_SETTINGS.outerLayer };
  return {
    style: style === 'regular' || style === 'dashed' || style === 'solid' || style === 'double-regular' || style === 'none'
      ? style
      : DEFAULT_IMAGE_STROKE_SETTINGS.style,
    color,
    thickness,
    opacity,
    innerLayer: normalizeStrokeLayerSettings(source.innerLayer, innerFallback),
    outerLayer: normalizeStrokeLayerSettings(source.outerLayer, outerFallback),
  };
};

const resolveHexColor = (value: string) => {
  if (!value) return '#000000';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#000000';
  ctx.fillStyle = '#000000';
  try {
    ctx.fillStyle = value;
  } catch {
    return '#000000';
  }
  const computed = ctx.fillStyle;
  if (computed.startsWith('#')) return computed;
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return '#000000';
  const [r, g, b] = match.slice(1, 4).map((val) => Math.max(0, Math.min(255, Number(val))));
  const toHex = (num: number) => num.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

type CanvasPage = {
  id: string;
  name: string;
  elements: string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  hidden?: boolean;
  locked?: boolean;
};

type CanvasDataPatchPayload = {
  updatedPages: CanvasPage[];
  deletedPageIds: string[];
  pageOrder: string[];
};

type FontOption = {
  id: number;
  name: string;
  value: string;
  url: string;
};

const collectFontFamiliesFromNode = (node: any, collector: Set<string>) => {
  if (!node || typeof node !== 'object') return;
  const fontFamily = typeof node.fontFamily === 'string' ? node.fontFamily.trim() : '';
  if (fontFamily) {
    collector.add(fontFamily);
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectFontFamiliesFromNode(item, collector));
    return;
  }
  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      collectFontFamiliesFromNode(value, collector);
    }
  });
};

const createPageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const DEFAULT_CANVAS_WIDTH = 3000;
const DEFAULT_CANVAS_HEIGHT = 4000;

const rewriteCanvasImageSources = (node: any): void => {
  if (!node || typeof node !== 'object') return;
  if (typeof node.src === 'string') {
    node.src = resolveCanvasAssetUrl(node.src);
  }
  if (Array.isArray(node)) {
    node.forEach((item) => rewriteCanvasImageSources(item));
    return;
  }
  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      rewriteCanvasImageSources(value);
    }
  });
};

const normalizeTemplateCanvasDataForLoad = async (rawTemplateCanvasData: string) => {
  const { canvasData } = await deserializeCanvasData(rawTemplateCanvasData);
  const parsed = JSON.parse(canvasData);
  rewriteCanvasImageSources(parsed);
  return JSON.stringify(parsed);
};

const toComparableCanvasPage = (page: CanvasPage) => {
  return JSON.stringify({
    id: page.id,
    name: page.name,
    elements: page.elements ?? '',
    width: page.width ?? DEFAULT_CANVAS_WIDTH,
    height: page.height ?? DEFAULT_CANVAS_HEIGHT,
    backgroundColor: page.backgroundColor ?? undefined,
    hidden: Boolean(page.hidden),
    locked: Boolean(page.locked),
  });
};

const parseCanvasPages = (rawCanvasData?: string | null): CanvasPage[] | null => {
  if (typeof rawCanvasData !== 'string' || !rawCanvasData.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawCanvasData);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item, index) => ({
      id: item?.id || `legacy-${index}`,
      name: item?.name || `页面 ${index + 1}`,
      elements: typeof item?.elements === 'string' ? item.elements : '',
      width: Number(item?.width) || DEFAULT_CANVAS_WIDTH,
      height: Number(item?.height) || DEFAULT_CANVAS_HEIGHT,
      backgroundColor: item?.backgroundColor,
      hidden: Boolean(item?.hidden),
      locked: Boolean(item?.locked),
    }));
  } catch {
    return null;
  }
};

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number, isFinal: boolean) => void;
  onReset: () => void;
};

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
}) => {
  const handleInputChange = (inputValue: string) => {
    if (inputValue.trim() === '') return;
    const parsed = Number(inputValue);
    if (Number.isNaN(parsed)) return;
    const clamped = clampNumber(parsed, min, max);
    onChange(clamped, false);
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label} ({value})</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={() => onChange(value, true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onChange(value, true);
            }}
            className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs"
          />
          <button
            type="button"
            onClick={onReset}
            className="px-2 py-0.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded"
          >
            重置
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onMouseUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        onTouchEnd={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        className="w-full"
      />
    </div>
  );
};

type ImageEditorPanelProps = {
  values: ImageAdjustments;
  onUpdate: (key: keyof ImageAdjustments, value: number, isFinal: boolean) => void;
  onResetValue: (key: keyof ImageAdjustments) => void;
  onResetAll: () => void;
  strokeSettings: ImageStrokeSettings;
  onStrokeUpdate: (key: string, value: string | number, isFinal: boolean) => void;
  onStrokeReset: () => void;
};

const COLOR_CONTROLS: Array<{ key: keyof ImageAdjustments; label: string; min: number; max: number; step?: number }> = [
  { key: 'temperature', label: '色温', min: -100, max: 100, step: 1 },
  { key: 'tint', label: '色调', min: -180, max: 180, step: 1 },
];

const LIGHT_CONTROLS: Array<{ key: keyof ImageAdjustments; label: string; min: number; max: number; step?: number }> = [
  { key: 'brightness', label: '亮度', min: -100, max: 100, step: 1 },
  { key: 'contrast', label: '对比度', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: '高光', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: '阴影', min: -100, max: 100, step: 1 },
  { key: 'whites', label: '白色', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: '黑色', min: -100, max: 100, step: 1 },
];

const ImageEditorPanel: React.FC<ImageEditorPanelProps> = ({
  values,
  onUpdate,
  onResetValue,
  onResetAll,
  strokeSettings,
  onStrokeUpdate,
  onStrokeReset,
}) => {
  const strokeHex = resolveHexColor(strokeSettings.color);
  const innerHex = resolveHexColor(strokeSettings.innerLayer.color);
  const outerHex = resolveHexColor(strokeSettings.outerLayer.color);
  const isDoubleRegular = strokeSettings.style === 'double-regular';
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 w-full max-w-xs">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">图片编辑</h3>
        <button
          type="button"
          onClick={onResetAll}
          className="px-2 py-1 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded"
        >
          重置全部
        </button>
      </div>

      <div className="mb-4 border-t pt-3">
        <h4 className="text-sm font-semibold mb-2">色彩调节</h4>
        {COLOR_CONTROLS.map((control) => (
          <SliderControl
            key={control.key}
            label={control.label}
            value={values[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={(value, isFinal) => onUpdate(control.key, value, isFinal)}
            onReset={() => onResetValue(control.key)}
          />
        ))}
      </div>

      <div className="border-t pt-3">
        <h4 className="text-sm font-semibold mb-2">光线调节</h4>
        {LIGHT_CONTROLS.map((control) => (
          <SliderControl
            key={control.key}
            label={control.label}
            value={values[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={(value, isFinal) => onUpdate(control.key, value, isFinal)}
            onReset={() => onResetValue(control.key)}
          />
        ))}
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">描边设置</h4>
          <button
            type="button"
            onClick={onStrokeReset}
            className="px-2 py-1 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded"
          >
            重置描边
          </button>
        </div>
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">描边样式</label>
          <select
            value={strokeSettings.style}
            onChange={(e) => onStrokeUpdate('style', e.target.value, true)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="none">无描边</option>
            <option value="regular">常规描边</option>
            <option value="double-regular">双层常规描边</option>
            <option value="dashed">虚线描边</option>
            <option value="solid">实线描边</option>
          </select>
        </div>
        {isDoubleRegular ? (
          <>
            <div className="mb-3">
              <h5 className="text-xs font-semibold text-gray-700 mb-2">第一层常规描边（内层）</h5>
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">颜色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={strokeSettings.innerLayer.color}
                    onChange={(e) => onStrokeUpdate('innerColor', e.target.value, false)}
                    onBlur={() => onStrokeUpdate('innerColor', strokeSettings.innerLayer.color, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onStrokeUpdate('innerColor', strokeSettings.innerLayer.color, true);
                    }}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                    placeholder="rgb()/hsl()/hex"
                  />
                  <input
                    type="color"
                    value={innerHex}
                    onChange={(e) => onStrokeUpdate('innerColor', e.target.value, true)}
                    className="h-8 w-10 cursor-pointer border border-gray-300 rounded"
                  />
                </div>
              </div>
              <SliderControl
                label="粗细"
                value={strokeSettings.innerLayer.thickness}
                min={1}
                max={50}
                step={0.5}
                onChange={(value, isFinal) => onStrokeUpdate('innerThickness', value, isFinal)}
                onReset={() => onStrokeUpdate('innerThickness', DEFAULT_IMAGE_STROKE_SETTINGS.innerLayer.thickness, true)}
              />
              <SliderControl
                label="透明度"
                value={strokeSettings.innerLayer.opacity}
                min={0}
                max={100}
                step={1}
                onChange={(value, isFinal) => onStrokeUpdate('innerOpacity', value, isFinal)}
                onReset={() => onStrokeUpdate('innerOpacity', DEFAULT_IMAGE_STROKE_SETTINGS.innerLayer.opacity, true)}
              />
            </div>
            <div className="mb-3 border-t pt-3">
              <h5 className="text-xs font-semibold text-gray-700 mb-2">第二层常规描边（外层）</h5>
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">颜色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={strokeSettings.outerLayer.color}
                    onChange={(e) => onStrokeUpdate('outerColor', e.target.value, false)}
                    onBlur={() => onStrokeUpdate('outerColor', strokeSettings.outerLayer.color, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onStrokeUpdate('outerColor', strokeSettings.outerLayer.color, true);
                    }}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                    placeholder="rgb()/hsl()/hex"
                  />
                  <input
                    type="color"
                    value={outerHex}
                    onChange={(e) => onStrokeUpdate('outerColor', e.target.value, true)}
                    className="h-8 w-10 cursor-pointer border border-gray-300 rounded"
                  />
                </div>
              </div>
              <SliderControl
                label="粗细"
                value={strokeSettings.outerLayer.thickness}
                min={1}
                max={50}
                step={0.5}
                onChange={(value, isFinal) => onStrokeUpdate('outerThickness', value, isFinal)}
                onReset={() => onStrokeUpdate('outerThickness', DEFAULT_IMAGE_STROKE_SETTINGS.outerLayer.thickness, true)}
              />
              <SliderControl
                label="透明度"
                value={strokeSettings.outerLayer.opacity}
                min={0}
                max={100}
                step={1}
                onChange={(value, isFinal) => onStrokeUpdate('outerOpacity', value, isFinal)}
                onReset={() => onStrokeUpdate('outerOpacity', DEFAULT_IMAGE_STROKE_SETTINGS.outerLayer.opacity, true)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">描边颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={strokeSettings.color}
                  onChange={(e) => onStrokeUpdate('color', e.target.value, false)}
                  onBlur={() => onStrokeUpdate('color', strokeSettings.color, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onStrokeUpdate('color', strokeSettings.color, true);
                  }}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                  placeholder="rgb()/hsl()/hex"
                />
                <input
                  type="color"
                  value={strokeHex}
                  onChange={(e) => onStrokeUpdate('color', e.target.value, true)}
                  className="h-8 w-10 cursor-pointer border border-gray-300 rounded"
                />
              </div>
            </div>
            <SliderControl
              label="描边粗细"
              value={strokeSettings.thickness}
              min={1}
              max={50}
              step={0.5}
              onChange={(value, isFinal) => onStrokeUpdate('thickness', value, isFinal)}
              onReset={() => onStrokeUpdate('thickness', DEFAULT_IMAGE_STROKE_SETTINGS.thickness, true)}
            />
            <SliderControl
              label="描边透明度"
              value={strokeSettings.opacity}
              min={0}
              max={100}
              step={1}
              onChange={(value, isFinal) => onStrokeUpdate('opacity', value, isFinal)}
              onReset={() => onStrokeUpdate('opacity', DEFAULT_IMAGE_STROKE_SETTINGS.opacity, true)}
            />
          </>
        )}
      </div>
    </div>
  );
};

const DesignEditor: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [currentDesign, setCurrentDesign] = useState<Design | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedObject, setSelectedObject] = useState<any>(null);
  const [selectedObjectCanvasId, setSelectedObjectCanvasId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'templates' | 'frames' | 'images' | 'text' | 'layers'>('templates');
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [objectCountByPage, setObjectCountByPage] = useState<Record<string, number>>({});
  const [backgroundType, setBackgroundType] = useState<'transparent' | 'white'>('transparent');
  const [pages, setPages] = useState<CanvasPage[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [canvasViewportHeight, setCanvasViewportHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 720;
    const height = window.innerHeight || 900;
    return Math.max(420, height - 220);
  });
  const [pageThumbnails, setPageThumbnails] = useState<Record<string, string>>({});
  const [pendingUploadsByPage, setPendingUploadsByPage] = useState<Record<string, number>>({});
  const [uploadToastsByPage, setUploadToastsByPage] = useState<Record<string, UploadToastItem[]>>({});
  const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
  const fontSourceRef = useRef<Map<string, string>>(new Map());
  const fontOptionsRef = useRef<Map<string, FontOption>>(new Map());
  const canvasRefs = useRef<Record<string, CanvasEditorRef | null>>({});
  const pageContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const loadedElementsRef = useRef<Record<string, string | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeCanvasRef = useRef<CanvasEditorRef | null>(null);
  const pagesRef = useRef<CanvasPage[]>([]);
  const thumbnailTimersRef = useRef<Record<string, number>>({});
  const thumbnailFramesRef = useRef<Record<string, number>>({});
  const fontLoadFailureRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateHeight = () => {
      const height = window.innerHeight || 900;
      setCanvasViewportHeight(Math.max(420, height - 220));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);
    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(thumbnailTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      Object.values(thumbnailFramesRef.current).forEach((frameId) => {
        window.cancelAnimationFrame(frameId);
      });
    };
  }, []);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    if (!activeCanvasId) {
      activeCanvasRef.current = null;
      return;
    }
    activeCanvasRef.current = canvasRefs.current[activeCanvasId] || null;
  }, [activeCanvasId, pages]);

  useEffect(() => {
    const validPageIds = new Set(pages.map((page) => page.id));
    setPendingUploadsByPage((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([pageId]) => validPageIds.has(pageId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setUploadToastsByPage((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([pageId]) => validPageIds.has(pageId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [pages]);

  const totalPendingUploads = Object.values(pendingUploadsByPage).reduce((total, count) => total + count, 0);
  const activeUploadToasts = activeCanvasId ? (uploadToastsByPage[activeCanvasId] || []) : [];

  const hasUnsyncedCanvasImages = () => {
    return pagesRef.current.some((page) => canvasRefs.current[page.id]?.hasUnsyncedImages());
  };

  const handlePendingUploadsChange = (pageId: string, count: number) => {
    setPendingUploadsByPage((prev) => {
      if (count <= 0) {
        if (!(pageId in prev)) return prev;
        const next = { ...prev };
        delete next[pageId];
        return next;
      }
      if (prev[pageId] === count) return prev;
      return { ...prev, [pageId]: count };
    });
  };

  const handleUploadToastsChange = (pageId: string, items: UploadToastItem[]) => {
    setUploadToastsByPage((prev) => {
      if (items.length === 0) {
        if (!(pageId in prev)) return prev;
        const next = { ...prev };
        delete next[pageId];
        return next;
      }
      return { ...prev, [pageId]: items };
    });
  };

  const collectPagesData = useCallback(() => {
    const pagesSnapshot = pagesRef.current;
    return pagesSnapshot.map((page) => {
      const canvas = canvasRefs.current[page.id];
      const elements = canvas?.getCanvasData() ?? page.elements ?? '';
      const width = page.width ?? DEFAULT_CANVAS_WIDTH;
      const height = page.height ?? DEFAULT_CANVAS_HEIGHT;
      return {
        ...page,
        elements,
        width,
        height,
      };
    });
  }, []);

  const onCanvasChange = (pageId: string) => {
    const canvas = canvasRefs.current[pageId];
    if (!canvas) return;
    const elements = canvas.getCanvasData();
    loadedElementsRef.current[pageId] = elements;
    setPages((prev) => prev.map((page) => page.id === pageId ? {
      ...page,
      elements
    } : page));
    scheduleThumbnail(pageId);
  };

  useEffect(() => {
    loadOrderData();
  }, [orderId]);

  const buildPagesFromDesign = useCallback((design: Design | null) => {
    const resolveDimension = (value: number | null | undefined, fallback: number) => {
      return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
    };
    const fallbackPage = (elements: string) => ({
      id: createPageId(),
      name: '页面 1',
      elements,
      width: resolveDimension(design?.width, DEFAULT_CANVAS_WIDTH),
      height: resolveDimension(design?.height, DEFAULT_CANVAS_HEIGHT),
      backgroundColor: undefined,
      hidden: false,
      locked: false
    });
    const rawData = design?.canvas_data;
    if (!rawData) {
      return [fallbackPage('')];
    }
    try {
      const parsed = JSON.parse(rawData);
      if (Array.isArray(parsed)) {
        const pagesFromData = parsed.map((item, index) => ({
          id: item?.id || createPageId(),
          name: item?.name || `页面 ${index + 1}`,
          elements: typeof item?.elements === 'string' ? item.elements : (typeof item?.canvas_data === 'string' ? item.canvas_data : ''),
          width: resolveDimension(item?.width, resolveDimension(design?.width, DEFAULT_CANVAS_WIDTH)),
          height: resolveDimension(item?.height, resolveDimension(design?.height, DEFAULT_CANVAS_HEIGHT)),
          backgroundColor: item?.backgroundColor,
          hidden: Boolean(item?.hidden),
          locked: Boolean(item?.locked)
        }));
        return pagesFromData.length > 0 ? pagesFromData : [fallbackPage('')];
      }
    } catch (error) {
      console.warn('解析画布数据失败，回退为单页模式', error);
    }
    return [fallbackPage(rawData)];
  }, []);

  useEffect(() => {
    const nextPages = buildPagesFromDesign(currentDesign);
    setPages(nextPages);
    loadedElementsRef.current = {};
    if (nextPages.length > 0) {
      setActiveCanvasId(nextPages[0].id);
    } else {
      setActiveCanvasId(null);
    }
  }, [currentDesign, buildPagesFromDesign]);

  const loadOrderData = async () => {
    try {
      const orderData = await ordersAPI.getById(Number(orderId));
      setOrder(orderData);
      const designsData = await designsAPI.getByOrderId(Number(orderId));
      if (designsData.length > 0) {
        setCurrentDesign(designsData[0]);
      }
    } catch (error) {
      console.error('加载订单数据失败:', error);
      alert('加载订单数据失败');
    } finally {
      setLoading(false);
    }
  };

  const getActiveCanvas = useCallback(() => {
    if (!activeCanvasId) return null;
    return canvasRefs.current[activeCanvasId] || null;
  }, [activeCanvasId]);

  const generateThumbnail = useCallback(async (pageId: string) => {
    const canvas = canvasRefs.current[pageId];
    if (!canvas) return;
    try {
      canvas.canvas?.renderAll();
      const dataUrl = await canvas.exportCanvas('white', false, 160);
      setPageThumbnails((prev) => ({ ...prev, [pageId]: dataUrl }));
    } catch (error) {
      console.warn('生成缩略图失败:', error);
    }
  }, []);

  const scheduleThumbnail = useCallback((pageId: string) => {
    if (typeof window === 'undefined') return;
    const timerId = thumbnailTimersRef.current[pageId];
    if (timerId) {
      window.clearTimeout(timerId);
    }
    const frameId = thumbnailFramesRef.current[pageId];
    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }
    thumbnailTimersRef.current[pageId] = window.setTimeout(() => {
      thumbnailFramesRef.current[pageId] = window.requestAnimationFrame(() => {
        void generateThumbnail(pageId);
        delete thumbnailFramesRef.current[pageId];
      });
    }, 300);
  }, [generateThumbnail]);

  const updatePageState = useCallback((pageId: string, patch: Partial<CanvasPage>) => {
    setPages((prev) => prev.map((page) => page.id === pageId ? { ...page, ...patch } : page));
  }, []);

  const handleTemplateSelect = async (template: Template) => {
    if (!activeCanvasId) return;
    const currentPage = pages.find((page) => page.id === activeCanvasId);
    if (currentPage?.locked) return;
    const canvas = getActiveCanvas();
    if (!canvas) return;
    templatesAPI.incrementUsage(template.id).catch(() => {});
    const hasTemplatePayload = (
      template.canvas_data !== undefined ||
      template.width !== undefined ||
      template.height !== undefined ||
      template.background_color !== undefined
    );
    const effectiveTemplate = hasTemplatePayload
      ? template
      : await templatesAPI.getById(template.id).catch(() => template);
    const resetTemplateSelectionState = () => {
      setSelectedObject(null);
      setSelectedObjectCanvasId(null);
      setSelectedTextValues(null);
      setSelectedImage(null);
      setImageAdjustments({ ...DEFAULT_IMAGE_ADJUSTMENTS });
      setImageStrokeSettings({ ...DEFAULT_IMAGE_STROKE_SETTINGS });
      setActivePanel('layers');
    };
    if (effectiveTemplate.canvas_data) {
      try {
        const normalizedCanvasData = await normalizeTemplateCanvasDataForLoad(effectiveTemplate.canvas_data);
        canvas.loadCanvasData(normalizedCanvasData);
        updatePageState(activeCanvasId, {
          elements: normalizedCanvasData,
          width: effectiveTemplate.width ?? currentPage?.width ?? DEFAULT_CANVAS_WIDTH,
          height: effectiveTemplate.height ?? currentPage?.height ?? DEFAULT_CANVAS_HEIGHT,
          backgroundColor: effectiveTemplate.background_color ?? undefined
        });
        loadedElementsRef.current[activeCanvasId] = normalizedCanvasData;
        resetTemplateSelectionState();
        return;
      } catch (error) {
        console.warn('模板画布数据加载失败，回退为图片方式:', error);
      }
    }
    const url = resolveCanvasAssetUrl(buildImageUrl(effectiveTemplate.image_path || template.image_path));
    canvas.addTemplateImage(url);
    resetTemplateSelectionState();
  };

  // 处理编辑模式变化
  const handleEditModeChange = (mode: string | null, target: any) => {
    console.log('编辑模式变化:', mode, target);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const currentPage = pages.find((page) => page.id === activeCanvasId);
    if (currentPage?.locked) {
      event.target.value = '';
      return;
    }

    const file = files[0];
    event.target.value = '';
    try {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      await canvas.insertImageFile(file, selectedObject && (selectedObject as any)._frameType ? selectedObject : null);
    } catch (error) {
      console.error('图片上传失败:', error);
      alert(error instanceof Error ? error.message : '图片上传失败');
    }
  };

  const handleSaveDesign = async () => {
    if (!order) return;
    const canvas = getActiveCanvas();
    if (!canvas) return;
    if (saving) return;
    if (totalPendingUploads > 0) {
      alert('还有图片正在上传，请等待上传完成后再保存');
      return;
    }
    if (hasUnsyncedCanvasImages()) {
      alert('存在未同步完成的图片，请重新上传失败图片后再保存');
      return;
    }

    setSaving(true);
    try {
      const pagesData = collectPagesData();
      const activePage = pagesData.find((page) => page.id === activeCanvasId) || pagesData[0];
      const width = activePage?.width;
      const height = activePage?.height;
      const previewDataUrl = await canvas.exportCanvas('white', true, 480, 'jpeg', 0.8);
      
      // 将data URL转换为blob的更可靠方法
      const dataUrlToBlob = (dataUrl: string): Blob => {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
      };

      const blob = dataUrlToBlob(previewDataUrl);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
      const file = new File([blob], `preview.${ext}`, { type: blob.type });

      const previousPages = parseCanvasPages(currentDesign?.canvas_data);
      let canvasDataForSave: string | undefined;
      let canvasDataMode: 'patch' | 'full' | undefined;
      if (!currentDesign || !previousPages) {
        canvasDataForSave = JSON.stringify(pagesData);
        canvasDataMode = 'full';
      } else {
        const previousMap = new Map(previousPages.map((page) => [page.id, toComparableCanvasPage(page)]));
        const updatedPages = pagesData.filter((page) => previousMap.get(page.id) !== toComparableCanvasPage(page));
        const currentIdSet = new Set(pagesData.map((page) => page.id));
        const deletedPageIds = previousPages.map((page) => page.id).filter((id) => !currentIdSet.has(id));
        const previousOrder = previousPages.map((page) => page.id);
        const currentOrder = pagesData.map((page) => page.id);
        const orderChanged = previousOrder.length !== currentOrder.length
          || previousOrder.some((id, index) => id !== currentOrder[index]);
        if (updatedPages.length > 0 || deletedPageIds.length > 0 || orderChanged) {
          const patchPayload: CanvasDataPatchPayload = {
            updatedPages,
            deletedPageIds,
            pageOrder: currentOrder
          };
          canvasDataForSave = JSON.stringify(patchPayload);
          canvasDataMode = 'patch';
        }
      }

      const baseDesignData = {
        order_id: order.id,
        name: currentDesign?.name || '主设计',
        width,
        height,
        background_type: backgroundType
      };

      if (currentDesign) {
        const updateData = {
          ...baseDesignData,
          ...(canvasDataForSave ? { canvas_data: canvasDataForSave } : {}),
          ...(canvasDataMode ? { canvas_data_mode: canvasDataMode } : {})
        };
        const updated = await designsAPI.update(currentDesign.id, updateData);
        const mergedDesign: Design = {
          ...currentDesign,
          ...updated,
          name: updateData.name || currentDesign.name,
          width: updateData.width || currentDesign.width,
          height: updateData.height || currentDesign.height,
          background_type: updateData.background_type || currentDesign.background_type,
          canvas_data: JSON.stringify(pagesData)
        };
        setCurrentDesign(mergedDesign);
        try {
          const previewUpdated = await designsAPI.updateWithPreview(currentDesign.id, {
            name: updateData.name,
            width: updateData.width,
            height: updateData.height,
            background_type: updateData.background_type
          }, file);
          setCurrentDesign((prev) => {
            if (!prev || prev.id !== currentDesign.id) return prev;
            return { ...prev, ...previewUpdated, canvas_data: prev.canvas_data };
          });
        } catch (previewError) {
          console.warn('预览图上传失败，设计内容已保存:', previewError);
        }
        alert(`设计保存成功！(${backgroundType === 'transparent' ? '透明背景' : '白色背景'})`);
      } else {
        const createData = {
          ...baseDesignData,
          canvas_data: canvasDataForSave || JSON.stringify(pagesData),
          canvas_data_mode: canvasDataMode || 'full'
        };
        const newDesign = await designsAPI.create(createData);
        const mergedNewDesign: Design = {
          ...newDesign,
          canvas_data: createData.canvas_data,
          order_id: createData.order_id,
          name: createData.name,
          width: createData.width || DEFAULT_CANVAS_WIDTH,
          height: createData.height || DEFAULT_CANVAS_HEIGHT,
          background_type: createData.background_type || 'white',
          created_at: newDesign.created_at || new Date().toISOString()
        };
        setCurrentDesign(mergedNewDesign);
        try {
          const previewUpdated = await designsAPI.updateWithPreview(newDesign.id, {
            name: createData.name,
            width: createData.width,
            height: createData.height,
            background_type: createData.background_type
          }, file);
          setCurrentDesign((prev) => {
            if (!prev || prev.id !== newDesign.id) return prev;
            return { ...prev, ...previewUpdated, canvas_data: prev.canvas_data };
          });
        } catch (previewError) {
          console.warn('创建后补传预览失败，已保留设计数据保存结果:', previewError);
        }
        alert(`设计创建成功！(${backgroundType === 'transparent' ? '透明背景' : '白色背景'})`);
      }

      // 自动将订单标记更新为"待确认"
      if (order.mark !== 'pending_confirm') {
        try {
          const updatedOrder = await ordersAPI.update(order.id, {
            ...order,
            mark: 'pending_confirm'
          });
          setOrder(updatedOrder);
        } catch (error) {
          console.error('更新订单标记失败:', error);
          // 不影响设计保存的成功提示，只在控制台记录错误
        }
      }

      // 保存成功后自动跳转回订单列表主页
      setTimeout(() => {
        navigate('/');
      }, 1500); // 延迟1.5秒让用户看到成功提示
    } catch (error) {
      console.error('保存设计失败:', error);
      console.error('错误详情:', error);
      alert(`保存设计失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExportOrder = async () => {
    if (!order) return;
    try {
      uploadAPI.exportOrder(order.id);
    } catch (error) {
      console.error('导出订单失败:', error);
      alert('导出订单失败');
    }
  };

  const handleDownloadImage = async (backgroundType: 'white' | 'transparent') => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    
    try {
      // 导出高分辨率原画质图片
      const dataUrl = await canvas.exportCanvas(backgroundType, true);
      
      // 创建下载链接
      const link = document.createElement('a');
      link.download = `design-${backgroundType}-${Date.now()}.png`;
      link.href = dataUrl;
      
      // 触发下载
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log(`下载${backgroundType === 'transparent' ? '透明背景' : '白色背景'}图片成功`);
    } catch (error) {
      console.error('下载图片失败:', error);
      alert('下载图片失败');
    }
  };

  const [selectedTextValues, setSelectedTextValues] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustments>(DEFAULT_IMAGE_ADJUSTMENTS);
  const [imageStrokeSettings, setImageStrokeSettings] = useState<ImageStrokeSettings>(DEFAULT_IMAGE_STROKE_SETTINGS);
  const [formatBrushActive, setFormatBrushActive] = useState(false);
  const [formatBrushType, setFormatBrushType] = useState<'text' | 'image' | 'frame-image' | null>(null);

  const registerFontFace = useCallback(async (fontFamily: string, url: string) => {
    const family = (fontFamily || '').trim();
    if (!family || !url) return false;
    const fontKey = `${family}::${url}`;
    if (fontLoadFailureRef.current.has(fontKey)) return false;
    const previousUrl = fontSourceRef.current.get(family);
    const isReady = document.fonts.check(`12px "${family}"`);
    if (previousUrl === url && isReady) return true;
    const sourceUrl = encodeURI(url);
    try {
      const fontFace = new FontFace(family, `url("${sourceUrl}") format('woff2')`);
      const loaded = await fontFace.load();
      (document.fonts as any).add(loaded);
      fontSourceRef.current.set(family, url);
      await document.fonts.load(`12px "${family}"`);
      return true;
    } catch (error) {
      fontLoadFailureRef.current.add(fontKey);
      console.warn(`字体加载失败: ${family}`, error);
      return false;
    }
  }, []);

  const mapFontOption = useCallback((item: CustomFont): FontOption => {
    const family = (item.font_family || item.display_name || '').trim();
    return {
      id: item.id,
      name: (item.display_name || family).trim(),
      value: family,
      url: buildImageUrl(item.file_url),
    };
  }, []);

  const ensureCustomFontLoaded = useCallback(async (fontFamily: string) => {
    const family = String(fontFamily || '').trim();
    if (!family) return false;
    const option = fontOptionsRef.current.get(family);
    if (!option) return true;
    return registerFontFace(option.value, option.url);
  }, [registerFontFace]);

  const loadUsedCustomFontsFromPages = useCallback(async (targetPages: CanvasPage[]) => {
    const families = new Set<string>();
    for (const page of targetPages) {
      const rawElements = typeof page?.elements === 'string' ? page.elements : '';
      if (!rawElements) continue;
      try {
        const { canvasData } = await deserializeCanvasData(rawElements);
        const parsed = JSON.parse(canvasData);
        collectFontFamiliesFromNode(parsed, families);
      } catch {
        continue;
      }
    }
    if (families.size === 0) return;
    const results = await Promise.all(Array.from(families).map((family) => ensureCustomFontLoaded(family)));
    if (results.some(Boolean)) {
      Object.values(canvasRefs.current).forEach((canvas) => {
        canvas?.canvas?.requestRenderAll();
      });
    }
  }, [ensureCustomFontLoaded]);

  const loadCustomFonts = useCallback(async () => {
    try {
      const fonts = await uploadAPI.getFonts();
      const options = fonts.map(mapFontOption);
      const optionMap = new Map<string, FontOption>();
      options.forEach((option) => {
        optionMap.set(option.value, option);
      });
      fontOptionsRef.current = optionMap;
      setCustomFonts(options);
    } catch (error) {
      console.error('获取字体列表失败:', error);
    }
  }, [mapFontOption]);

  useEffect(() => {
    void loadCustomFonts();
  }, [loadCustomFonts]);

  useEffect(() => {
    if (customFonts.length === 0 || pages.length === 0) return;
    void loadUsedCustomFontsFromPages(pages);
  }, [customFonts, pages, loadUsedCustomFontsFromPages]);

  const resolveImageForEdit = (canvasId: string | null, object: any) => {
    if (!object || !canvasId) return null;
    const canvas = canvasRefs.current[canvasId]?.canvas;
    if (!canvas) return null;
    if (object.type === 'image') return object;
    if ((object as any)._isFrame || (object as any)._frameType) {
      const frameId = (object as any).__uid ?? (object as any).id;
      const match = canvas.getObjects().find((obj) => {
        if (obj.type !== 'image') return false;
        const imageFrameId = (obj as any)._frameId ?? (obj as any).frameId;
        return imageFrameId && imageFrameId === frameId;
      });
      return match || null;
    }
    return null;
  };

  const handleSelectionChange = useCallback((pageId: string, object: any) => {
    console.log('[DesignEditor] Selection Changed:', object ? object.type : 'null');
    setActiveCanvasId(pageId);
    setSelectedObjectCanvasId(pageId);
    setSelectedObject(object);

    if (object && (object.type === 'i-text' || object.type === 'text' || object.type === 'textbox')) {
      setSelectedTextValues({
        text: object.text || '',
        fontFamily: object.fontFamily || 'Arial',
        fontSize: object.fontSize || 40,
        fill: (object.fill as string) || '#000000',
        letterSpacing: object.charSpacing || 0,
        curve: (object as any).curve || 0,
        stroke: object.stroke || null,
        strokeWidth: object.strokeWidth || 0
      });
    } else {
      setSelectedTextValues(null);
    }

    const imageToEdit = resolveImageForEdit(pageId, object);
    if (object && (object.type === 'i-text' || object.type === 'text' || object.type === 'textbox')) {
      setActivePanel('text');
      setIsDrawerOpen(true);
    } else if (imageToEdit) {
      setActivePanel('images');
      setIsDrawerOpen(true);
    }
    if (imageToEdit) {
      const nextAdjustments = normalizeImageAdjustments((imageToEdit as any)._imageAdjustments);
      const nextStrokeSettings = normalizeImageStrokeSettings((imageToEdit as any)._imageStrokeSettings);
      setSelectedImage(imageToEdit);
      setImageAdjustments(nextAdjustments);
      setImageStrokeSettings(nextStrokeSettings);
    } else {
      setSelectedImage(null);
      setImageAdjustments({ ...DEFAULT_IMAGE_ADJUSTMENTS });
      setImageStrokeSettings({ ...DEFAULT_IMAGE_STROKE_SETTINGS });
    }
  }, []);

  const handleObjectCountChange = useCallback((pageId: string, count: number) => {
    setObjectCountByPage((prev) => ({ ...prev, [pageId]: count }));
  }, []);

  const handleFormatBrushToggle = useCallback(() => {
    const locked = pages.find((page) => page.id === activeCanvasId)?.locked;
    if (locked) return;
    const canvas = getActiveCanvas();
    if (!canvas) return;
    if (formatBrushActive) {
      canvas.cancelFormatBrush();
      return;
    }
    if (!selectedObject) return;
    canvas.activateFormatBrush(selectedObject);
  }, [formatBrushActive, selectedObject, getActiveCanvas, pages, activeCanvasId]);

  const handleTextUpdate = async (values: any, isFinal: boolean = true) => {
    const canvas = getActiveCanvas();
    if (!selectedObject || !canvas) return;
    const nextValues = { ...values };
    if (nextValues.fontFamily) {
      await ensureCustomFontLoaded(nextValues.fontFamily);
    }
    // Convert letterSpacing to charSpacing
    if (nextValues.letterSpacing !== undefined) {
        nextValues.charSpacing = nextValues.letterSpacing;
        delete nextValues.letterSpacing;
    }

    // Skip history if not final (e.g. during slider drag)
    canvas.updateText(selectedObject, nextValues, !isFinal);
  };

  const handleImageAdjustmentUpdate = useCallback((key: keyof ImageAdjustments, value: number, isFinal: boolean = true) => {
    const canvas = getActiveCanvas();
    if (!selectedImage || !canvas) return;
    setImageAdjustments((prev) => {
      const next = { ...prev, [key]: value };
      canvas.updateImageAdjustments(selectedImage, next, !isFinal);
      return next;
    });
  }, [selectedImage, getActiveCanvas]);

  const handleImageResetValue = useCallback((key: keyof ImageAdjustments) => {
    handleImageAdjustmentUpdate(key, DEFAULT_IMAGE_ADJUSTMENTS[key], true);
  }, [handleImageAdjustmentUpdate]);

  const handleImageResetAll = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!selectedImage || !canvas) return;
    const next = { ...DEFAULT_IMAGE_ADJUSTMENTS };
    setImageAdjustments(next);
    canvas.updateImageAdjustments(selectedImage, next, false);
    const strokeNext = { ...DEFAULT_IMAGE_STROKE_SETTINGS };
    setImageStrokeSettings(strokeNext);
    canvas.updateImageStroke(selectedImage, strokeNext, false);
  }, [selectedImage, getActiveCanvas]);

  const handleImageStrokeUpdate = useCallback((key: string, value: string | number, isFinal: boolean = true) => {
    const canvas = getActiveCanvas();
    if (!selectedImage || !canvas) return;
    setImageStrokeSettings((prev) => {
      let next: ImageStrokeSettings = prev;
      if (key === 'innerColor') {
        next = { ...prev, innerLayer: { ...prev.innerLayer, color: String(value) } };
      } else if (key === 'innerThickness') {
        next = { ...prev, innerLayer: { ...prev.innerLayer, thickness: Number(value) } };
      } else if (key === 'innerOpacity') {
        next = { ...prev, innerLayer: { ...prev.innerLayer, opacity: Number(value) } };
      } else if (key === 'outerColor') {
        next = { ...prev, outerLayer: { ...prev.outerLayer, color: String(value) } };
      } else if (key === 'outerThickness') {
        next = { ...prev, outerLayer: { ...prev.outerLayer, thickness: Number(value) } };
      } else if (key === 'outerOpacity') {
        next = { ...prev, outerLayer: { ...prev.outerLayer, opacity: Number(value) } };
      } else if (key === 'style' && value === 'double-regular') {
        next = {
          ...prev,
          style: 'double-regular',
          innerLayer: normalizeStrokeLayerSettings(prev.innerLayer, {
            color: prev.color,
            thickness: prev.thickness,
            opacity: prev.opacity,
          }),
          outerLayer: normalizeStrokeLayerSettings(prev.outerLayer, DEFAULT_IMAGE_STROKE_SETTINGS.outerLayer),
        };
      } else {
        next = { ...prev, [key]: value } as ImageStrokeSettings;
      }
      const normalized = normalizeImageStrokeSettings(next);
      canvas.updateImageStroke(selectedImage, normalized, !isFinal);
      return normalized;
    });
  }, [selectedImage, getActiveCanvas]);

  const handleImageStrokeReset = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!selectedImage || !canvas) return;
    const next = { ...DEFAULT_IMAGE_STROKE_SETTINGS };
    setImageStrokeSettings(next);
    canvas.updateImageStroke(selectedImage, next, false);
  }, [selectedImage, getActiveCanvas]);

  const handleFontUpload = async (file: File) => {
    try {
      const result = await uploadAPI.uploadFont(file);
      const option = mapFontOption(result.font);
      await registerFontFace(option.value, option.url);
      fontOptionsRef.current.set(option.value, option);
      setCustomFonts((prev) => {
        const next = prev.filter((item) => item.value !== option.value);
        return [option, ...next];
      });
      if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'text' || selectedObject.type === 'textbox')) {
        handleTextUpdate({ fontFamily: option.value });
        setSelectedTextValues((prev: any) => prev ? { ...prev, fontFamily: option.value } : prev);
        getActiveCanvas()?.canvas?.requestRenderAll();
      }
    } catch (error) {
      console.error('字体上传失败:', error);
      alert(error instanceof Error ? error.message : '字体上传失败');
    }
  };

  const getTextProperties = () => {
    if (!selectedObject || (selectedObject.type !== 'i-text' && selectedObject.type !== 'text' && selectedObject.type !== 'textbox')) return undefined;
    return {
      text: selectedObject.text || '',
      fontFamily: selectedObject.fontFamily || 'Arial',
      fontSize: selectedObject.fontSize || 40,
      fill: (selectedObject.fill as string) || '#000000',
      letterSpacing: selectedObject.charSpacing || 0,
      curve: (selectedObject as any).curve || 0,
      stroke: selectedObject.stroke || null,
      strokeWidth: selectedObject.strokeWidth || 0
    };
  };

  useEffect(() => {
    if (!activeCanvasId) return;
    if (activeCanvasId !== selectedObjectCanvasId) {
      setSelectedObject(null);
      setSelectedObjectCanvasId(null);
      setSelectedTextValues(null);
      setSelectedImage(null);
      setImageAdjustments({ ...DEFAULT_IMAGE_ADJUSTMENTS });
      setImageStrokeSettings({ ...DEFAULT_IMAGE_STROKE_SETTINGS });
      setFormatBrushActive(false);
      setFormatBrushType(null);
    }
  }, [activeCanvasId, selectedObjectCanvasId]);

  useEffect(() => {
    pages.forEach((page) => {
      const canvas = canvasRefs.current[page.id];
      if (!canvas) return;
      const cached = loadedElementsRef.current[page.id];
      if (page.elements && cached !== page.elements) {
        canvas.loadCanvasData(page.elements);
        loadedElementsRef.current[page.id] = page.elements;
      }
    });
  }, [pages]);

  useEffect(() => {
    pages.forEach((page) => {
      if (pageThumbnails[page.id]) return;
      scheduleThumbnail(page.id);
    });
  }, [pages, pageThumbnails, scheduleThumbnail]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const candidates: Array<{ id: string; ratio: number }> = [];
      entries.forEach((entry) => {
        const target = entry.target as HTMLElement;
        const pageId = target.dataset.pageId;
        if (!pageId) return;
        candidates.push({ id: pageId, ratio: entry.intersectionRatio });
      });
      const visible = candidates.filter((item) => item.ratio >= 0.5);
      if (visible.length === 0) return;
      const best = visible.sort((a, b) => b.ratio - a.ratio)[0];
      if (best && best.id !== activeCanvasId) {
        setActiveCanvasId(best.id);
      }
    }, { root: container, threshold: [0.5, 0.75, 1] });

    pages.forEach((page) => {
      const element = pageContainerRefs.current[page.id];
      if (element) {
        element.dataset.pageId = page.id;
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [pages, activeCanvasId]);

  const scrollToPage = useCallback((pageId: string) => {
    const element = pageContainerRefs.current[pageId];
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const renumberPages = (list: CanvasPage[]) => list.map((page, index) => ({
    ...page,
    name: `页面 ${index + 1}`
  }));

  const movePage = (pageId: string, direction: 'up' | 'down') => {
    setPages((prev) => {
      const index = prev.findIndex((page) => page.id === pageId);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return renumberPages(next);
    });
  };

  const togglePageHidden = (pageId: string) => {
    updatePageState(pageId, { hidden: !pages.find((page) => page.id === pageId)?.hidden });
  };

  const togglePageLocked = (pageId: string) => {
    const isLocked = pages.find((page) => page.id === pageId)?.locked;
    updatePageState(pageId, { locked: !isLocked });
    if (!isLocked && pageId === activeCanvasId) {
      setSelectedObject(null);
      setSelectedObjectCanvasId(null);
      setSelectedTextValues(null);
      setSelectedImage(null);
      setImageAdjustments({ ...DEFAULT_IMAGE_ADJUSTMENTS });
      setImageStrokeSettings({ ...DEFAULT_IMAGE_STROKE_SETTINGS });
    }
  };

  const clonePage = (pageId: string) => {
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    if (pageIndex === -1) return;
    const canvas = canvasRefs.current[pageId];
    const elements = canvas?.getCanvasData() ?? pages[pageIndex].elements;
    const newPageId = createPageId();
    const clonedPage: CanvasPage = {
      ...pages[pageIndex],
      id: newPageId,
      elements,
      hidden: false,
      locked: false
    };
    setPages((prev) => {
      const next = [...prev];
      next.splice(pageIndex + 1, 0, clonedPage);
      return renumberPages(next);
    });
    setActiveCanvasId(newPageId);
    setTimeout(() => scrollToPage(newPageId), 60);
    setTimeout(() => scheduleThumbnail(newPageId), 400);
  };

  const addPage = () => {
    const lastPage = pages[pages.length - 1];
    const newPageId = createPageId();
    const newPage: CanvasPage = {
      id: newPageId,
      name: `页面 ${pages.length + 1}`,
      elements: '',
      width: lastPage?.width ?? DEFAULT_CANVAS_WIDTH,
      height: lastPage?.height ?? DEFAULT_CANVAS_HEIGHT,
      backgroundColor: lastPage?.backgroundColor,
      hidden: false,
      locked: false
    };
    setPages((prev) => renumberPages([...prev, newPage]));
    setActiveCanvasId(newPageId);
    setTimeout(() => scrollToPage(newPageId), 60);
    setTimeout(() => scheduleThumbnail(newPageId), 400);
  };

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) {
      alert('至少保留一个画布页面');
      return;
    }
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    if (pageIndex === -1) return;
    const confirmed = window.confirm('确定要删除该页面吗？此操作不可撤销。');
    if (!confirmed) return;
    setPageThumbnails((prev) => {
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    const nextPages = pages.filter((page) => page.id !== pageId);
    const nextActive = nextPages[Math.max(0, pageIndex - 1)]?.id || nextPages[0]?.id || null;
    setPages(renumberPages(nextPages));
    setActiveCanvasId(nextActive);
    if (nextActive) {
      setTimeout(() => scrollToPage(nextActive), 60);
    }
  };

  const activePageIndex = activeCanvasId ? pages.findIndex((page) => page.id === activeCanvasId) : -1;
  const activePage = activeCanvasId ? pages.find((page) => page.id === activeCanvasId) : null;
  const activeObjectCount = activeCanvasId ? objectCountByPage[activeCanvasId] ?? 0 : 0;
  const isActivePageLocked = Boolean(activePage?.locked);

  const handleClearActiveCanvas = () => {
    if (!activeCanvasId || isActivePageLocked) return;
    if (!window.confirm('确定要清空画布吗？此操作不可撤销。')) return;
    const canvas = getActiveCanvas();
    if (!canvas) return;
    canvas.clearCanvas();
    loadedElementsRef.current[activeCanvasId] = '';
    updatePageState(activeCanvasId, { elements: '' });
  };

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (!order) {
    return <div className="text-center py-8 text-red-500">订单不存在</div>;
  }

  const panelTitles = {
    templates: '模板',
    frames: '相框',
    images: '图片',
    text: '文字',
    layers: '图层'
  };

  const navItems: Array<{ key: 'templates' | 'frames' | 'images' | 'text' | 'layers'; label: string; icon: React.ReactNode }> = [
    {
      key: 'templates',
      label: '模板',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 5a2 2 0 0 1 2-2h5v6H4V5zM13 3h5a2 2 0 0 1 2 2v4h-7V3zM4 11h7v10H6a2 2 0 0 1-2-2V11zM13 11h7v8a2 2 0 0 1-2 2h-5V11z" />
        </svg>
      )
    },
    {
      key: 'frames',
      label: '相框',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7zm0-2h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" />
        </svg>
      )
    },
    {
      key: 'images',
      label: '图片',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm4 3a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 9-4-5-3 4-2-2-3 3v1h12v-1z" />
        </svg>
      )
    },
    {
      key: 'text',
      label: '文字',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 5h16v3h-2V7h-4v10h2v2H8v-2h2V7H6v1H4V5z" />
        </svg>
      )
    },
    {
      key: 'layers',
      label: '图层',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3 3 8l9 5 9-5-9-5zm0 8L3 6v4l9 5 9-5V6l-9 5zm0 6-9-5v4l9 5 9-5v-4l-9 5z" />
        </svg>
      )
    }
  ];

  return (
    <div className="h-screen w-full flex flex-col bg-[#F0F2F5]">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="h-9 w-9 rounded-md border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"
            aria-label="返回"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-gray-800">订单 {order.order_number}</span>
            <span className="ml-2">客户：{order.customer_name}</span>
            <span className="ml-2">规格：{order.product_specs}</span>
            <span className="ml-2">电话：{order.phone}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearActiveCanvas}
            disabled={!activeCanvasId || isActivePageLocked}
            className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            清空画布
          </button>
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1">
            <span className="text-xs text-gray-500">保存背景</span>
            <button
              onClick={() => {
                setBackgroundType('white');
                handleDownloadImage('white');
              }}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
            >
              白底下载
            </button>
            <button
              onClick={() => {
                setBackgroundType('transparent');
                handleDownloadImage('transparent');
              }}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
            >
              透明下载
            </button>
          </div>
          <button
            onClick={handleExportOrder}
            className="px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md"
          >
            导出订单
          </button>
          <div className="relative">
            <button
              onClick={handleSaveDesign}
              disabled={saving || totalPendingUploads > 0}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {saving ? '保存中...' : totalPendingUploads > 0 ? '图片上传中...' : '保存设计'}
            </button>
            {activeUploadToasts.length > 0 && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 space-y-2">
                {activeUploadToasts.map((item) => {
                  const isFailed = item.status === 'failed';
                  const isSuccess = item.status === 'success';
                  const isQueued = item.status === 'queued';
                  const isRetrying = item.status === 'retrying';
                  const barColor = isFailed
                    ? 'bg-red-500'
                    : isSuccess
                      ? 'bg-emerald-500'
                      : isRetrying
                        ? 'bg-amber-500'
                      : isQueued
                        ? 'bg-gray-300'
                        : 'bg-blue-500';
                  const statusText = item.status === 'queued'
                    ? '排队中'
                    : item.status === 'uploading'
                      ? '上传中'
                      : item.status === 'processing'
                        ? '处理中'
                        : item.status === 'retrying'
                          ? '重试中'
                        : item.status === 'success'
                          ? '已完成'
                          : '失败';
                  const statusClass = isFailed
                    ? 'text-red-600'
                    : isSuccess
                      ? 'text-emerald-600'
                      : isRetrying
                        ? 'text-amber-600'
                      : isQueued
                        ? 'text-gray-500'
                        : 'text-blue-600';
                  return (
                    <div key={item.id} className={`rounded-md border bg-white/95 px-3 py-2 shadow ${isFailed ? 'border-red-200' : isSuccess ? 'border-emerald-200' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-xs font-medium text-gray-700">{item.name}</div>
                        <div className={`text-xs font-medium ${statusClass}`}>{statusText}</div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">{item.error || item.message}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-[72px] bg-slate-900 text-white flex flex-col items-center py-3 gap-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setActivePanel(item.key);
                setIsDrawerOpen(true);
              }}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl text-xs gap-1 ${activePanel === item.key && isDrawerOpen ? 'bg-slate-700' : 'hover:bg-slate-800'} transition`}
            >
              {item.icon}
              <span className="text-[10px]">{item.label}</span>
            </button>
          ))}
        </nav>

        <aside
          className={`h-full bg-white overflow-hidden transition-all duration-300 ease-in-out ${isDrawerOpen ? 'w-[300px] border-r border-gray-200' : 'w-0 border-r border-transparent opacity-0 pointer-events-none'}`}
        >
          <div className={`h-full flex flex-col transition-transform duration-300 ${isDrawerOpen ? 'translate-x-0' : '-translate-x-4'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-800">{panelTitles[activePanel]}</span>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                收起
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activePanel === 'templates' && (
                <CanvasTemplateLibrary onTemplateSelect={handleTemplateSelect} />
              )}

              {activePanel === 'frames' && (
                <div className="space-y-3">
                  <button
                    onClick={() => getActiveCanvas()?.addCircleFrame(226, 260, 85)}
                    disabled={!activeCanvasId || isActivePageLocked}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
                  >
                    添加圆形相框
                  </button>
                  <button
                    onClick={() => getActiveCanvas()?.addSquareFrame(226, 260, 170, 170)}
                    disabled={!activeCanvasId || isActivePageLocked}
                    className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
                  >
                    添加方形相框
                  </button>
                  <p className="text-xs text-gray-500">
                    双击空相框上传照片，双击已有照片调整位置
                  </p>
                </div>
              )}

              {activePanel === 'images' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">图片上传</h3>
                    <label className={`block w-full cursor-pointer bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg p-4 text-center transition-colors ${isActivePageLocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-100'}`}>
                      <span className="text-blue-600 font-medium">点击上传图片</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={isActivePageLocked}
                      />
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                      图片将直接添加到画布或当前选中的相框内
                    </p>
                  </div>
                  {selectedImage && (
                    <ImageEditorPanel
                      values={imageAdjustments}
                      onUpdate={handleImageAdjustmentUpdate}
                      onResetValue={handleImageResetValue}
                      onResetAll={handleImageResetAll}
                      strokeSettings={imageStrokeSettings}
                      onStrokeUpdate={handleImageStrokeUpdate}
                      onStrokeReset={handleImageStrokeReset}
                    />
                  )}
                </div>
              )}

              {activePanel === 'text' && (
                <div className="space-y-4">
                  <button
                    onClick={() => getActiveCanvas()?.addText('双击编辑文字')}
                    disabled={!activeCanvasId || isActivePageLocked}
                    className="w-full px-3 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
                  >
                    添加文字
                  </button>
                  {selectedTextValues && (
                    <TextEditorPanel
                      initialValues={selectedTextValues}
                      onUpdate={handleTextUpdate}
                      onUploadFont={(file) => handleFontUpload(file)}
                      customFonts={customFonts}
                    />
                  )}
                </div>
              )}

              {activePanel === 'layers' && (
                <div className="space-y-4">
                  {(selectedObject && (
                    selectedObject.type === 'image'
                    || selectedObject.type === 'i-text'
                    || selectedObject.type === 'text'
                    || selectedObject.type === 'textbox'
                    || (selectedObject as any)._isFrame
                    || (selectedObject as any)._frameType
                  )) && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-gray-800">格式刷</div>
                      <button
                        onClick={handleFormatBrushToggle}
                        disabled={isActivePageLocked}
                        className={`px-2 py-1 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed ${formatBrushActive ? 'bg-amber-100 text-amber-800' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                      >
                        {formatBrushActive ? '取消格式刷' : '使用格式刷'}
                      </button>
                      {formatBrushActive && (
                        <div className="text-xs text-gray-500">
                          格式刷已启用，点击{formatBrushType === 'text' ? '文字' : formatBrushType === 'image' ? '图片' : formatBrushType === 'frame-image' ? '相框图片' : '元素'}或框选区域应用
                        </div>
                      )}
                    </div>
                  )}
                  {activeObjectCount >= 2 && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-gray-800">图层操作</div>
                      {selectedObject && (
                        <div className="text-xs text-gray-500">
                          当前选中: {selectedObject.type === 'image' ? '图片' : selectedObject.type === 'text' ? '文字' : '形状'}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => getActiveCanvas()?.bringForward()}
                          disabled={!selectedObject || isActivePageLocked}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          上移一层
                        </button>
                        <button
                          onClick={() => getActiveCanvas()?.sendBackwards()}
                          disabled={!selectedObject || isActivePageLocked}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          下移一层
                        </button>
                        <button
                          onClick={() => getActiveCanvas()?.bringToFront()}
                          disabled={!selectedObject || isActivePageLocked}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          置顶
                        </button>
                        <button
                          onClick={() => getActiveCanvas()?.sendToBack()}
                          disabled={!selectedObject || isActivePageLocked}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          置底
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="min-h-[320px]">
                    <LayerPanel canvasRef={activeCanvasRef} selectedObject={selectedObject} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 min-h-0 flex bg-[#F0F2F5] relative">
          <div className="w-[110px] border-r border-gray-200 bg-white/70 overflow-y-auto">
            <div className="flex flex-col items-center gap-3 py-4">
              {pages.map((page, index) => (
                <button
                  key={page.id}
                  onClick={() => {
                    setActiveCanvasId(page.id);
                    scrollToPage(page.id);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className={`relative w-16 h-20 rounded-lg border-2 overflow-hidden ${page.id === activeCanvasId ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'} ${page.hidden ? 'opacity-60' : ''}`}>
                    {pageThumbnails[page.id] ? (
                      <img
                        src={pageThumbnails[page.id]}
                        alt={`页面 ${index + 1}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-gray-500">
                        {index + 1}
                      </div>
                    )}
                    <div className={`absolute bottom-1 right-1 px-1 rounded text-[10px] font-semibold ${page.id === activeCanvasId ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white'}`}>
                      {index + 1}
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {page.hidden ? '已隐藏' : page.locked ? '已锁定' : '页面'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 relative">
            <div ref={scrollContainerRef} className="h-full overflow-y-auto px-8 py-6">
              <div className="flex flex-col items-center gap-6 pb-24">
                {pages.map((page, index) => {
                  const isActive = page.id === activeCanvasId;
                  return (
                    <div key={page.id} className="w-full flex justify-center">
                      <div
                        ref={(el) => {
                          pageContainerRefs.current[page.id] = el;
                        }}
                        className={`relative w-full max-w-[980px] rounded-xl border-2 ${isActive ? 'border-blue-500' : 'border-gray-300'} bg-[#E5E7EB] p-3 shadow-sm ${page.hidden ? 'opacity-60 grayscale' : ''}`}
                        onMouseDown={() => setActiveCanvasId(page.id)}
                      >
                        <div className="absolute left-4 top-3 text-xs font-semibold text-gray-600">
                          第 {index + 1} 页
                        </div>
                        <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 shadow">
                          <button
                            onClick={() => movePage(page.id, 'up')}
                            disabled={index === 0}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-40"
                            title="向上移动"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => movePage(page.id, 'down')}
                            disabled={index === pages.length - 1}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-40"
                            title="向下移动"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => togglePageHidden(page.id)}
                            className={`h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 ${page.hidden ? 'text-blue-600' : 'text-gray-600'}`}
                            title="隐藏页面"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => togglePageLocked(page.id)}
                            className={`h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 ${page.locked ? 'text-blue-600' : 'text-gray-600'}`}
                            title="锁定页面"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-5-6V9a5 5 0 0 1 10 0v2m-11 0h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => clonePage(page.id)}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
                            title="复制页面"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 15H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deletePage(page.id)}
                            disabled={pages.length <= 1}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-40 text-gray-600"
                            title="删除页面"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7v10m6-10v10M4 7h16M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1z" />
                            </svg>
                          </button>
                          <button
                            onClick={addPage}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600"
                            title="添加页面"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                            </svg>
                          </button>
                        </div>

                        <div className="w-full" style={{ height: canvasViewportHeight }}>
                          <CanvasEditor
                            ref={(instance) => {
                              canvasRefs.current[page.id] = instance;
                            }}
                            width={page.width ?? DEFAULT_CANVAS_WIDTH}
                            height={page.height ?? DEFAULT_CANVAS_HEIGHT}
                            backgroundColor={page.backgroundColor}
                            locked={page.locked}
                            onSelectionChange={(object) => handleSelectionChange(page.id, object)}
                            onEditModeChange={handleEditModeChange}
                            onObjectCountChange={(count) => handleObjectCountChange(page.id, count)}
                            onPendingUploadsChange={(count) => handlePendingUploadsChange(page.id, count)}
                            onUploadToastChange={(items) => handleUploadToastsChange(page.id, items)}
                            onChange={() => onCanvasChange(page.id)}
                            onFormatBrushChange={(active, type) => {
                              if (page.id !== activeCanvasId) return;
                              setFormatBrushActive(active);
                              setFormatBrushType(type);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1 text-sm text-gray-700 shadow">
              第 {activePageIndex >= 0 ? activePageIndex + 1 : 0} 页 / 共 {pages.length} 页
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DesignEditor;
