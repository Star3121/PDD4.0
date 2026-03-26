import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { templatesAPI, uploadAPI, Template } from '../api';
import { CustomFont } from '../api/index';
import CanvasEditor, { CanvasEditorRef, UploadToastItem } from '../components/CanvasEditor';
import CanvasTemplateLibrary from '../components/CanvasTemplateLibrary';
import { buildImageUrl, deserializeCanvasData, serializeCanvasData } from '../lib/utils';
import { CANVAS_SIZE_LIMITS, DEFAULT_CANVAS_PRESETS } from '../lib/templateUtils';
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
const DEFAULT_TEMPLATE_WIDTH = DEFAULT_CANVAS_PRESETS[0]?.width ?? 3000;
const DEFAULT_TEMPLATE_HEIGHT = DEFAULT_CANVAS_PRESETS[0]?.height ?? 4000;
const TEMPLATE_PREVIEW_MAX_EDGE = 1600;
const TEMPLATE_PREVIEW_QUALITY = 0.78;
const TEMPLATE_CANVAS_COMPRESS_TIMEOUT_MS = 1200;
const TEMPLATE_CANVAS_COMPRESSION_MIN_SIZE = 120000;

const normalizeTemplateDimension = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(CANVAS_SIZE_LIMITS.min, Math.min(CANVAS_SIZE_LIMITS.max, Math.round(parsed)));
};

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

const TemplateDesignEditor: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canvasRef = useRef<CanvasEditorRef>(null);
  const draftTimer = useRef<NodeJS.Timeout | null>(null);
  const draftPrompted = useRef(false);
  const lastDraftRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateWidth, setTemplateWidth] = useState(DEFAULT_TEMPLATE_WIDTH);
  const [templateHeight, setTemplateHeight] = useState(DEFAULT_TEMPLATE_HEIGHT);
  const [backgroundColor, setBackgroundColor] = useState('#FFFFFF');
  const [templateVersion, setTemplateVersion] = useState(0);
  const [initialCanvasData, setInitialCanvasData] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [selectedObject, setSelectedObject] = useState<any>(null);
  const [activePanel, setActivePanel] = useState<'templates' | 'frames' | 'images' | 'text' | 'layers'>('templates');
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [objectCount, setObjectCount] = useState(0);
  const [canvasViewportHeight, setCanvasViewportHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 720;
    const height = window.innerHeight || 900;
    return Math.max(420, height - 220);
  });
  const [selectedTextValues, setSelectedTextValues] = useState<any>(null);
  const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
  const fontSourceRef = useRef<Map<string, string>>(new Map());
  const fontOptionsRef = useRef<Map<string, FontOption>>(new Map());
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustments>(DEFAULT_IMAGE_ADJUSTMENTS);
  const [imageStrokeSettings, setImageStrokeSettings] = useState<ImageStrokeSettings>(DEFAULT_IMAGE_STROKE_SETTINGS);
  const [formatBrushActive, setFormatBrushActive] = useState(false);
  const [formatBrushType, setFormatBrushType] = useState<'text' | 'image' | 'frame-image' | null>(null);
  const [uploadToasts, setUploadToasts] = useState<UploadToastItem[]>([]);

  const registerFontFace = useCallback(async (fontFamily: string, url: string) => {
    const family = (fontFamily || '').trim();
    if (!family || !url) return false;
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
      console.error(`字体加载失败: ${family}`, error);
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

  const loadUsedCustomFontsFromCanvasData = useCallback(async (canvasPayload: string | null | undefined) => {
    const rawPayload = typeof canvasPayload === 'string' ? canvasPayload : '';
    if (!rawPayload) return;
    const families = new Set<string>();
    try {
      const { canvasData } = await deserializeCanvasData(rawPayload);
      const parsed = JSON.parse(canvasData);
      collectFontFamiliesFromNode(parsed, families);
    } catch {
      return;
    }
    if (families.size === 0) return;
    const results = await Promise.all(Array.from(families).map((family) => ensureCustomFontLoaded(family)));
    if (results.some(Boolean)) {
      canvasRef.current?.canvas?.requestRenderAll();
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
    if (customFonts.length === 0 || !initialCanvasData) return;
    void loadUsedCustomFontsFromCanvasData(initialCanvasData);
  }, [customFonts, initialCanvasData, loadUsedCustomFontsFromCanvasData]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const idParam = searchParams.get('templateId');
    const nameParam = searchParams.get('name') || '';
    const categoryParam = searchParams.get('category') || 'default';
    const widthParam = normalizeTemplateDimension(searchParams.get('width'), DEFAULT_TEMPLATE_WIDTH);
    const heightParam = normalizeTemplateDimension(searchParams.get('height'), DEFAULT_TEMPLATE_HEIGHT);
    const backgroundParam = searchParams.get('backgroundColor') || '#FFFFFF';
    const draftIdParam = searchParams.get('draftId');

    if (idParam) {
      const idNumber = Number(idParam);
      if (!Number.isNaN(idNumber)) {
        setTemplateId(idNumber);
        setDraftKey(`template-draft-${idNumber}`);
        loadTemplate(idNumber);
        return;
      }
    }

    setTemplateName(nameParam);
    setTemplateCategory(categoryParam);
    setTemplateWidth(widthParam);
    setTemplateHeight(heightParam);
    setBackgroundColor(backgroundParam || '#FFFFFF');
    const fallbackDraftId = draftIdParam || `draft-${Date.now()}`;
    setDraftKey(`template-draft-${fallbackDraftId}`);
    setLoading(false);
  }, [location.search]);

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

  const loadTemplate = async (id: number) => {
    try {
      const template = await templatesAPI.getById(id);
      setTemplateName(template.name);
      setTemplateCategory(template.category || 'default');
      setTemplateWidth(normalizeTemplateDimension(template.width, DEFAULT_TEMPLATE_WIDTH));
      setTemplateHeight(normalizeTemplateDimension(template.height, DEFAULT_TEMPLATE_HEIGHT));
      setBackgroundColor(template.background_color || '#FFFFFF');
      setInitialCanvasData(template.canvas_data || null);
      setTemplateVersion(template.version ?? 0);
    } catch (error) {
      console.error('加载模板失败:', error);
      alert('加载模板失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!draftKey || loading) return;
    if (draftPrompted.current) return;
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(draftKey);
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as {
        updatedAt: number;
        canvasData?: string;
        width?: number;
        height?: number;
        backgroundColor?: string;
      };
      if (!data.updatedAt || Date.now() - data.updatedAt > 10 * 60 * 1000) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      const shouldRestore = window.confirm('是否恢复未保存的修改');
      if (shouldRestore) {
        if (data.width !== undefined) setTemplateWidth(normalizeTemplateDimension(data.width, DEFAULT_TEMPLATE_WIDTH));
        if (data.height !== undefined) setTemplateHeight(normalizeTemplateDimension(data.height, DEFAULT_TEMPLATE_HEIGHT));
        if (data.backgroundColor) setBackgroundColor(data.backgroundColor);
        if (data.canvasData) setInitialCanvasData(data.canvasData);
      } else {
        window.localStorage.removeItem(draftKey);
      }
      draftPrompted.current = true;
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, loading]);

  useEffect(() => {
    if (initialCanvasData && canvasRef.current) {
      canvasRef.current.loadCanvasData(initialCanvasData);
    }
  }, [initialCanvasData]);

  const cleanupOldDrafts = (currentKey: string) => {
    if (typeof window === 'undefined') return;
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith('template-draft-') && key !== currentKey);
    const entries = keys.map((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return { key, updatedAt: 0 };
      try {
        const parsed = JSON.parse(raw) as { updatedAt?: number };
        return { key, updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0 };
      } catch {
        return { key, updatedAt: 0 };
      }
    });
    entries.sort((a, b) => a.updatedAt - b.updatedAt);
    entries.slice(0, 3).forEach((entry) => {
      window.localStorage.removeItem(entry.key);
    });
  };

  const saveDraft = async () => {
    if (!canvasRef.current || !draftKey || typeof window === 'undefined') return;
    const rawCanvasData = canvasRef.current.getCanvasData();
    const canvasData = await serializeCanvasData(rawCanvasData, { compress: true, timeoutMs: 1200 });
    const payload = {
      updatedAt: Date.now(),
      canvasData,
      width: templateWidth,
      height: templateHeight,
      backgroundColor
    };
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(payload));
      lastDraftRef.current = Date.now();
    } catch (error) {
      cleanupOldDrafts(draftKey);
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(payload));
        lastDraftRef.current = Date.now();
      } catch (retryError) {
        console.warn('草稿保存失败', retryError);
      }
    }
  };

  const handleCanvasChange = () => {
    if (!draftKey) return;
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
    }
    draftTimer.current = setTimeout(() => {
      void saveDraft();
    }, 1500);
  };

  const resolveImageForEdit = (object: any) => {
    if (!object || !canvasRef.current?.canvas) return null;
    if (object.type === 'image') return object;
    if ((object as any)._isFrame || (object as any)._frameType) {
      const frameId = (object as any).__uid ?? (object as any).id;
      const canvas = canvasRef.current.canvas;
      const match = canvas.getObjects().find((obj) => {
        if (obj.type !== 'image') return false;
        const imageFrameId = (obj as any)._frameId ?? (obj as any).frameId;
        return imageFrameId && imageFrameId === frameId;
      });
      return match || null;
    }
    return null;
  };

  const handleSelectionChange = useCallback((object: any) => {
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

    const imageToEdit = resolveImageForEdit(object);
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

  const handleObjectCountChange = useCallback((count: number) => {
    setObjectCount(count);
  }, []);

  const handleFormatBrushToggle = useCallback(() => {
    if (!canvasRef.current) return;
    if (formatBrushActive) {
      canvasRef.current.cancelFormatBrush();
      return;
    }
    if (!selectedObject) return;
    canvasRef.current.activateFormatBrush(selectedObject);
  }, [formatBrushActive, selectedObject]);

  const handleTextUpdate = async (values: any, isFinal: boolean = true) => {
    if (!selectedObject || !canvasRef.current) return;
    const nextValues = { ...values };
    if (nextValues.fontFamily) {
      await ensureCustomFontLoaded(nextValues.fontFamily);
    }
    if (nextValues.letterSpacing !== undefined) {
      nextValues.charSpacing = nextValues.letterSpacing;
      delete nextValues.letterSpacing;
    }
    canvasRef.current.updateText(selectedObject, nextValues, !isFinal);
  };

  const handleImageAdjustmentUpdate = useCallback((key: keyof ImageAdjustments, value: number, isFinal: boolean = true) => {
    if (!selectedImage || !canvasRef.current) return;
    setImageAdjustments((prev) => {
      const next = { ...prev, [key]: value };
      canvasRef.current?.updateImageAdjustments(selectedImage, next, !isFinal);
      return next;
    });
  }, [selectedImage]);

  const handleImageResetValue = useCallback((key: keyof ImageAdjustments) => {
    handleImageAdjustmentUpdate(key, DEFAULT_IMAGE_ADJUSTMENTS[key], true);
  }, [handleImageAdjustmentUpdate]);

  const handleImageResetAll = useCallback(() => {
    if (!selectedImage || !canvasRef.current) return;
    const next = { ...DEFAULT_IMAGE_ADJUSTMENTS };
    setImageAdjustments(next);
    canvasRef.current.updateImageAdjustments(selectedImage, next, false);
    const strokeNext = { ...DEFAULT_IMAGE_STROKE_SETTINGS };
    setImageStrokeSettings(strokeNext);
    canvasRef.current.updateImageStroke(selectedImage, strokeNext, false);
  }, [selectedImage]);

  const handleImageStrokeUpdate = useCallback((key: string, value: string | number, isFinal: boolean = true) => {
    if (!selectedImage || !canvasRef.current) return;
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
      canvasRef.current?.updateImageStroke(selectedImage, normalized, !isFinal);
      return normalized;
    });
  }, [selectedImage]);

  const handleImageStrokeReset = useCallback(() => {
    if (!selectedImage || !canvasRef.current) return;
    const next = { ...DEFAULT_IMAGE_STROKE_SETTINGS };
    setImageStrokeSettings(next);
    canvasRef.current.updateImageStroke(selectedImage, next, false);
  }, [selectedImage]);

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
        canvasRef.current?.canvas?.requestRenderAll();
      }
    } catch (error) {
      console.error('字体上传失败:', error);
      alert(error instanceof Error ? error.message : '字体上传失败');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      if (canvasRef.current) {
        const sourceName = file.name.replace(/\.[^/.]+$/, '');
        if (selectedObject && (selectedObject as any)._frameType) {
          canvasRef.current.addImageToFrame(url, selectedObject, sourceName);
        } else {
          canvasRef.current.addImage(url, { _sourceName: sourceName });
        }
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleTemplateSelect = async (template: Template) => {
    if (!canvasRef.current) return;
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
    setTemplateWidth(normalizeTemplateDimension(effectiveTemplate.width, DEFAULT_TEMPLATE_WIDTH));
    setTemplateHeight(normalizeTemplateDimension(effectiveTemplate.height, DEFAULT_TEMPLATE_HEIGHT));
    if (effectiveTemplate.background_color) setBackgroundColor(effectiveTemplate.background_color);
    if (effectiveTemplate.canvas_data) {
      canvasRef.current.loadCanvasData(effectiveTemplate.canvas_data);
      void loadUsedCustomFontsFromCanvasData(effectiveTemplate.canvas_data);
      setSelectedObject(null);
      setSelectedTextValues(null);
      setSelectedImage(null);
      setImageAdjustments({ ...DEFAULT_IMAGE_ADJUSTMENTS });
      setImageStrokeSettings({ ...DEFAULT_IMAGE_STROKE_SETTINGS });
      setActivePanel('layers');
      return;
    }
    const url = buildImageUrl(effectiveTemplate.image_path || template.image_path);
    canvasRef.current.addTemplateImage(url);
  };

  const createPreviewDataUrl = () => {
    if (!canvasRef.current?.canvas) return '';
    const canvas = canvasRef.current.canvas;
    const strokeOverlays: any[] = [];
    const originalViewport = canvas.viewportTransform ? [...canvas.viewportTransform] : null;
    const toggleStrokeExport = (enabled: boolean) => {
      canvas.getObjects().forEach((obj) => {
        const overlay = (obj as any)._strokeOverlay as any;
        if (!overlay) return;
        overlay.excludeFromExport = !enabled;
        if (enabled) {
          strokeOverlays.push(overlay);
        }
      });
    };
    try {
      toggleStrokeExport(true);
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.renderAll();
      const exportWidth = Math.round(canvas.getWidth() || 0);
      const exportHeight = Math.round(canvas.getHeight() || 0);
      const maxEdge = Math.max(exportWidth, exportHeight, 1);
      const multiplier = maxEdge > TEMPLATE_PREVIEW_MAX_EDGE
        ? TEMPLATE_PREVIEW_MAX_EDGE / maxEdge
        : 1;
      const dataUrl = canvas.toDataURL({
        format: 'jpeg',
        quality: TEMPLATE_PREVIEW_QUALITY,
        left: 0,
        top: 0,
        width: exportWidth,
        height: exportHeight,
        multiplier,
        withoutTransform: true,
        enableRetinaScaling: false,
        backgroundColor: backgroundColor || '#FFFFFF'
      });
      if (originalViewport) {
        canvas.setViewportTransform(originalViewport as any);
        canvas.renderAll();
      }
      strokeOverlays.forEach((overlay) => {
        overlay.excludeFromExport = true;
      });
      return dataUrl;
    } catch (error) {
      console.warn('预览图生成失败:', error);
      if (originalViewport) {
        canvas.setViewportTransform(originalViewport as any);
        canvas.renderAll();
      }
      strokeOverlays.forEach((overlay) => {
        overlay.excludeFromExport = true;
      });
      return '';
    }
  };

  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const response = await fetch(dataUrl);
    return response.blob();
  };

  const handleSaveTemplate = useCallback(async () => {
    if (!canvasRef.current || saving) return;
    if (!templateName.trim()) {
      alert('模板名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const rawCanvasData = canvasRef.current.getCanvasData();
      const shouldCompress = rawCanvasData.length >= TEMPLATE_CANVAS_COMPRESSION_MIN_SIZE;
      const canvasData = await serializeCanvasData(rawCanvasData, {
        compress: shouldCompress,
        timeoutMs: TEMPLATE_CANVAS_COMPRESS_TIMEOUT_MS
      });
      const previewDataUrl = createPreviewDataUrl();
      if (!previewDataUrl) {
        alert('预览图生成失败');
        return;
      }
      const blob = await dataUrlToBlob(previewDataUrl);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
      const file = new File([blob], `template-preview.${ext}`, { type: blob.type });

      const nextVersion = templateId ? templateVersion + 1 : 1;
      const payload = {
        name: templateName.trim(),
        category: templateCategory || 'default',
        canvas_data: canvasData,
        width: templateWidth,
        height: templateHeight,
        background_color: backgroundColor || '#FFFFFF',
        source: 'user_design',
        version: nextVersion
      };

      if (templateId) {
        await templatesAPI.updateContent(templateId, payload, file);
      } else {
        await templatesAPI.create(file, payload);
      }
      setTemplateVersion(nextVersion);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('templateLibraryRefresh', Date.now().toString());
        if (draftKey) {
          window.localStorage.removeItem(draftKey);
        }
      }
      alert('保存成功');
      window.close();
    } catch (error) {
      console.error('保存模板失败:', error);
      alert(`保存模板失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [backgroundColor, canvasRef, draftKey, saving, templateCategory, templateHeight, templateId, templateName, templateVersion, templateWidth]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 's') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }
      e.preventDefault();
      handleSaveTemplate();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveTemplate]);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (!templateName) {
    return <div className="text-center py-8 text-red-500">模板信息缺失</div>;
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
            <span className="font-semibold text-gray-800">{templateName}</span>
            {templateCategory && <span className="ml-2">分类：{templateCategory}</span>}
            <span className="ml-2">尺寸：{templateWidth}×{templateHeight}</span>
            <span className="ml-2">背景：{backgroundColor}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.confirm('确定要清空画布吗？此操作不可撤销。')) {
                canvasRef.current?.clearCanvas();
              }
            }}
            className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50"
          >
            清空画布
          </button>
          <div className="relative">
            <button
              onClick={handleSaveTemplate}
              disabled={saving}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存至模板库'}
            </button>
            {uploadToasts.length > 0 && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 space-y-2">
                {uploadToasts.map((item) => {
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
                    onClick={() => canvasRef.current?.addCircleFrame(226, 260, 85)}
                    className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium transition-colors"
                  >
                    添加圆形相框
                  </button>
                  <button
                    onClick={() => canvasRef.current?.addSquareFrame(226, 260, 170, 170)}
                    className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors"
                  >
                    添加方形相框
                  </button>
                </div>
              )}

              {activePanel === 'images' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">图片上传</h3>
                    <label className="block w-full cursor-pointer bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg p-4 text-center hover:bg-blue-100 transition-colors">
                      <span className="text-blue-600 font-medium">点击上传图片</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>
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
                    onClick={() => canvasRef.current?.addText('双击编辑文字')}
                    className="w-full px-3 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-md text-sm font-medium transition-colors"
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
                        className={`px-2 py-1 rounded text-sm ${formatBrushActive ? 'bg-amber-100 text-amber-800' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
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
                  {objectCount >= 2 && (
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-gray-800">图层操作</div>
                      {selectedObject && (
                        <div className="text-xs text-gray-500">
                          当前选中: {selectedObject.type === 'image' ? '图片' : selectedObject.type === 'text' ? '文字' : '形状'}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => canvasRef.current?.bringForward()}
                          disabled={!selectedObject}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          上移
                        </button>
                        <button
                          onClick={() => canvasRef.current?.sendBackwards()}
                          disabled={!selectedObject}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          下移
                        </button>
                        <button
                          onClick={() => canvasRef.current?.bringToFront()}
                          disabled={!selectedObject}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          置顶
                        </button>
                        <button
                          onClick={() => canvasRef.current?.sendToBack()}
                          disabled={!selectedObject}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 rounded text-sm"
                        >
                          置底
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="min-h-[320px]">
                    <LayerPanel canvasRef={canvasRef} selectedObject={selectedObject} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-[#F0F2F5] min-h-0">
          <div className="h-full w-full flex items-center justify-center p-6">
            <div className="w-full" style={{ height: canvasViewportHeight }}>
              <CanvasEditor
                ref={canvasRef}
                width={templateWidth}
                height={templateHeight}
                backgroundColor={backgroundColor}
                onSelectionChange={handleSelectionChange}
                onObjectCountChange={handleObjectCountChange}
                onUploadToastChange={setUploadToasts}
                onChange={handleCanvasChange}
                onFormatBrushChange={(active, type) => {
                  setFormatBrushActive(active);
                  setFormatBrushType(type);
                }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default TemplateDesignEditor;
