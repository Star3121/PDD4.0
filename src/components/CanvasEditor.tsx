import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import { uploadAPI } from '../api';
import {
  buildMarchingSquaresSegments,
  buildOrderedLoopsFromSegments,
  computeLoopLength,
  normalizeDashPattern,
  selectOuterLoop,
} from '../lib/outlineTracing';
import {
  buildCanvasLayerMetadata,
  buildImageUrl,
  buildImageVariantPath,
  deserializeCanvasData,
  normalizeImageAssetPath,
  resolveCanvasAssetUrl
} from '../lib/utils';
import { renderCanvasToHighResImage } from '../lib/canvasRenderer';

// 画布尺寸常量 - 75*100cm 抱枕尺寸
const CANVAS_CONFIG = {
  // 物理尺寸（厘米）
  PHYSICAL_WIDTH_CM: 75,
  PHYSICAL_HEIGHT_CM: 100,
  // 宽高比例 (75:100 = 0.75)
  ASPECT_RATIO: 75 / 100,
  // 基础显示尺寸（像素，72 DPI）- 增大1.5倍以获得更好的视觉效果
  BASE_DISPLAY_WIDTH_PX: 3000,
  BASE_DISPLAY_HEIGHT_PX: 4000,
  PRINT_WIDTH_PX: 3000,
  PRINT_HEIGHT_PX: 4000,
  // DPI 设置
  DISPLAY_DPI: 72,
  PRINT_DPI: 300,
  // 响应式设置
  MIN_CANVAS_WIDTH: 450,
  MIN_CANVAS_HEIGHT: 600,
  CONTAINER_PADDING: 40,
};

// 编辑模式类型
type EditMode = 'frame' | 'image' | 'text' | 'crop' | null;
type FormatBrushType = 'text' | 'image' | 'frame-image' | null;

// 编辑动作接口
interface EditAction {
  type: 'transform' | 'move' | 'scale' | 'rotate' | 'text-edit';
  target: fabric.Object;
  previousState: any;
  currentState: any;
}

// 编辑状态接口
interface FrameEditorState {
  mode: EditMode;
  selectedFrame: fabric.Object | null;
  selectedImage: fabric.Image | null;
  selectedText: fabric.IText | null;
  isDragging: boolean;
}

// 命令接口
interface Command {
  execute(): void;
  undo(): void;
}

// 相框变换命令
class FrameTransformCommand implements Command {
  constructor(
    private frame: fabric.Object,
    private previousState: any,
    private currentState: any
  ) {}

  execute() {
    this.frame.set(this.currentState);
    this.frame.canvas?.renderAll();
  }

  undo() {
    this.frame.set(this.previousState);
    this.frame.canvas?.renderAll();
  }
}

// 图片变换命令
class ImageTransformCommand implements Command {
  constructor(
    private image: fabric.Image,
    private previousState: any,
    private currentState: any
  ) {}

  execute() {
    this.image.set(this.currentState);
    this.image.canvas?.renderAll();
  }

  undo() {
    this.image.set(this.previousState);
    this.image.canvas?.renderAll();
  }
}

// 文字变换命令
class TextTransformCommand implements Command {
  constructor(
    private text: fabric.IText,
    private previousState: any,
    private currentState: any
  ) {}

  execute() {
    this.text.set(this.currentState);
    // 处理路径恢复
    if (this.currentState.pathInfo) {
       // 如果保存了路径信息，需要重新构建path对象
       // 这里简化处理，假设pathInfo包含了构建path所需的信息
       // 实际实现可能需要更复杂的逻辑
    }
    this.text.canvas?.renderAll();
  }

  undo() {
    this.text.set(this.previousState);
    this.text.canvas?.renderAll();
  }
}

// 历史管理器
class HistoryManager {
  private history: any[] = [];
  private currentIndex = -1;
  private maxSize = 50;

  push(state: any) {
    // 如果不在历史末尾，删除后面的记录
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    // 添加新状态
    this.history.push(state);
    this.currentIndex++;

    // 如果超过最大大小，删除最旧的记录
    if (this.history.length > this.maxSize) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  undo(): any | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return null;
  }

  redo(): any | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return null;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }
}

// CanvasEditor 属性接口
export interface CanvasEditorProps {
  width?: number;
  height?: number;
  backgroundColor?: string;
  locked?: boolean;
  onSelectionChange?: (object: fabric.Object | null) => void;
  onEditModeChange?: (mode: EditMode, target: fabric.Object | null) => void;
  onObjectCountChange?: (count: number) => void;
  onPendingUploadsChange?: (count: number) => void;
  onUploadToastChange?: (items: UploadToastItem[]) => void;
  onChange?: () => void;
  onFormatBrushChange?: (active: boolean, sourceType: FormatBrushType) => void;
}

interface ImageAdjustments {
  temperature: number;
  tint: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

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

// CanvasEditor 引用接口
export interface CanvasEditorRef {
  addImage: (url: string, options?: fabric.IImageOptions & { _sourceName?: string }) => void;
  insertImageFile: (file: File, targetFrame?: fabric.Object | null) => Promise<void>;
  getPendingUploadsCount: () => number;
  hasUnsyncedImages: () => boolean;
  exportCanvas: (
    backgroundType?: 'transparent' | 'white',
    highResolution?: boolean,
    maxWidth?: number,
    imageFormat?: 'png' | 'jpeg',
    quality?: number
  ) => Promise<string>;
  getWidth: () => number;
  getHeight: () => number;
  addCircleFrame: (x: number, y: number, radius: number) => void;
  addSquareFrame: (x: number, y: number, width: number, height: number) => void;
  uploadImageToFrame: (file: File) => void;
  getCanvasData: () => string;
  loadCanvasData: (data: string) => void;
  bringForward: () => void;
  sendBackwards: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  nudgeSelection: (direction: 'up' | 'down' | 'left' | 'right', step?: number) => boolean;
  enableLowResolutionMode: () => void;
  disableLowResolutionMode: () => void;
  getPerformanceInfo: () => { fps: number; isLowResolution: boolean };
  addTemplateImage: (url: string) => void;
  addImageToFrame: (url: string, targetFrame?: fabric.Object, sourceName?: string) => void;
  clearCanvas: () => void;
  getObjects: () => fabric.Object[];
  addText: (text: string, options?: fabric.ITextOptions) => void;
  updateText: (textObject: fabric.IText, options: any, skipHistory?: boolean) => void;
  updateImageAdjustments: (image: fabric.Image, adjustments: ImageAdjustments, skipHistory?: boolean) => void;
  updateImageStroke: (image: fabric.Image, settings: ImageStrokeSettings, skipHistory?: boolean) => void;
  activateFormatBrush: (source: fabric.Object) => void;
  cancelFormatBrush: () => void;
  isFormatBrushActive: () => boolean;
  selectLayerById: (id: string) => void;
  getBackgroundColor: () => string;
  getLayerMetadata: () => ReturnType<typeof buildCanvasLayerMetadata>;
  updateLayerById: (id: string, props: Partial<fabric.Object>) => boolean;
  deleteLayerById: (id: string) => boolean;
  canvas: fabric.Canvas | null;
}

type UploadToastStatus = 'queued' | 'uploading' | 'processing' | 'retrying' | 'success' | 'failed';

export type UploadToastItem = {
  id: string;
  name: string;
  status: UploadToastStatus;
  progress: number;
  message: string;
  error?: string;
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

const STROKE_DASH_SCALE = { dash: 2, gap: 1.5 };
const STROKE_WORKER_THRESHOLD = 3000;
const STROKE_INNER_OVERLAP_PX = 3;

const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>((props, ref) => {
  // Custom properties to include in serialization
  const CANVAS_CUSTOM_PROPS = [
    '_isFrame',
    '_frameType',
    '_frameRadius',
    '_isEmptyFrame',
    '__uid',
    '_imageId',
    '_isFrameImage',
    '_originalScale',
    '_frameId',
    '_isImage',
    'curve',
    '_imgOffsetX',
    '_imgOffsetY',
    'id',
    'frameId',
    'stroke',
    'strokeWidth',
    '_imageAdjustments',
    '_imageStrokeSettings',
    '_assetOriginalPath',
    '_assetEditorPath',
    '_assetThumbPath',
    '_assetNaturalWidth',
    '_assetNaturalHeight',
    '_assetUploadStatus',
    '_cropXRatio',
    '_cropYRatio',
    '_cropWidthRatio',
    '_cropHeightRatio',
    '_isStrokeOverlay'
  ];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasInstance = useRef<fabric.Canvas | null>(null);
  const historyManagerRef = useRef(new HistoryManager());
  
  const [editState, setEditState] = useState<FrameEditorState>({
    mode: null,
    selectedFrame: null,
    selectedImage: null,
    selectedText: null,
    isDragging: false,
  });

  // 使用ref持有最新的编辑状态，解决事件回调中的闭包问题
  const editStateRef = useRef(editState);
  useEffect(() => {
    editStateRef.current = editState;
  }, [editState]);

  // 使用ref持有最新的回调函数，解决事件回调中的闭包问题
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  const onEditModeChangeRef = useRef(props.onEditModeChange);
  const onObjectCountChangeRef = useRef(props.onObjectCountChange);
  const onPendingUploadsChangeRef = useRef(props.onPendingUploadsChange);
  const onUploadToastChangeRef = useRef(props.onUploadToastChange);
  const copyBufferRef = useRef<{ objects: fabric.Object[] } | null>(null);
  const draggingImageRef = useRef<fabric.Image | null>(null);
  const dragHoverFrameRef = useRef<fabric.Object | null>(null);
  const dragPreviewImageRef = useRef<fabric.Image | null>(null);
  const dragPreviewSourceImageRef = useRef<fabric.Image | null>(null);
  const dragPreviewSourceOpacityRef = useRef<number | null>(null);
  const suppressSelectionCallbacksRef = useRef(false);
  const formatBrushRef = useRef<{
    active: boolean;
    sourceType: FormatBrushType;
    textOptions?: any;
    imageAdjustments?: ImageAdjustments;
    imageStrokeSettings?: ImageStrokeSettings;
    imageOpacity?: number;
  }>({ active: false, sourceType: null });
  const formatBrushSelectionRef = useRef<{
    start: fabric.Point | null;
    rect: fabric.Rect | null;
    dragging: boolean;
  }>({ start: null, rect: null, dragging: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const strokeWorkerRef = useRef<Worker | null>(null);
  const strokeWorkerCallbacks = useRef(new Map<number, (data: { points: Array<{ x: number; y: number }>; length: number }) => void>());
  const strokeWorkerRequestId = useRef(0);
  const lockedRef = useRef(false);
  const pendingUploadsRef = useRef(0);

  useEffect(() => {
    onSelectionChangeRef.current = props.onSelectionChange;
  }, [props.onSelectionChange]);

  useEffect(() => {
    onEditModeChangeRef.current = props.onEditModeChange;
  }, [props.onEditModeChange]);

  useEffect(() => {
    onObjectCountChangeRef.current = props.onObjectCountChange;
  }, [props.onObjectCountChange]);

  useEffect(() => {
    onPendingUploadsChangeRef.current = props.onPendingUploadsChange;
  }, [props.onPendingUploadsChange]);

  useEffect(() => {
    onUploadToastChangeRef.current = props.onUploadToastChange;
  }, [props.onUploadToastChange]);

  useEffect(() => {
    return () => {
      strokeWorkerRef.current?.terminate();
      strokeWorkerRef.current = null;
      strokeWorkerCallbacks.current.clear();
    };
  }, []);

  const getLogicalCanvasSize = useCallback(() => {
    const baseWidth = props.width ?? CANVAS_CONFIG.BASE_DISPLAY_WIDTH_PX;
    const baseHeight = props.height ?? CANVAS_CONFIG.BASE_DISPLAY_HEIGHT_PX;
    const safeBaseWidth = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : CANVAS_CONFIG.BASE_DISPLAY_WIDTH_PX;
    const safeBaseHeight = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : CANVAS_CONFIG.BASE_DISPLAY_HEIGHT_PX;
    return {
      width: safeBaseWidth,
      height: safeBaseHeight
    };
  }, [props.width, props.height]);

  const calculateViewportFit = useCallback(() => {
    const logicalSize = getLogicalCanvasSize();
    const viewportElement = viewportRef.current;
    const viewportWidth = viewportElement?.clientWidth || window.innerWidth || 1200;
    const viewportHeight = viewportElement?.clientHeight || window.innerHeight || 800;
    const padding = CANVAS_CONFIG.CONTAINER_PADDING * 2;
    const availableWidth = Math.max(1, viewportWidth - padding);
    const availableHeight = Math.max(1, viewportHeight - padding);
    const scale = Math.min(availableWidth / logicalSize.width, availableHeight / logicalSize.height);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const clampedScale = Math.min(1, safeScale);
    const fitWidth = Math.max(1, Math.round(logicalSize.width * clampedScale));
    const fitHeight = Math.max(1, Math.round(logicalSize.height * clampedScale));
    return {
      width: fitWidth,
      height: fitHeight,
      scale: clampedScale
    };
  }, [getLogicalCanvasSize]);

  // 工具函数：计算图片适配画布的尺寸和位置
  const calculateImageFitToCanvas = (imageWidth: number, imageHeight: number) => {
    const { width: canvasWidth, height: canvasHeight } = getLogicalCanvasSize();
    
    // 设置图片的最大显示尺寸为画布的90%，让图片在画布上显示得更大一些
    const maxDisplayWidth = canvasWidth * 0.9;
    const maxDisplayHeight = canvasHeight * 0.9;
    
    // 计算缩放比例，确保图片在合理范围内
    const scaleX = maxDisplayWidth / imageWidth;
    const scaleY = maxDisplayHeight / imageHeight;
    const scale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小
    
    // 计算居中位置
    const scaledWidth = imageWidth * scale;
    const scaledHeight = imageHeight * scale;
    const left = (canvasWidth - scaledWidth) / 2;
    const top = (canvasHeight - scaledHeight) / 2;
    
    return {
      scale,
      left,
      top,
      width: scaledWidth,
      height: scaledHeight
    };
  };

  const [selectedObject, setSelectedObject] = useState<fabric.Object | null>(null);
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetObject: fabric.Object | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetObject: null
  });
  const [canvasBackground, setCanvasBackground] = useState(props.backgroundColor ?? '#ffffff');
  const [showBackgroundControl, setShowBackgroundControl] = useState(false);
  const [uploadToastItems, setUploadToastItems] = useState<UploadToastItem[]>([]);
  const uploadProgressTimersRef = useRef<Record<string, number>>({});
  const uploadDismissTimersRef = useRef<Record<string, number>>({});

  const clearUploadProgressTimer = useCallback((taskId: string) => {
    const timerId = uploadProgressTimersRef.current[taskId];
    if (timerId) {
      window.clearInterval(timerId);
      delete uploadProgressTimersRef.current[taskId];
    }
  }, []);

  const clearUploadDismissTimer = useCallback((taskId: string) => {
    const timerId = uploadDismissTimersRef.current[taskId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete uploadDismissTimersRef.current[taskId];
    }
  }, []);

  const removeUploadToastItem = useCallback((taskId: string) => {
    clearUploadProgressTimer(taskId);
    clearUploadDismissTimer(taskId);
    setUploadToastItems((prev) => prev.filter((item) => item.id !== taskId));
  }, [clearUploadDismissTimer, clearUploadProgressTimer]);

  const updateUploadToastItem = useCallback((taskId: string, patch: Partial<UploadToastItem>) => {
    setUploadToastItems((prev) => prev.map((item) => item.id === taskId ? { ...item, ...patch } : item));
  }, []);

  const createUploadToastItem = useCallback((file: File, queueIndex = 0) => {
    const taskId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queueMessage = queueIndex > 0 ? `排队中（前方 ${queueIndex} 个）` : '等待上传';
    const queueStatus: UploadToastStatus = queueIndex > 0 ? 'queued' : 'uploading';
    const initialProgress = queueIndex > 0 ? 0 : 8;
    setUploadToastItems((prev) => [
      ...prev,
      {
        id: taskId,
        name: file.name,
        status: queueStatus,
        progress: initialProgress,
        message: queueMessage,
      }
    ]);
    return taskId;
  }, []);

  const startUploadProgress = useCallback((taskId: string) => {
    clearUploadDismissTimer(taskId);
    clearUploadProgressTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'uploading',
      progress: 8,
      message: '上传中...',
      error: undefined,
    });
    uploadProgressTimersRef.current[taskId] = window.setInterval(() => {
      setUploadToastItems((prev) => prev.map((item) => {
        if (item.id !== taskId || item.status !== 'uploading') return item;
        const nextProgress = Math.min(88, item.progress + Math.max(2, Math.round(Math.random() * 7)));
        return { ...item, progress: nextProgress };
      }));
    }, 180);
  }, [clearUploadDismissTimer, clearUploadProgressTimer, updateUploadToastItem]);

  const setUploadProcessing = useCallback((taskId: string) => {
    clearUploadProgressTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'processing',
      progress: 94,
      message: '正在同步画布...',
    });
  }, [clearUploadProgressTimer, updateUploadToastItem]);

  const setUploadRetrying = useCallback((taskId: string, attempt: number, maxAttempts: number) => {
    clearUploadProgressTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'retrying',
      progress: 96,
      message: `代理图加载失败，自动重试 ${attempt}/${maxAttempts}`,
      error: undefined,
    });
  }, [clearUploadProgressTimer, updateUploadToastItem]);

  const finishUploadSuccess = useCallback((taskId: string) => {
    clearUploadProgressTimer(taskId);
    clearUploadDismissTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'success',
      progress: 100,
      message: '上传完成',
      error: undefined,
    });
    uploadDismissTimersRef.current[taskId] = window.setTimeout(() => {
      removeUploadToastItem(taskId);
    }, 1400);
  }, [clearUploadDismissTimer, clearUploadProgressTimer, removeUploadToastItem, updateUploadToastItem]);

  const finishUploadFailed = useCallback((taskId: string, reason: string) => {
    clearUploadProgressTimer(taskId);
    clearUploadDismissTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'failed',
      message: '上传失败',
      error: reason,
    });
    uploadDismissTimersRef.current[taskId] = window.setTimeout(() => {
      removeUploadToastItem(taskId);
    }, 2800);
  }, [clearUploadDismissTimer, clearUploadProgressTimer, removeUploadToastItem, updateUploadToastItem]);

  const finishUploadFallbackWarning = useCallback((taskId: string, reason: string) => {
    clearUploadProgressTimer(taskId);
    clearUploadDismissTimer(taskId);
    updateUploadToastItem(taskId, {
      status: 'failed',
      progress: 100,
      message: '代理图重试失败',
      error: reason,
    });
    uploadDismissTimersRef.current[taskId] = window.setTimeout(() => {
      removeUploadToastItem(taskId);
    }, 3600);
  }, [clearUploadDismissTimer, clearUploadProgressTimer, removeUploadToastItem, updateUploadToastItem]);

  useEffect(() => {
    if (props.backgroundColor === undefined) return;
    setCanvasBackground(props.backgroundColor);
  }, [props.backgroundColor]);
  useEffect(() => {
    return () => {
      Object.values(uploadProgressTimersRef.current).forEach((timerId) => window.clearInterval(timerId));
      Object.values(uploadDismissTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      uploadProgressTimersRef.current = {};
      uploadDismissTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    onUploadToastChangeRef.current?.(uploadToastItems.map((item) => ({ ...item })));
  }, [uploadToastItems]);
  const [viewportFit, setViewportFit] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        width: CANVAS_CONFIG.BASE_DISPLAY_WIDTH_PX,
        height: CANVAS_CONFIG.BASE_DISPLAY_HEIGHT_PX,
        scale: 1
      };
    }
    return calculateViewportFit();
  });
  const canvasInitializedRef = useRef(false);

  // 初始化画布
  useEffect(() => {
    if (!canvasRef.current) return;
    if (canvasInitializedRef.current && canvasInstance.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
        width: getLogicalCanvasSize().width,
        height: getLogicalCanvasSize().height,
      backgroundColor: canvasBackground,
      selection: true,
      preserveObjectStacking: true,
    });

    canvasInstance.current = canvas;
    canvasInitializedRef.current = true;

    // 设置画布事件
    setupCanvasEvents();

    // 添加键盘事件监听
    const handleKeyDown = (e: KeyboardEvent) => {
      // 防止在输入框等元素中触发
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }
      if (lockedRef.current) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          case 'z':
            e.preventDefault();
            undo();
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
          case 'c':
            e.preventDefault();
            copySelectedObject();
            break;
          case 'v':
            if (copyBufferRef.current) {
              e.preventDefault();
              pasteCopiedObjects();
            }
            break;
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitEditMode();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.shiftKey ? 10 : 1;
        const direction = e.key === 'ArrowUp'
          ? 'up'
          : e.key === 'ArrowDown'
            ? 'down'
            : e.key === 'ArrowLeft'
              ? 'left'
              : 'right';
        const moved = nudgeSelection(direction, step);
        if (moved) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();

      imageItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;
        handleExternalImageFiles([file]);
      });
    };

    document.addEventListener('paste', handlePaste);

    // 保存初始状态到历史
    saveStateToHistory();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('paste', handlePaste);
      
      // 安全地清理Canvas
      try {
        if (canvas && typeof canvas.dispose === 'function') {
          // 先清理事件监听器
          cleanupCanvas();
          
          // 清理Canvas上下文
          const canvasElement = canvas.getElement();
          if (canvasElement) {
            const ctx = canvasElement.getContext('2d');
            if (ctx && typeof ctx.clearRect === 'function') {
              try {
                ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
              } catch (error) {
                console.warn('[CanvasEditor] Canvas context clearRect failed:', error);
              }
            }
          }
          
          // 最后dispose Canvas
          canvas.dispose();
        }
        if (canvasInstance.current === canvas) {
          canvasInstance.current = null;
        }
        canvasInitializedRef.current = false;
      } catch (error) {
        console.warn('[CanvasEditor] Canvas cleanup failed:', error);
      }
    };
  }, []);

  useEffect(() => {
    if (!canvasInstance.current) return;
    canvasInstance.current.setBackgroundColor(canvasBackground, () => {
      canvasInstance.current?.renderAll();
    });
  }, [canvasBackground]);

  useEffect(() => {
    const canvas = canvasInstance.current;
    if (!canvas) return;
    const isLocked = Boolean(props.locked);
    lockedRef.current = isLocked;
    canvas.selection = !isLocked;
    canvas.skipTargetFind = isLocked;
    canvas.defaultCursor = isLocked ? 'not-allowed' : 'default';
    canvas.hoverCursor = isLocked ? 'not-allowed' : 'default';
    if (isLocked) {
      canvas.discardActiveObject();
      props.onSelectionChange?.(null);
    }
    canvas.requestRenderAll();
  }, [props.locked]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!showBackgroundControl) return;
      const container = canvasContainerRef.current;
      if (!container) return;
      if (!container.contains(event.target as Node)) {
        setShowBackgroundControl(false);
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [showBackgroundControl]);

  const fitToViewport = useCallback(() => {
    if (typeof window === 'undefined') return;
    const logicalSize = getLogicalCanvasSize();
    const nextFit = calculateViewportFit();
    setViewportFit((prev) => {
      if (prev.width === nextFit.width && prev.height === nextFit.height && prev.scale === nextFit.scale) {
        return prev;
      }
      return nextFit;
    });
    if (canvasInstance.current) {
      canvasInstance.current.setDimensions({
        width: logicalSize.width,
        height: logicalSize.height
      });
      const tx = (nextFit.width - logicalSize.width * nextFit.scale) / 2;
      const ty = (nextFit.height - logicalSize.height * nextFit.scale) / 2;
      canvasInstance.current.setViewportTransform([nextFit.scale, 0, 0, nextFit.scale, tx, ty]);
      canvasInstance.current.renderAll();
    }
  }, [calculateViewportFit, getLogicalCanvasSize]);

  useEffect(() => {
    fitToViewport();
  }, [fitToViewport]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => fitToViewport();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', handleResize);
    viewport?.addEventListener('scroll', handleResize);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    if (observer && viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      viewport?.removeEventListener('resize', handleResize);
      viewport?.removeEventListener('scroll', handleResize);
      observer?.disconnect();
    };
  }, [fitToViewport]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editStateRef.current.mode === 'crop') {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmCrop();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelCrop();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 设置画布事件
  const setupCanvasEvents = () => {
    if (!canvasInstance.current) return;

    const canvas = canvasInstance.current;

    // 选择事件
    canvas.on('selection:created', handleSelectionCreated);
    canvas.on('selection:updated', handleSelectionUpdated);
    canvas.on('selection:cleared', handleSelectionCleared);

    // 鼠标事件
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    
    // 双击事件 - 核心功能
    canvas.on('mouse:dblclick', handleDoubleClick);
    
    // 右键菜单事件
    canvas.on('mouse:down:before', (e) => {
      // 如果是右键点击，显示右键菜单
      if (e.e.button === 2) {
        handleContextMenu(e);
      }
    });

    // 对象变换事件
  canvas.on('object:modified', throttle(handleObjectModified, 100));
  canvas.on('object:scaling', throttle(handleObjectScaling, 50));
  canvas.on('object:moving', throttle(handleObjectMoving, 50));
  canvas.on('object:rotating', throttle(handleObjectRotating, 50));
  };

  // 清理画布事件
  const cleanupCanvas = () => {
    if (!canvasInstance.current) return;

    const canvas = canvasInstance.current;

    canvas.off('selection:created', handleSelectionCreated);
    canvas.off('selection:updated', handleSelectionUpdated);
    canvas.off('selection:cleared', handleSelectionCleared);
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
    canvas.off('mouse:dblclick', handleDoubleClick);
    canvas.off('mouse:down:before');
    canvas.off('object:modified', handleObjectModified);
    canvas.off('object:scaling', handleObjectScaling);
    canvas.off('object:moving', handleObjectMoving);
    canvas.off('object:rotating', handleObjectRotating);
  };

  // 输入验证函数
  const validateObject = (obj: any, operation: string): boolean => {
    if (!obj) {
      console.warn(`[CanvasEditor] Invalid object for ${operation}`);
      return false;
    }
    if (!canvasInstance.current) {
      console.warn(`[CanvasEditor] Canvas not initialized for ${operation}`);
      return false;
    }
    return true;
  };

  const validateCanvas = (operation: string): boolean => {
    if (!canvasInstance.current) {
      console.warn(`[CanvasEditor] Canvas not initialized for ${operation}`);
      return false;
    }
    return true;
  };

  // 边界检查函数
  const clampValue = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
  };

  const normalizeImageAdjustments = (raw?: Partial<ImageAdjustments> | null): ImageAdjustments => {
    const source = raw || {};
    return {
      temperature: clampValue(Number(source.temperature ?? 0), -100, 100),
      tint: clampValue(Number(source.tint ?? 0), -180, 180),
      brightness: clampValue(Number(source.brightness ?? 0), -100, 100),
      contrast: clampValue(Number(source.contrast ?? 0), -100, 100),
      highlights: clampValue(Number(source.highlights ?? 0), -100, 100),
      shadows: clampValue(Number(source.shadows ?? 0), -100, 100),
      whites: clampValue(Number(source.whites ?? 0), -100, 100),
      blacks: clampValue(Number(source.blacks ?? 0), -100, 100),
    };
  };

  const isValidColorValue = (value: string) => {
    if (!value) return false;
    if (typeof CSS !== 'undefined' && typeof (CSS as any).supports === 'function') {
      return (CSS as any).supports('color', value);
    }
    return true;
  };

  const normalizeImageStrokeSettings = (raw?: Partial<ImageStrokeSettings> | null): ImageStrokeSettings => {
    const source = raw || {};
    const style = source.style || DEFAULT_IMAGE_STROKE_SETTINGS.style;
    const color = typeof source.color === 'string' && isValidColorValue(source.color)
      ? source.color
      : DEFAULT_IMAGE_STROKE_SETTINGS.color;
    const thickness = clampValue(Number(source.thickness ?? DEFAULT_IMAGE_STROKE_SETTINGS.thickness), 1, 50);
    const opacity = clampValue(Number(source.opacity ?? DEFAULT_IMAGE_STROKE_SETTINGS.opacity), 0, 100);
    const normalizeLayer = (
      rawLayer: Partial<ImageStrokeLayerSettings> | null | undefined,
      fallback: ImageStrokeLayerSettings
    ): ImageStrokeLayerSettings => {
      const layerSource = rawLayer || {};
      const layerColor = typeof layerSource.color === 'string' && isValidColorValue(layerSource.color)
        ? layerSource.color
        : fallback.color;
      return {
        color: layerColor,
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

  const getStrokeWorker = () => {
    if (strokeWorkerRef.current) return strokeWorkerRef.current;
    const workerCode = `
      const buildMarchingSquaresSegments = (mask, width, height) => {
        const segments = [];
        const idx = (x, y) => y * width + x;
        for (let y = 0; y < height - 1; y += 1) {
          for (let x = 0; x < width - 1; x += 1) {
            const tl = mask[idx(x, y)] ? 1 : 0;
            const tr = mask[idx(x + 1, y)] ? 2 : 0;
            const br = mask[idx(x + 1, y + 1)] ? 4 : 0;
            const bl = mask[idx(x, y + 1)] ? 8 : 0;
            const code = tl | tr | br | bl;
            if (code === 0 || code === 15) continue;
            const top = { x: x + 0.5, y };
            const right = { x: x + 1, y: y + 0.5 };
            const bottom = { x: x + 0.5, y: y + 1 };
            const left = { x, y: y + 0.5 };
            switch (code) {
              case 1:
                segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
                break;
              case 2:
                segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
                break;
              case 3:
                segments.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
                break;
              case 4:
                segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
                break;
              case 5:
                segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
                segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
                break;
              case 6:
                segments.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
                break;
              case 7:
                segments.push({ x1: left.x, y1: left.y, x2: bottom.x, y2: bottom.y });
                break;
              case 8:
                segments.push({ x1: bottom.x, y1: bottom.y, x2: left.x, y2: left.y });
                break;
              case 9:
                segments.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
                break;
              case 10:
                segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
                segments.push({ x1: bottom.x, y1: bottom.y, x2: left.x, y2: left.y });
                break;
              case 11:
                segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
                break;
              case 12:
                segments.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
                break;
              case 13:
                segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
                break;
              case 14:
                segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
                break;
              default:
                break;
            }
          }
        }
        return segments;
      };

      const buildOrderedLoopsFromSegments = (segments) => {
        const adjacency = new Map();
        const addEdge = (from, to, dx, dy) => {
          const list = adjacency.get(from) || [];
          list.push({ to, dx, dy, angle: Math.atan2(dy, dx) });
          adjacency.set(from, list);
        };
        const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
        segments.forEach(seg => {
          const a = seg.x1 + ',' + seg.y1;
          const b = seg.x2 + ',' + seg.y2;
          addEdge(a, b, seg.x2 - seg.x1, seg.y2 - seg.y1);
          addEdge(b, a, seg.x1 - seg.x2, seg.y1 - seg.y2);
        });
        const visited = new Set();
        const loops = [];
        const toPoint = (key) => {
          const parts = key.split(',');
          return { x: Number(parts[0]), y: Number(parts[1]) };
        };
        adjacency.forEach((edges, start) => {
          edges.forEach(edge => {
            const firstKey = edgeKey(start, edge.to);
            if (visited.has(firstKey)) return;
            const points = [toPoint(start)];
            let prev = start;
            let current = edge.to;
            let prevAngle = edge.angle;
            visited.add(firstKey);
            let safety = 0;
            while (safety < 200000) {
              safety += 1;
              points.push(toPoint(current));
              if (current === start) break;
              const candidates = adjacency.get(current) || [];
              let best = null;
              let bestDelta = Infinity;
              for (let i = 0; i < candidates.length; i += 1) {
                const candidate = candidates[i];
                if (candidate.to === prev) continue;
                const key = edgeKey(current, candidate.to);
                if (visited.has(key)) continue;
                const delta = (candidate.angle - prevAngle + Math.PI * 2) % (Math.PI * 2);
                if (delta < bestDelta) {
                  bestDelta = delta;
                  best = candidate;
                }
              }
              if (!best) break;
              visited.add(edgeKey(current, best.to));
              prev = current;
              current = best.to;
              prevAngle = best.angle;
            }
            if (points.length > 2) loops.push(points);
          });
        });
        return loops;
      };

      const computeLength = (points) => {
        let total = 0;
        for (let i = 1; i < points.length; i += 1) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          total += Math.hypot(dx, dy);
        }
        return total;
      };

      const computeArea = (points) => {
        let area = 0;
        for (let i = 0; i < points.length - 1; i += 1) {
          area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
        }
        return area / 2;
      };

      self.onmessage = (event) => {
        const { id, mask, width, height, segments } = event.data;
        const resolvedSegments = segments || (mask ? buildMarchingSquaresSegments(mask, width, height) : []);
        if (!resolvedSegments.length) {
          self.postMessage({ id, points: [], length: 0 });
          return;
        }
        const loops = buildOrderedLoopsFromSegments(resolvedSegments);
        if (!loops.length) {
          self.postMessage({ id, points: [], length: 0 });
          return;
        }
        let best = loops[0];
        let bestArea = Math.abs(computeArea(loops[0]));
        for (let i = 1; i < loops.length; i += 1) {
          const area = Math.abs(computeArea(loops[i]));
          if (area > bestArea) {
            bestArea = area;
            best = loops[i];
          }
        }
        const length = computeLength(best);
        self.postMessage({ id, points: best, length });
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
    worker.onmessage = (event) => {
      const { id, points, length } = event.data || {};
      const callback = strokeWorkerCallbacks.current.get(id);
      if (callback) {
        strokeWorkerCallbacks.current.delete(id);
        callback({ points: points || [], length: length || 0 });
      }
    };
    strokeWorkerRef.current = worker;
    return worker;
  };


  const buildStrokeCanvas = async (image: fabric.Image, settings: ImageStrokeSettings) => {
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

    let outlinePoints: Array<{ x: number; y: number }> = [];
    let outlineLength = 0;
    if (segments.length > STROKE_WORKER_THRESHOLD && typeof Worker !== 'undefined') {
      const worker = getStrokeWorker();
      const requestId = (strokeWorkerRequestId.current += 1);
      const result = await new Promise<{ points: Array<{ x: number; y: number }>; length: number }>((resolve) => {
        strokeWorkerCallbacks.current.set(requestId, resolve);
        worker.postMessage({ id: requestId, segments });
      });
      outlinePoints = result.points;
      outlineLength = result.length;
    } else {
      const loops = buildOrderedLoopsFromSegments(segments);
      const best = selectOuterLoop(loops);
      if (!best) return null;
      outlinePoints = best;
      outlineLength = computeLoopLength(best);
    }

    if (outlinePoints.length < 2 || outlineLength <= 0) return null;

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
    outlinePath.moveTo(outlinePoints[0].x, outlinePoints[0].y);
    for (let i = 1; i < outlinePoints.length; i += 1) {
      outlinePath.lineTo(outlinePoints[i].x, outlinePoints[i].y);
    }
    outlinePath.closePath();
    ctx.stroke(outlinePath);
    return { canvas: outlineCanvas, padding, renderScale };
  };

  const buildImageFilters = (adjustments: ImageAdjustments) => {
    const filters: any[] = [];
    const temperature = clampValue(adjustments.temperature, -100, 100);
    const tint = clampValue(adjustments.tint, -180, 180);
    const brightness = clampValue(adjustments.brightness, -100, 100);
    const contrast = clampValue(adjustments.contrast, -100, 100);
    const highlights = clampValue(adjustments.highlights, -100, 100);
    const shadows = clampValue(adjustments.shadows, -100, 100);
    const whites = clampValue(adjustments.whites, -100, 100);
    const blacks = clampValue(adjustments.blacks, -100, 100);

    if (temperature !== 0) {
      const t = temperature / 100;
      const r = 1 + 0.2 * t;
      const b = 1 - 0.2 * t;
      filters.push(new fabric.Image.filters.ColorMatrix({
        matrix: [
          r, 0, 0, 0, 0,
          0, 1, 0, 0, 0,
          0, 0, b, 0, 0,
          0, 0, 0, 1, 0
        ]
      }));
    }

    if (tint !== 0) {
      const rotation = (tint * Math.PI) / 180;
      filters.push(new fabric.Image.filters.HueRotation({ rotation }));
    }

    if (brightness !== 0) {
      filters.push(new fabric.Image.filters.Brightness({ brightness: brightness / 100 }));
    }

    if (contrast !== 0) {
      filters.push(new fabric.Image.filters.Contrast({ contrast: contrast / 100 }));
    }

    if (shadows !== 0) {
      const gamma = clampValue(1 - shadows / 200, 0.2, 3);
      filters.push(new fabric.Image.filters.Gamma({ gamma: [gamma, gamma, gamma] }));
    }

    if (highlights !== 0) {
      const gamma = clampValue(1 + highlights / 200, 0.2, 3);
      filters.push(new fabric.Image.filters.Gamma({ gamma: [gamma, gamma, gamma] }));
    }

    if (whites !== 0 || blacks !== 0) {
      const offset = (whites - blacks) / 100 * 0.1;
      filters.push(new fabric.Image.filters.ColorMatrix({
        matrix: [
          1, 0, 0, 0, offset,
          0, 1, 0, 0, offset,
          0, 0, 1, 0, offset,
          0, 0, 0, 1, 0
        ]
      }));
    }

    return filters;
  };

  // 通知对象数量变化
  const notifyObjectCountChange = () => {
    if (!canvasInstance.current) return;
    const objectCount = canvasInstance.current.getObjects().length;
    onObjectCountChangeRef.current?.(objectCount);
  };

  // 性能优化相关
  const renderQueue = useRef<(() => void)[]>([]);
  const isRendering = useRef(false);
  const lastRenderTime = useRef(0);
  const RENDER_THROTTLE = 16; // 约60fps

  // 防抖函数
  const debounce = (func: Function, wait: number) => {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: any[]) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // 节流函数
  const throttle = (func: Function, limit: number) => {
    let inThrottle: boolean;
    return function executedFunction(...args: any[]) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  };

  // 批量渲染
  const batchRender = () => {
    if (!canvasInstance.current) return;

    const now = Date.now();
    if (now - lastRenderTime.current < RENDER_THROTTLE) {
      // 如果距离上次渲染时间太短，加入队列
      if (!isRendering.current) {
        requestAnimationFrame(() => {
          executeRenderQueue();
        });
      }
      return;
    }

    // 直接渲染
    executeRender();
  };

  // 执行渲染队列
  const executeRenderQueue = () => {
    if (!canvasInstance.current || renderQueue.current.length === 0) {
      isRendering.current = false;
      return;
    }

    isRendering.current = true;
    
    // 执行所有队列中的操作
    const operations = [...renderQueue.current];
    renderQueue.current = [];
    
    operations.forEach(op => op());
    
    // 渲染画布
    canvasInstance.current!.renderAll();
    lastRenderTime.current = Date.now();
    isRendering.current = false;
  };

  // 直接执行渲染
  const executeRender = () => {
    if (!canvasInstance.current) return;
    
    canvasInstance.current.renderAll();
    lastRenderTime.current = Date.now();
    
    // 更新性能监控
    performanceMonitor.update();
  };

  // 低分辨率预览模式
  const enableLowResolutionMode = () => {
    if (!canvasInstance.current) return;
    
    const canvas = canvasInstance.current;
    const originalWidth = canvas.width!;
    const originalHeight = canvas.height!;
    
    // 降低分辨率到50%
    canvas.setWidth(originalWidth * 0.5);
    canvas.setHeight(originalHeight * 0.5);
    canvas.setZoom(0.5);
    
    // 降低图片质量以提高性能
    canvas.getObjects().forEach(obj => {
      if (obj.type === 'image') {
        (obj as any).filters = [(obj as any).filters[0]]; // 只保留第一个滤镜
      }
    });
    
    canvas.renderAll();
  };

  // 恢复高分辨率模式
  const disableLowResolutionMode = () => {
    if (!canvasInstance.current) return;
    
    const canvas = canvasInstance.current;
    const originalWidth = canvas.width! * 2;
    const originalHeight = canvas.height! * 2;
    
    canvas.setWidth(originalWidth);
    canvas.setHeight(originalHeight);
    canvas.setZoom(1);
    
    // 恢复图片质量
    canvas.getObjects().forEach(obj => {
      if (obj.type === 'image') {
        // 恢复所有滤镜
        const img = obj as any;
        if (img._originalFilters) {
          img.filters = img._originalFilters;
        }
      }
    });
    
    canvas.renderAll();
  };

  // 性能监控
  const performanceMonitor = {
    frameCount: 0,
    lastFpsTime: Date.now(),
    currentFps: 60,
    lowPerformanceThreshold: 30, // FPS低于30时启用低分辨率模式
    
    update() {
      this.frameCount++;
      const now = Date.now();
      const deltaTime = now - this.lastFpsTime;
      
      if (deltaTime >= 1000) { // 每秒计算一次FPS
        this.currentFps = Math.round((this.frameCount * 1000) / deltaTime);
        this.frameCount = 0;
        this.lastFpsTime = now;
        
        // 根据性能调整渲染质量
        if (this.currentFps < this.lowPerformanceThreshold) {
          enableLowResolutionMode();
        } else if (this.currentFps > this.lowPerformanceThreshold + 10) {
          disableLowResolutionMode();
        }
      }
    },
    
    reset() {
      this.frameCount = 0;
      this.lastFpsTime = Date.now();
      this.currentFps = 60;
    }
  };

  const validateFrameBounds = (frame: fabric.Object): boolean => {
    if (!canvasInstance.current) return false;
    
    const canvas = canvasInstance.current;
    const minSize = 50; // 最小尺寸
    const maxSize = Math.min(canvas.width!, canvas.height!) * 0.8; // 最大尺寸
    
    // 使用缩放后的尺寸进行检查
    const scaledWidth = frame.getScaledWidth();
    const scaledHeight = frame.getScaledHeight();
    
    // 检查尺寸
    if (scaledWidth < minSize || scaledHeight < minSize) {
      console.warn(`[CanvasEditor] Frame scaled size too small: ${scaledWidth}x${scaledHeight}`);
      return false;
    }
    
    if (scaledWidth > maxSize || scaledHeight > maxSize) {
      console.warn(`[CanvasEditor] Frame scaled size too large: ${scaledWidth}x${scaledHeight}`);
      return false;
    }
    
    // 检查位置 - 使用getBoundingRect(true)考虑变换矩阵
    const bounds = frame.getBoundingRect(true);
    if (bounds.left < -scaledWidth || bounds.top < -scaledHeight ||
        bounds.left > canvas.width! || bounds.top > canvas.height!) {
      console.warn(`[CanvasEditor] Frame position out of bounds: ${bounds.left},${bounds.top}`);
      return false;
    }
    
    return true;
  };

  const validateImageBounds = (image: fabric.Object): boolean => {
    if (!canvasInstance.current) return false;
    
    const canvas = canvasInstance.current;
    const { selectedFrame } = editState;
    
    if (!selectedFrame) return true; // 没有相框时不限制
    
    // 使用缩放后的尺寸进行检查
    const scaledWidth = image.getScaledWidth();
    const scaledHeight = image.getScaledHeight();
    const minSize = 20; // 最小缩放后尺寸
    const maxSize = Math.max(canvas.width!, canvas.height!) * 2; // 最大缩放后尺寸
    
    // 确保图片缩放后不会太小
    if (scaledWidth < minSize || scaledHeight < minSize) {
      console.warn(`[CanvasEditor] Image scaled size too small: ${scaledWidth}x${scaledHeight}`);
      return false;
    }
    
    // 确保图片缩放后不会太大
    if (scaledWidth > maxSize || scaledHeight > maxSize) {
      console.warn(`[CanvasEditor] Image scaled size too large: ${scaledWidth}x${scaledHeight}`);
      return false;
    }
    
    // 使用getBoundingRect(true)考虑变换矩阵进行位置检查
    const bounds = image.getBoundingRect(true);
    
    return true;
  };

  // 获取相框-图片组合（增强版，支持重建后的稳定识别）
  const getFrameImagePair = (selectedObject: fabric.Object): { frame: fabric.Object | null, image: fabric.Image | null } => {
    if (!canvasInstance.current) return { frame: null, image: null };
    
    const canvas = canvasInstance.current;
    const objects = canvas.getObjects();
    
    console.log('[getFrameImagePair] 开始查找配对，选中对象类型:', selectedObject.type);
    
    // 如果选中的是相框
    if (selectedObject.type === 'circle' || selectedObject.type === 'rect') {
      const frame = selectedObject;
      
      // 优先使用新的ID系统 (__uid 和 _frameId)
      const frameUid = (frame as any).__uid;
      let image: fabric.Image | undefined;
      
      if (frameUid) {
        image = objects.find(obj => 
          obj.type === 'image' && 
          (obj as any)._frameId === frameUid
        ) as fabric.Image | undefined;
        
        if (image) {
          console.log('[getFrameImagePair] 通过新ID系统找到配对图片');
          return { frame, image };
        }
      }
      
      // 如果新ID系统找不到，尝试旧的ID系统 (id 和 frameId)
      const frameId = (frame as any).id;
      if (frameId) {
        image = objects.find(obj => 
          obj.type === 'image' && 
          (obj as any).frameId === frameId
        ) as fabric.Image | undefined;
        
        if (image) {
          console.log('[getFrameImagePair] 通过旧ID系统找到配对图片');
          return { frame, image };
        }
      }
      
      // 如果ID系统都找不到，尝试位置相邻检测（作为备用方案）
      const frameIndex = objects.indexOf(frame);
      if (frameIndex >= 0 && frameIndex < objects.length - 1) {
        const nextObj = objects[frameIndex + 1];
        if (nextObj.type === 'image') {
          console.log('[getFrameImagePair] 通过位置相邻检测找到可能的配对图片');
          return { frame, image: nextObj as fabric.Image };
        }
      }
      
      console.log('[getFrameImagePair] 未找到相框的配对图片');
      return { frame, image: null };
    }
    
    // 如果选中的是图片
    if (selectedObject.type === 'image') {
      const image = selectedObject as fabric.Image;
      
      // 优先使用新的ID系统
      let frameId = (image as any)._frameId;
      let frame: fabric.Object | undefined;
      
      if (frameId) {
        frame = objects.find(obj => 
          (obj.type === 'circle' || obj.type === 'rect') && 
          (obj as any).__uid === frameId
        );
        
        if (frame) {
          console.log('[getFrameImagePair] 通过新ID系统找到配对相框');
          return { frame, image };
        }
      }
      
      // 如果新ID系统找不到，尝试旧的ID系统
      frameId = (image as any).frameId;
      if (frameId) {
        frame = objects.find(obj => 
          (obj.type === 'circle' || obj.type === 'rect') && 
          (obj as any).id === frameId
        );
        
        if (frame) {
          console.log('[getFrameImagePair] 通过旧ID系统找到配对相框');
          return { frame, image };
        }
      }
      
      // 如果ID系统都找不到，尝试位置相邻检测（作为备用方案）
      const imageIndex = objects.indexOf(image);
      if (imageIndex > 0) {
        const prevObj = objects[imageIndex - 1];
        if (prevObj.type === 'circle' || prevObj.type === 'rect') {
          console.log('[getFrameImagePair] 通过位置相邻检测找到可能的配对相框');
          return { frame: prevObj, image };
        }
      }
      
      console.log('[getFrameImagePair] 未找到图片的配对相框');
      return { frame: null, image };
    }
    
    // 如果不是相框-图片组合，返回原对象
    console.log('[getFrameImagePair] 选中对象不是相框或图片');
    return { 
      frame: selectedObject.type === 'circle' || selectedObject.type === 'rect' ? selectedObject : null,
      image: selectedObject.type === 'image' ? selectedObject as fabric.Image : null
    };
  };

  // 组移动辅助函数：获取对象在画布中的索引
  const getObjectIndex = (obj: fabric.Object): number => {
    if (!canvasInstance.current) return -1;
    const objects = canvasInstance.current.getObjects();
    return objects.indexOf(obj);
  };

  // 组移动辅助函数：重新排列画布对象
  // ✅ 用 moveTo 重排；不要 clear()+add()
  const reorderCanvasObjects = (newOrder: fabric.Object[]) => {
    if (!canvasInstance.current) return;
    const canvas = canvasInstance.current;
    
    // 防御：把 newOrder 里没列到但仍在画布的对象补回
    const all = canvas.getObjects();
    const set = new Set(newOrder);
    const finalOrder = [...newOrder, ...all.filter(o => !set.has(o))];
    
    // 批量移动时先关掉逐项渲染
    const prev = canvas.renderOnAddRemove;
    canvas.renderOnAddRemove = false;
    
    finalOrder.forEach((obj, idx) => {
      canvas.moveTo(obj, idx); // 0 底部，越大越靠上
    });
    
    canvas.renderOnAddRemove = prev;
    canvas.requestRenderAll(); // 用 requestRenderAll
  };

  // 拿到一组要一起移动的对象（相框+图片 或 单个对象），保持它们的相对顺序
  const getStackGroup = (obj: fabric.Object): fabric.Object[] => {
    const { frame, image } = getFrameImagePair(obj);
    if (!canvasInstance.current) return [obj];
    if (frame && image) {
      const order = canvasInstance.current.getObjects();
      return [frame, image].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    return [obj];
  };

  // 把 group 这一"连续块"放到从 startIndex 开始的位置（保持 group 内相对顺序）
  const moveGroupTo = (group: fabric.Object[], startIndex: number) => {
    if (!canvasInstance.current) return;
    const canvas = canvasInstance.current;
    const order = canvas.getObjects().filter(o => !group.includes(o));
    const clamped = Math.max(0, Math.min(startIndex, order.length));
    const newOrder = [
      ...order.slice(0, clamped),
      ...group,
      ...order.slice(clamped),
    ];
    reorderCanvasObjects(newOrder);
  };

  const moveGroupBy = (group: fabric.Object[], delta: number) => {
    if (!canvasInstance.current) return;
    const order = canvasInstance.current.getObjects();
    const start = group.map(o => order.indexOf(o)).sort((a,b)=>a-b)[0];
    moveGroupTo(group, start + delta);
  };

  // ⬆️一层
  const moveGroupForward = (frame: fabric.Object, image: fabric.Image) =>
    moveGroupBy(getStackGroup(frame), +1);

  // ⬇️一层
  const moveGroupBackward = (frame: fabric.Object, image: fabric.Image) =>
    moveGroupBy(getStackGroup(frame), -1);

  // 置顶
  const moveGroupToFront = (frame: fabric.Object, image: fabric.Image) => {
    if (!canvasInstance.current) return;
    const group = getStackGroup(frame);
    const topIndex = canvasInstance.current.getObjects().length - group.length;
    moveGroupTo(group, topIndex);
  };

  // 置底
  const moveGroupToBack = (frame: fabric.Object, image: fabric.Image) =>
    moveGroupTo(getStackGroup(frame), 0);

// 自动重建配对函数：确保相框在下、图片在上、二者相邻
const rebuildFrameImagePairs = () => {
  if (!canvasInstance.current) return;
  
  console.log('[CanvasEditor] rebuildFrameImagePairs - 开始重建配对关系');
  
  const objects = canvasInstance.current.getObjects();
  const frames: fabric.Object[] = [];
  const images: fabric.Image[] = [];
  const others: fabric.Object[] = [];
  
  // 分类所有对象
  objects.forEach(obj => {
    if ((obj as any)._isFrame || (obj as any)._isEmptyFrame) {
      frames.push(obj);
    } else if ((obj as any)._isImage || (obj as any)._isFrameImage) {
      images.push(obj as fabric.Image);
    } else {
      others.push(obj);
    }
  });
  
  console.log('[CanvasEditor] rebuildFrameImagePairs - 找到', frames.length, '个相框，', images.length, '个图片');
  
  // 建立配对关系
  const pairs: Array<{frame: fabric.Object, image: fabric.Image}> = [];
  const usedFrames = new Set<fabric.Object>();
  const usedImages = new Set<fabric.Image>();
  
  // 首先通过新ID系统配对
  frames.forEach(frame => {
    if (usedFrames.has(frame)) return;
    
    const frameUid = (frame as any).__uid;
    if (frameUid) {
      const matchingImage = images.find(img => 
        !usedImages.has(img) && (img as any)._frameId === frameUid
      );
      if (matchingImage) {
        pairs.push({frame, image: matchingImage});
        usedFrames.add(frame);
        usedImages.add(matchingImage);
        console.log('[CanvasEditor] rebuildFrameImagePairs - 通过新ID配对:', frameUid);
      }
    }
  });
  
  // 然后通过旧ID系统配对
  frames.forEach(frame => {
    if (usedFrames.has(frame)) return;
    
    const frameId = (frame as any).id;
    if (frameId) {
      const matchingImage = images.find(img => 
        !usedImages.has(img) && (img as any).frameId === frameId
      );
      if (matchingImage) {
        pairs.push({frame, image: matchingImage});
        usedFrames.add(frame);
        usedImages.add(matchingImage);
        console.log('[CanvasEditor] rebuildFrameImagePairs - 通过旧ID配对:', frameId);
      }
    }
  });
  
  console.log('[CanvasEditor] rebuildFrameImagePairs - 成功配对', pairs.length, '组');
  
  // 重新排列对象：其他对象 + 配对组合（相框在下，图片在上）+ 未配对对象
  const newOrder: fabric.Object[] = [];
  
  // 添加其他对象（非相框非图片）
  newOrder.push(...others);
  
  // 添加配对的组合，确保相框在下、图片在上、二者相邻
  pairs.forEach(({frame, image}) => {
    newOrder.push(frame, image); // 相框在下，图片在上
  });
  
  // 添加未配对的相框
  frames.forEach(frame => {
    if (!usedFrames.has(frame)) {
      newOrder.push(frame);
    }
  });
  
  // 添加未配对的图片
  images.forEach(image => {
    if (!usedImages.has(image)) {
      newOrder.push(image);
    }
  });
  
  // 应用新的对象顺序
  // reorderCanvasObjects(newOrder); // 禁用此行，避免强制重排破坏用户自定义顺序
  
  console.log('[CanvasEditor] rebuildFrameImagePairs - 重建完成，配对信息已更新');
};

// 清理对象
  const cleanupObject = (obj: fabric.Object) => {
    if (!validateObject(obj, 'cleanupObject')) return;

    // 清理图片轮廓和边框
    const outline = (obj as any).outline;
    const imageBorder = (obj as any).imageBorder;
    const strokeOverlay = (obj as any)._strokeOverlay;
    if (outline && canvasInstance.current) {
      canvasInstance.current.remove(outline);
    }
    if (imageBorder && canvasInstance.current) {
      canvasInstance.current.remove(imageBorder);
    }
    if (strokeOverlay && canvasInstance.current) {
      canvasInstance.current.remove(strokeOverlay);
    }

    // 重置对象的选择样式
    obj.set({
      hasBorders: false,
      hasControls: false,
    });

    const displayObjectUrl = (obj as any)._displayObjectUrl;
    if (typeof displayObjectUrl === 'string' && displayObjectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(displayObjectUrl);
      (obj as any)._displayObjectUrl = null;
    }
  };

  // 生成唯一ID
  const generateUniqueId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // 获取相框中的图片 - 基于ID绑定
  const getImageInFrame = (frame: fabric.Object): fabric.Image | null => {
    if (!canvasInstance.current) return null;

    const frameId = (frame as any).__uid;
    if (!frameId) return null;

    const objects = canvasInstance.current.getObjects();
    return objects.find(obj => {
      if (!isImageObject(obj)) return false;
      const img = obj as fabric.Image;
      return (img as any)._frameId === frameId && (img as any)._isFrameImage;
    }) as fabric.Image | null;
  };

  // 获取图片所属的相框 - 基于ID绑定
  const getFrameOfImage = (image: fabric.Image): fabric.Object | null => {
    if (!canvasInstance.current) return null;

    const imageFrameId = (image as any)._frameId;
    if (!imageFrameId) return null;

    const objects = canvasInstance.current.getObjects();
    return objects.find(obj => {
      if (!isFrameObject(obj)) return false;
      return (obj as any).__uid === imageFrameId;
    }) || null;
  };



  // 判断是否为相框对象
  const isFrameObject = (obj: fabric.Object): boolean => {
    return !!(obj as any)._isFrame;
  };

  // 判断是否为图片对象
  const isImageObject = (obj: fabric.Object): boolean => {
    return obj.type === 'image' || !!(obj as any)._isImage;
  };

  // 判断是否为相框图片
  const isFrameImage = (obj: fabric.Object): boolean => {
    return isImageObject(obj) && !!(obj as any)._isFrameImage;
  };

  const isTextObject = (obj: fabric.Object | null | undefined): obj is fabric.IText => {
    if (!obj) return false;
    return obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox';
  };

  const isFreeImage = (obj: fabric.Object): obj is fabric.Image => {
    return isImageObject(obj) && !isFrameImage(obj) && !(obj as any)._frameId;
  };

  const getImageSource = (image: fabric.Image): string | null => {
    const src = (image as any).getSrc?.() || (image as any)._originalElement?.src;
    if (src) return src;
    try {
      return image.toDataURL({ format: 'png' });
    } catch {
      return null;
    }
  };

  const notifyPendingUploadsChange = () => {
    onPendingUploadsChangeRef.current?.(pendingUploadsRef.current);
  };

  const getImageIntrinsicSize = (image: fabric.Image) => {
    const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | null;
    const naturalWidth = Number((image as any)._assetNaturalWidth)
      || (element instanceof HTMLImageElement ? element.naturalWidth : 0)
      || (element instanceof HTMLCanvasElement ? element.width : 0)
      || Number(image.width)
      || 0;
    const naturalHeight = Number((image as any)._assetNaturalHeight)
      || (element instanceof HTMLImageElement ? element.naturalHeight : 0)
      || (element instanceof HTMLCanvasElement ? element.height : 0)
      || Number(image.height)
      || 0;
    return {
      naturalWidth: Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 0,
      naturalHeight: Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : 0,
    };
  };

  const syncRelativeCropProps = (image: fabric.Image | Record<string, any>) => {
    const naturalWidth = Number((image as any)._assetNaturalWidth) || 0;
    const naturalHeight = Number((image as any)._assetNaturalHeight) || 0;
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
      return;
    }
    const rawCropX = Number((image as any).cropX) || 0;
    const rawCropY = Number((image as any).cropY) || 0;
    const clampedCropX = Math.min(Math.max(0, rawCropX), Math.max(0, naturalWidth - 1));
    const clampedCropY = Math.min(Math.max(0, rawCropY), Math.max(0, naturalHeight - 1));
    const maxWidth = Math.max(1, naturalWidth - clampedCropX);
    const maxHeight = Math.max(1, naturalHeight - clampedCropY);
    const rawWidth = Math.max(1, Number((image as any).width) || naturalWidth);
    const rawHeight = Math.max(1, Number((image as any).height) || naturalHeight);
    const width = Math.min(maxWidth, rawWidth);
    const height = Math.min(maxHeight, rawHeight);
    const epsX = Math.max(1e-6, naturalWidth * 0.001);
    const epsY = Math.max(1e-6, naturalHeight * 0.001);
    const isUncropped = Math.abs(clampedCropX) <= epsX
      && Math.abs(clampedCropY) <= epsY
      && Math.abs(width - naturalWidth) <= epsX
      && Math.abs(height - naturalHeight) <= epsY;
    (image as any).cropX = clampedCropX;
    (image as any).cropY = clampedCropY;
    (image as any).width = width;
    (image as any).height = height;
    if (isUncropped) {
      (image as any)._cropXRatio = 0;
      (image as any)._cropYRatio = 0;
      (image as any)._cropWidthRatio = 1;
      (image as any)._cropHeightRatio = 1;
      return;
    }
    (image as any)._cropXRatio = clampedCropX / naturalWidth;
    (image as any)._cropYRatio = clampedCropY / naturalHeight;
    (image as any)._cropWidthRatio = width / naturalWidth;
    (image as any)._cropHeightRatio = height / naturalHeight;
  };

  const applyRelativeCropProps = (image: Record<string, any>) => {
    const naturalWidth = Number(image._assetNaturalWidth) || 0;
    const naturalHeight = Number(image._assetNaturalHeight) || 0;
    const cropWidthRatio = Number(image._cropWidthRatio);
    const cropHeightRatio = Number(image._cropHeightRatio);
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
      return;
    }
    if (!Number.isFinite(cropWidthRatio) || !Number.isFinite(cropHeightRatio)) {
      return;
    }
    const cropXRatio = Number(image._cropXRatio) || 0;
    const cropYRatio = Number(image._cropYRatio) || 0;
    image.cropX = Math.max(0, cropXRatio * naturalWidth);
    image.cropY = Math.max(0, cropYRatio * naturalHeight);
    image.width = Math.max(1, cropWidthRatio * naturalWidth);
    image.height = Math.max(1, cropHeightRatio * naturalHeight);
  };

  const assignUploadedAssetToImage = (image: fabric.Image, imagePath: string) => {
    const normalizedPath = normalizeImageAssetPath(imagePath);
    (image as any)._assetOriginalPath = buildImageVariantPath(normalizedPath, 'original');
    (image as any)._assetEditorPath = buildImageVariantPath(normalizedPath, 'medium');
    (image as any)._assetThumbPath = buildImageVariantPath(normalizedPath, 'thumb');
    (image as any)._assetUploadStatus = 'synced';
  };

  const markImageAsLocal = (image: fabric.Image) => {
    const { naturalWidth, naturalHeight } = getImageIntrinsicSize(image);
    if (naturalWidth > 0) {
      (image as any)._assetNaturalWidth = naturalWidth;
    }
    if (naturalHeight > 0) {
      (image as any)._assetNaturalHeight = naturalHeight;
    }
    (image as any)._assetUploadStatus = 'local';
    syncRelativeCropProps(image);
  };

  const syncNaturalSizeAndRelativeCropProps = (image: fabric.Image) => {
    const { naturalWidth, naturalHeight } = getImageIntrinsicSize(image);
    if (naturalWidth > 0) {
      (image as any)._assetNaturalWidth = naturalWidth;
    }
    if (naturalHeight > 0) {
      (image as any)._assetNaturalHeight = naturalHeight;
    }
    syncRelativeCropProps(image);
  };

  const normalizeImageObjectForSerialization = (node: Record<string, any>) => {
    const sourceCandidate = node._assetOriginalPath || node._assetEditorPath || node._assetThumbPath || node.src || node._src;
    const normalizedPath = normalizeImageAssetPath(String(sourceCandidate || ''));
    if (normalizedPath && !normalizedPath.startsWith('data:') && !normalizedPath.startsWith('blob:')) {
      node._assetOriginalPath = buildImageVariantPath(normalizedPath, 'original');
      node._assetEditorPath = buildImageVariantPath(normalizedPath, 'medium');
      node._assetThumbPath = buildImageVariantPath(normalizedPath, 'thumb');
      node.src = node._assetEditorPath;
      node._src = node._assetEditorPath;
    }
    syncRelativeCropProps(node);
  };

  const normalizeCanvasJsonForLoad = (canvasJson: Record<string, any>) => {
    const objects = Array.isArray(canvasJson?.objects) ? canvasJson.objects : [];
    objects.forEach((node: Record<string, any>) => {
      if (!(node?._isImage || node?._isFrameImage || node?.type === 'image')) {
        return;
      }
      const sourceCandidate = node._assetOriginalPath || node._assetEditorPath || node._assetThumbPath || node.src || node._src;
      const normalizedPath = normalizeImageAssetPath(String(sourceCandidate || ''));
      if (normalizedPath && !normalizedPath.startsWith('data:') && !normalizedPath.startsWith('blob:')) {
        node._assetOriginalPath = buildImageVariantPath(normalizedPath, 'original');
        node._assetEditorPath = buildImageVariantPath(normalizedPath, 'medium');
        node._assetThumbPath = buildImageVariantPath(normalizedPath, 'thumb');
        node.src = resolveCanvasAssetUrl(buildImageUrl(node._assetEditorPath));
        node._src = node.src;
      } else if (typeof node.src === 'string') {
        node.src = resolveCanvasAssetUrl(node.src);
        node._src = node.src;
      }
      applyRelativeCropProps(node);
      node._assetUploadStatus = node._assetUploadStatus || (node._assetOriginalPath ? 'synced' : undefined);
    });
    return canvasJson;
  };

  const hasUnsyncedImagesInternal = () => {
    if (!canvasInstance.current) return false;
    return canvasInstance.current.getObjects().some((obj) => {
      if (!isImageObject(obj)) return false;
      if ((obj as any)._isStrokeOverlay) return false;
      const uploadStatus = String((obj as any)._assetUploadStatus || '');
      if (uploadStatus === 'generated') return false;
      if (uploadStatus === 'uploading' || uploadStatus === 'failed' || uploadStatus === 'local') {
        return true;
      }
      const src = getImageSource(obj as fabric.Image) || '';
      return src.startsWith('data:');
    });
  };

  const getFramePlacementData = (frame: fabric.Object, imageWidth: number, imageHeight: number) => {
    const safeWidth = imageWidth > 0 ? imageWidth : 100;
    const safeHeight = imageHeight > 0 ? imageHeight : 100;
    const width = frame.getScaledWidth();
    const height = frame.getScaledHeight();
    const rx = width / 2;
    const ry = height / 2;
    const scaleX = width / safeWidth;
    const scaleY = height / safeHeight;
    const scale = Math.max(scaleX, scaleY);
    return {
      left: frame.left || 0,
      top: frame.top || 0,
      scale,
      angle: frame.angle || 0,
      width,
      height,
      rx,
      ry,
    };
  };

  const createFrameClipPath = (
    frame: fabric.Object,
    placement: ReturnType<typeof getFramePlacementData>
  ): fabric.Object => {
    if ((frame as any)._frameType === 'rect') {
      return new fabric.Rect({
        width: placement.width,
        height: placement.height,
        left: placement.left,
        top: placement.top,
        originX: 'center',
        originY: 'center',
        absolutePositioned: true,
        angle: placement.angle,
      });
    }
    return new fabric.Ellipse({
      rx: placement.rx,
      ry: placement.ry,
      left: placement.left,
      top: placement.top,
      originX: 'center',
      originY: 'center',
      absolutePositioned: true,
      angle: placement.angle,
    });
  };

  const clearDragPreview = () => {
    const previewImage = dragPreviewImageRef.current;
    if (previewImage && canvasInstance.current) {
      cleanupObject(previewImage);
      canvasInstance.current.remove(previewImage);
    }
    dragPreviewImageRef.current = null;

    const sourceImage = dragPreviewSourceImageRef.current;
    if (sourceImage) {
      const originalOpacity = dragPreviewSourceOpacityRef.current;
      sourceImage.set({ opacity: originalOpacity ?? 1 });
      sourceImage.setCoords();
    }
    dragPreviewSourceImageRef.current = null;
    dragPreviewSourceOpacityRef.current = null;

    const frame = dragHoverFrameRef.current;
    if (frame) {
      const originalOpacity = (frame as any)._dragPreviewOpacity;
      frame.set({ opacity: originalOpacity ?? 1 });
      delete (frame as any)._dragPreviewOpacity;
      frame.setCoords();
      canvasInstance.current?.requestRenderAll();
    }
    dragHoverFrameRef.current = null;
  };

  const setDragPreview = (frame: fabric.Object | null, sourceImage: fabric.Image | null) => {
    if (dragHoverFrameRef.current === frame) return;
    clearDragPreview();
    if (!frame || !sourceImage || !canvasInstance.current) return;
    const canvas = canvasInstance.current;
    dragPreviewSourceImageRef.current = sourceImage;
    dragPreviewSourceOpacityRef.current = sourceImage.opacity ?? 1;
    sourceImage.set({ opacity: 0 });
    sourceImage.setCoords();
    dragHoverFrameRef.current = frame;
    (frame as any)._dragPreviewOpacity = frame.opacity ?? 1;
    frame.set({ opacity: 0.7 });
    frame.setCoords();
    const frameAtStart = frame;
    const sourceAtStart = sourceImage;
    sourceImage.clone((cloned) => {
      if (!canvasInstance.current) return;
      if (dragHoverFrameRef.current !== frameAtStart) return;
      if (draggingImageRef.current !== sourceAtStart) return;

      const previewImage = cloned as fabric.Image;
      const placement = getFramePlacementData(
        frameAtStart,
        previewImage.width || sourceAtStart.width || 100,
        previewImage.height || sourceAtStart.height || 100
      );

      previewImage.set({
        left: placement.left,
        top: placement.top,
        scaleX: placement.scale,
        scaleY: placement.scale,
        angle: placement.angle,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        opacity: 0.85,
        excludeFromExport: true,
      });

      (previewImage as any)._isDragPreview = true;
      previewImage.clipPath = createFrameClipPath(frameAtStart, placement);

      const frameIndex = canvas.getObjects().indexOf(frameAtStart);
      if (frameIndex !== -1) {
        canvas.insertAt(previewImage, frameIndex + 1, false);
      } else {
        canvas.add(previewImage);
      }

      dragPreviewImageRef.current = previewImage;
      canvas.requestRenderAll();
    });
    canvas.requestRenderAll();
  };

  const findFrameForDraggingImage = (image: fabric.Image) => {
    if (!canvasInstance.current) return null;
    const isFrameDroppable = (frame: fabric.Object) => {
      if (frame.visible === false) return false;
      frame.setCoords();
      const width = frame.getScaledWidth();
      const height = frame.getScaledHeight();
      return Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1;
    };

    const isImageCenterInsideFrame = (sourceImage: fabric.Image, frame: fabric.Object) => {
      sourceImage.setCoords();
      frame.setCoords();
      const imageCenter = sourceImage.getCenterPoint();
      const frameTransformMatrix = frame.calcTransformMatrix();
      const invertedFrameMatrix = fabric.util.invertTransform(frameTransformMatrix);
      const localPoint = fabric.util.transformPoint(imageCenter, invertedFrameMatrix);
      const epsilon = 0.001;
      const frameType = (frame as any)._frameType;

      if (frameType === 'rect') {
        const halfWidth = Math.max(((frame as any).width || 0) / 2, epsilon);
        const halfHeight = Math.max(((frame as any).height || 0) / 2, epsilon);
        return (
          Math.abs(localPoint.x) <= halfWidth + epsilon &&
          Math.abs(localPoint.y) <= halfHeight + epsilon
        );
      }

      const halfWidth = Math.max(((frame as any).width || 0) / 2, epsilon);
      const halfHeight = Math.max(((frame as any).height || 0) / 2, epsilon);
      const normalizedX = localPoint.x / halfWidth;
      const normalizedY = localPoint.y / halfHeight;
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1 + epsilon;
    };

    const objects = canvasInstance.current.getObjects();
    const imageIndex = objects.indexOf(image);
    if (imageIndex === -1) return null;
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i];
      if (!isFrameObject(obj)) continue;
      if (imageIndex <= i) continue;
      if (!isFrameDroppable(obj)) continue;
      if (isImageCenterInsideFrame(image, obj)) {
        return obj;
      }
    }
    return null;
  };

  const applyUnselectedVisuals = (obj: fabric.Object) => {
    if (isFrameObject(obj)) {
      if ((obj as any)._isEmptyFrame) {
        obj.set({
          hasBorders: false,
          hasControls: false,
          borderColor: 'transparent',
          borderDashArray: undefined,
          stroke: '#93c5fd',
          strokeWidth: 2,
          fill: 'rgba(59, 130, 246, 0.08)',
        });
      } else {
        obj.set({
          hasBorders: false,
          hasControls: false,
          borderColor: 'transparent',
          borderDashArray: undefined,
          stroke: 'transparent',
          strokeWidth: 0,
          fill: 'transparent',
        });
      }
    }

    if (isImageObject(obj)) {
      obj.set({
        hasBorders: false,
        hasControls: false,
        borderColor: 'transparent',
        borderDashArray: undefined,
        stroke: 'transparent',
        strokeWidth: 0,
      });
    }
  };

  const clearUnselectedVisuals = (except?: fabric.Object | null) => {
    if (!canvasInstance.current) return;
    const objects = canvasInstance.current.getObjects();
    objects.forEach((obj) => {
      if (except && obj === except) return;
      applyUnselectedVisuals(obj);
    });
  };

  const copyCustomProps = (source: fabric.Object, target: fabric.Object) => {
    CANVAS_CUSTOM_PROPS.forEach((prop) => {
      if ((source as any)[prop] !== undefined) {
        (target as any)[prop] = (source as any)[prop];
      }
    });
  };

  const cloneObjectWithCustomProps = (source: fabric.Object) =>
    new Promise<fabric.Object>((resolve) => {
      source.clone((cloned) => {
        copyCustomProps(source, cloned);
        resolve(cloned);
      }, ['curve', 'path']);
    });

  const updateFrameImageClipPath = (image: fabric.Image, frame: fabric.Object) => {
    const frameType = (frame as any)._frameType;
    const left = frame.left || 0;
    const top = frame.top || 0;
    if (frameType === 'rect') {
      const width = frame.getScaledWidth();
      const height = frame.getScaledHeight();
      if (image.clipPath && image.clipPath.type === 'rect') {
        image.clipPath.set({
          width,
          height,
          left,
          top,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
        });
      } else {
        image.clipPath = new fabric.Rect({
          width,
          height,
          left,
          top,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
        });
      }
    } else {
      const rx = frame.getScaledWidth() / 2;
      const ry = frame.getScaledHeight() / 2;
      if (image.clipPath && image.clipPath.type === 'ellipse') {
        image.clipPath.set({
          rx,
          ry,
          left,
          top,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
        });
      } else {
        image.clipPath = new fabric.Ellipse({
          rx,
          ry,
          left,
          top,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
        });
      }
    }
  };

  const ARC_RADIUS_MIN = 80;
  const ARC_RADIUS_MAX = 800;
  const ARC_BASE_FONT_SIZE = 40;

  const getArcRadius = (curve: number, fontSize: number) => {
    const abs = Math.min(100, Math.max(0, Math.abs(curve)));
    const t = abs / 100;
    const baseRadius = ARC_RADIUS_MAX - (ARC_RADIUS_MAX - ARC_RADIUS_MIN) * t;
    const scale = (fontSize || ARC_BASE_FONT_SIZE) / ARC_BASE_FONT_SIZE;
    return Math.max(10, baseRadius * scale);
  };

  const buildCirclePath = (radius: number, clockwise: boolean) => {
    const sweep = clockwise ? 1 : 0;
    const d = `M 0,0 m -${radius},0 a ${radius},${radius} 0 1,${sweep} ${radius * 2},0 a ${radius},${radius} 0 1,${sweep} -${radius * 2},0`;
    return new fabric.Path(d, {
      visible: false,
      fill: '',
      stroke: ''
    });
  };

  // 智能选择可操作的对象
  const findOperableObject = (): fabric.Object | null => {
    if (!canvasInstance.current) return null;
    
    const objects = canvasInstance.current.getObjects();
    if (objects.length === 0) return null;
    
    // 优先级1: 查找可选择的对象（从最上层开始）
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.visible !== false && obj.selectable !== false) {
        console.log('[CanvasEditor] findOperableObject - 找到可选择对象:', obj);
        return obj;
      }
    }
    
    // 优先级2: 查找相框对象（相框通常应该可操作）
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.visible !== false && isFrameObject(obj)) {
        console.log('[CanvasEditor] findOperableObject - 找到相框对象:', obj);
        return obj;
      }
    }
    
    // 优先级3: 查找任何可见对象
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.visible !== false) {
        console.log('[CanvasEditor] findOperableObject - 找到可见对象:', obj);
        return obj;
      }
    }
    
    console.log('[CanvasEditor] findOperableObject - 没有找到可操作的对象');
    return null;
  };

  const addImageFromUrl = (url: string, sourceName?: string) => {
    if (!canvasInstance.current) return;

    fabric.Image.fromURL(url, (img) => {
      const originalWidth = img.width || 0;
      const originalHeight = img.height || 0;
      const fitData = calculateImageFitToCanvas(originalWidth, originalHeight);

      img.set({
        left: fitData.left,
        top: fitData.top,
        scaleX: fitData.scale,
        scaleY: fitData.scale,
        angle: 0,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        _isImage: true,
        _imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
        _imageStrokeSettings: { ...DEFAULT_IMAGE_STROKE_SETTINGS },
      });
      if (sourceName) {
        (img as any)._sourceName = sourceName;
      }

      canvasInstance.current?.add(img);
      canvasInstance.current?.renderAll();
      canvasInstance.current?.setActiveObject(img);
      onSelectionChangeRef.current?.(img);
      notifyObjectCountChange();
    }, { crossOrigin: 'anonymous' });
  };

  const loadImageObjectFromUrl = (url: string, sourceName?: string) => {
    return new Promise<fabric.Image>((resolve, reject) => {
      if (!canvasInstance.current) {
        reject(new Error('画布未初始化'));
        return;
      }

      fabric.Image.fromURL(url, (img) => {
        if (!img) {
          reject(new Error('图片加载失败'));
          return;
        }
        const originalWidth = img.width || 0;
        const originalHeight = img.height || 0;
        const fitData = calculateImageFitToCanvas(originalWidth, originalHeight);

        img.set({
          left: fitData.left,
          top: fitData.top,
          scaleX: fitData.scale,
          scaleY: fitData.scale,
          angle: 0,
          selectable: true,
          hasControls: true,
          hasBorders: true,
          _isImage: true,
          _imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
          _imageStrokeSettings: { ...DEFAULT_IMAGE_STROKE_SETTINGS },
        });
        if (sourceName) {
          (img as any)._sourceName = sourceName;
        }
        markImageAsLocal(img);

        canvasInstance.current?.add(img);
        canvasInstance.current?.renderAll();
        canvasInstance.current?.setActiveObject(img);
        onSelectionChangeRef.current?.(img);
        notifyObjectCountChange();
        resolve(img);
      }, {
        crossOrigin: 'anonymous',
        onError: () => reject(new Error('图片加载失败'))
      } as any);
    });
  };

  const replaceImageSourcePreservingDisplay = (image: fabric.Image, nextUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const displayedWidth = image.getScaledWidth();
      const displayedHeight = image.getScaledHeight();
      const previousScaleX = Number(image.scaleX) || 1;
      const previousScaleY = Number(image.scaleY) || 1;
      const previousNaturalWidth = Number((image as any)._assetNaturalWidth) || Number(image.width) || 0;
      const previousNaturalHeight = Number((image as any)._assetNaturalHeight) || Number(image.height) || 0;
      const previousCropX = Math.max(0, Number(image.cropX) || 0);
      const previousCropY = Math.max(0, Number(image.cropY) || 0);
      const previousCropWidth = Math.max(1, Number(image.width) || previousNaturalWidth || 1);
      const previousCropHeight = Math.max(1, Number(image.height) || previousNaturalHeight || 1);
      const hasSavedRatios = Number.isFinite(Number((image as any)._cropWidthRatio))
        && Number.isFinite(Number((image as any)._cropHeightRatio));
      const ratioCropX = hasSavedRatios
        ? Number((image as any)._cropXRatio) || 0
        : (previousNaturalWidth > 0 ? previousCropX / previousNaturalWidth : 0);
      const ratioCropY = hasSavedRatios
        ? Number((image as any)._cropYRatio) || 0
        : (previousNaturalHeight > 0 ? previousCropY / previousNaturalHeight : 0);
      const ratioCropWidth = hasSavedRatios
        ? Number((image as any)._cropWidthRatio)
        : (previousNaturalWidth > 0 ? previousCropWidth / previousNaturalWidth : 1);
      const ratioCropHeight = hasSavedRatios
        ? Number((image as any)._cropHeightRatio)
        : (previousNaturalHeight > 0 ? previousCropHeight / previousNaturalHeight : 1);
      const isUncroppedBeforeSwitch = previousNaturalWidth > 0
        && previousNaturalHeight > 0
        && previousCropX <= 0.001
        && previousCropY <= 0.001
        && Math.abs(previousCropWidth - previousNaturalWidth) <= Math.max(1, previousNaturalWidth * 0.001)
        && Math.abs(previousCropHeight - previousNaturalHeight) <= Math.max(1, previousNaturalHeight * 0.001);
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('图片加载超时'));
      }, 12000);
      const finalizeResolve = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const finalizeReject = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      };
      image.setSrc(nextUrl, () => {
        const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | null;
        const sourceNaturalWidth = element instanceof HTMLImageElement
          ? (element.naturalWidth || element.width || 0)
          : (element instanceof HTMLCanvasElement ? element.width : 0);
        const sourceNaturalHeight = element instanceof HTMLImageElement
          ? (element.naturalHeight || element.height || 0)
          : (element instanceof HTMLCanvasElement ? element.height : 0);
        const safeNaturalWidth = Math.max(1, sourceNaturalWidth || Number(image.width) || previousCropWidth || 1);
        const safeNaturalHeight = Math.max(1, sourceNaturalHeight || Number(image.height) || previousCropHeight || 1);
        (image as any)._assetNaturalWidth = safeNaturalWidth;
        (image as any)._assetNaturalHeight = safeNaturalHeight;
        if (isUncroppedBeforeSwitch) {
          image.cropX = 0;
          image.cropY = 0;
          image.width = safeNaturalWidth;
          image.height = safeNaturalHeight;
        } else {
          const minCropWidthRatio = 1 / safeNaturalWidth;
          const minCropHeightRatio = 1 / safeNaturalHeight;
          const clampedCropWidthRatio = Math.min(1, Math.max(minCropWidthRatio, Number.isFinite(ratioCropWidth) ? ratioCropWidth : 1));
          const clampedCropHeightRatio = Math.min(1, Math.max(minCropHeightRatio, Number.isFinite(ratioCropHeight) ? ratioCropHeight : 1));
          const nextCropWidth = Math.max(1, clampedCropWidthRatio * safeNaturalWidth);
          const nextCropHeight = Math.max(1, clampedCropHeightRatio * safeNaturalHeight);
          const maxCropX = Math.max(0, safeNaturalWidth - nextCropWidth);
          const maxCropY = Math.max(0, safeNaturalHeight - nextCropHeight);
          const nextCropX = Math.min(maxCropX, Math.max(0, (Number.isFinite(ratioCropX) ? ratioCropX : 0) * safeNaturalWidth));
          const nextCropY = Math.min(maxCropY, Math.max(0, (Number.isFinite(ratioCropY) ? ratioCropY : 0) * safeNaturalHeight));
          image.cropX = nextCropX;
          image.cropY = nextCropY;
          image.width = nextCropWidth;
          image.height = nextCropHeight;
        }
        const nextWidth = Math.max(1, Number(image.width) || safeNaturalWidth);
        const nextHeight = Math.max(1, Number(image.height) || safeNaturalHeight);
        const scaleSignX = previousScaleX >= 0 ? 1 : -1;
        const scaleSignY = previousScaleY >= 0 ? 1 : -1;
        image.set({
          scaleX: scaleSignX * (displayedWidth / nextWidth),
          scaleY: scaleSignY * (displayedHeight / nextHeight),
        });
        syncNaturalSizeAndRelativeCropProps(image);
        image.setCoords();
        image.canvas?.requestRenderAll();
        finalizeResolve();
      }, {
        crossOrigin: 'anonymous',
        onError: () => finalizeReject(new Error('图片加载失败')),
      } as any);
    });
  };

  // 简化为直接使用 URL 切换图片源，避免前端 fetch → blob → objectURL 的重资源路径

  const appendRetryToken = (url: string, token: string) => {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}retry=${encodeURIComponent(token)}`;
  };

  const syncImageObjectToUploadedAsset = async (image: fabric.Image, imagePath: string, taskId?: string) => {
    assignUploadedAssetToImage(image, imagePath);
    const mediumUrl = resolveCanvasAssetUrl(buildImageUrl((image as any)._assetEditorPath));
    const originalUrl = resolveCanvasAssetUrl(buildImageUrl((image as any)._assetOriginalPath));
    try {
      await replaceImageSourcePreservingDisplay(image, mediumUrl);
      return {
        usedOriginalFallback: false,
      };
    } catch (mediumError) {
      console.warn('[CanvasEditor] 代理图加载失败，直接回退原图:', mediumError);
      await replaceImageSourcePreservingDisplay(image, appendRetryToken(originalUrl, `${Date.now()}`));
      return {
        usedOriginalFallback: true,
      };
    }
  };

  const readFileAsDataUrl = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result !== 'string' || !result) {
          reject(new Error('读取本地图片失败'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error('读取本地图片失败'));
      reader.readAsDataURL(file);
    });
  };

  const handleExternalImageFiles = async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length === 0) return;
    const toastTaskIds = images.map((file, index) => createUploadToastItem(file, index));

    for (let index = 0; index < images.length; index += 1) {
      const file = images[index];
      const taskId = toastTaskIds[index];
      try {
        await insertImageFile(file, null, taskId);
      } catch (error) {
        console.error('画布图片上传失败:', error);
        alert(error instanceof Error ? error.message : '图片上传失败');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    handleExternalImageFiles(files);
  };

  const copySelectedObject = () => {
    if (!canvasInstance.current) return;
    const activeObject = canvasInstance.current.getActiveObject();
    if (!activeObject) return;

    if (activeObject.type === 'activeSelection') {
      const selection = activeObject as fabric.ActiveSelection;
      const expanded = new Set<fabric.Object>();
      selection.getObjects().forEach((obj) => {
        expanded.add(obj);
        if (isFrameObject(obj)) {
          const image = getImageInFrame(obj);
          if (image) expanded.add(image);
        }
        if (isFrameImage(obj)) {
          const frame = getFrameOfImage(obj as fabric.Image);
          if (frame) expanded.add(frame);
        }
      });
      copyBufferRef.current = { objects: Array.from(expanded) };
      return;
    }

    if (isFrameObject(activeObject) || isFrameImage(activeObject)) {
      const { frame, image } = getFrameImagePair(activeObject);
      if (frame && image) {
        copyBufferRef.current = { objects: [frame, image] };
        return;
      }
      if (frame) {
        copyBufferRef.current = { objects: [frame] };
        return;
      }
    }

    copyBufferRef.current = { objects: [activeObject] };
  };

  const pasteCopiedObjects = async () => {
    if (!canvasInstance.current || !copyBufferRef.current) return;
    const canvas = canvasInstance.current;
    const sourceObjects = copyBufferRef.current.objects;
    const offset = 20;

    const clonedObjects = await Promise.all(
      sourceObjects.map((obj) => cloneObjectWithCustomProps(obj))
    );

    const frameIdMap = new Map<string, string>();
    const pendingFrameImages: Array<{ image: fabric.Image; originalFrameId?: string }> = [];

    clonedObjects.forEach((cloned, index) => {
      const source = sourceObjects[index];
      cloned.set({
        left: (source.left || 0) + offset,
        top: (source.top || 0) + offset,
      });

      if (isFrameObject(cloned)) {
        const oldFrameId = (source as any).__uid;
        const newFrameId = generateUniqueId();
        (cloned as any).__uid = newFrameId;
        (cloned as any)._imageId = null;
        if (oldFrameId) frameIdMap.set(oldFrameId, newFrameId);
      }

      if (isImageObject(cloned) && (cloned as any)._isFrameImage) {
        const originalFrameId = (source as any)._frameId;
        (cloned as any).__uid = generateUniqueId();
        pendingFrameImages.push({ image: cloned as fabric.Image, originalFrameId });
      }

      if ((source as any).__uid && !isFrameObject(cloned) && !(cloned as any)._isFrameImage) {
        (cloned as any).__uid = generateUniqueId();
      }
    });

    clonedObjects.forEach((obj) => canvas.add(obj));

    pendingFrameImages.forEach(({ image, originalFrameId }) => {
      if (originalFrameId && frameIdMap.has(originalFrameId)) {
        const newFrameId = frameIdMap.get(originalFrameId)!;
        (image as any)._frameId = newFrameId;
        const frame = canvas.getObjects().find(obj => isFrameObject(obj) && (obj as any).__uid === newFrameId) as fabric.Object | undefined;
        if (frame) {
          (frame as any)._isEmptyFrame = false;
          (frame as any)._imageId = (image as any).__uid;
          updateFrameImageClipPath(image, frame);
        }
      } else {
        (image as any)._isFrameImage = false;
        (image as any)._frameId = undefined;
        (image as any)._isImage = true;
      }
    });

    if (clonedObjects.length > 1) {
      const selection = new fabric.ActiveSelection(clonedObjects, { canvas });
      canvas.setActiveObject(selection);
    } else if (clonedObjects[0]) {
      canvas.setActiveObject(clonedObjects[0]);
    }

    canvas.requestRenderAll();
    setSelectedObject(canvas.getActiveObject() as fabric.Object | null);
    props.onSelectionChange?.(canvas.getActiveObject() as fabric.Object | null);
    notifyObjectCountChange();
    saveStateToHistory();
  };

  // 选择创建事件
  const handleSelectionCreated = (e: fabric.IEvent) => {
    const target = e.target;
    if (!target) return;

    if (suppressSelectionCallbacksRef.current) {
      suppressSelectionCallbacksRef.current = false;
      clearUnselectedVisuals(target);
      setSelectedObject(target);
      canvasInstance.current?.requestRenderAll();
      return;
    }

    console.log('[CanvasEditor] Selection Created:', target.type, target);
    clearUnselectedVisuals(target);

    if (isTextObject(target)) {
      setEditState({
        mode: 'text',
        selectedFrame: null,
        selectedImage: null,
        selectedText: target as fabric.IText,
        isDragging: false
      });
      props.onEditModeChange?.('text', target);
      setSelectedObject(target);
      onSelectionChangeRef.current?.(target);
      return;
    }

    if (isFreeImage(target)) {
      target.set({
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        borderColor: '#3b82f6',
        borderDashArray: undefined,
        borderScaleFactor: 2,
        cornerColor: '#3b82f6',
        cornerSize: 8,
        cornerStyle: 'circle',
        transparentCorners: false,
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: false,
      });
      setEditState({
        mode: null,
        selectedFrame: null,
        selectedImage: target as fabric.Image,
        selectedText: null,
        isDragging: false,
      });
      props.onEditModeChange?.(null, target);
      setSelectedObject(target);
      onSelectionChangeRef.current?.(target);
      canvasInstance.current?.renderAll();
      return;
    }

    // 点击相框内图片或相框本身时，统一进入相框编辑模式
    if (isFrameImage(target)) {
      const frameOfImage = getFrameOfImage(target as fabric.Image);
      if (frameOfImage) {
        canvasInstance.current!.discardActiveObject();
        canvasInstance.current!.setActiveObject(frameOfImage);
        enterFrameEditMode(frameOfImage);
        canvasInstance.current!.renderAll();
        setSelectedObject(frameOfImage);
        onSelectionChangeRef.current?.(frameOfImage);
        return;
      }
    }

    // 正常的相框选择 → 相框编辑
    if (isFrameObject(target)) {
      enterFrameEditMode(target);
    }

    // 对于相框-图片组合，确保选择事件传递的是当前选中的对象
    // 但图层操作会同时处理整个组合
    setSelectedObject(target || null);
    onSelectionChangeRef.current?.(target || null);
  };

  // 选择更新事件
  const handleSelectionUpdated = (e: fabric.IEvent) => {
    handleSelectionCreated(e);
  };

  // 选择清除事件
  const handleSelectionCleared = (e: fabric.IEvent) => {
    // 检查是否是被用户主动取消选中的（deselected），而不是因为点击了其他对象导致的清除
    // fabric.js 在点击空白处时会触发 selection:cleared
    
    // 如果有选中的对象，且该对象是波浪文字，不要重置层级
    if (e.deselected && e.deselected.length > 0) {
      const deselectedObj = e.deselected[0];
      if ((deselectedObj as any).isWaveGroup) {
         // 波浪文字不需要特殊处理，保持原位即可
      }
    }

    exitEditMode();
    setSelectedObject(null);
    onSelectionChangeRef.current?.(null);
    clearUnselectedVisuals();
    
    // 失焦时重建配对关系，确保相框在下、图片在上、二者相邻
    rebuildFrameImagePairs();
  };

  // 鼠标按下事件
  const handleMouseDown = (e: fabric.IEvent) => {
    setEditState(prev => ({ ...prev, isDragging: true }));
    const target = e.target;
    setShowBackgroundControl(!target);

    if (formatBrushRef.current.active) {
      if (!canvasInstance.current || !e.e) return;
      if (target && applyFormatBrushToObject(target)) {
        clearFormatBrush();
        return;
      }
      if (!target) {
        const pointer = canvasInstance.current.getPointer(e.e);
        beginFormatBrushSelection(new fabric.Point(pointer.x, pointer.y));
        return;
      }
      return;
    }

    if (editStateRef.current.mode === 'crop') {
      const cropZone = canvasInstance.current?.getObjects().find(obj => (obj as any)._isCropZone);
      if (!cropZone || target !== cropZone) {
        confirmCrop();
        return;
      }
    }

    if (target && isFreeImage(target)) {
      draggingImageRef.current = target;
    } else {
      draggingImageRef.current = null;
    }

    // 修复空相框点击无法调整大小的问题
    if (target && isFrameObject(target) && (target as any)._isEmptyFrame) {
      // 如果点击的是空相框，且当前不在编辑模式或控件未启用，强制进入编辑模式
      if (editStateRef.current.mode !== 'frame' || !target.hasControls) {
        enterFrameEditMode(target);
        return;
      }
    }

    if (editStateRef.current.mode === 'image' && target) {
      const frameTarget = isFrameObject(target)
        ? target
        : isFrameImage(target)
        ? getFrameOfImage(target as fabric.Image)
        : null;
      if (frameTarget) {
        canvasInstance.current?.discardActiveObject();
        canvasInstance.current?.setActiveObject(frameTarget);
        enterFrameEditMode(frameTarget);
        canvasInstance.current?.renderAll();
        return;
      }
    }

    if (isTextObject(target)) {
      canvasInstance.current?.setActiveObject(target);
      setEditState({
        mode: 'text',
        selectedFrame: null,
        selectedImage: null,
        selectedText: target as fabric.IText,
        isDragging: false
      });
      props.onEditModeChange?.('text', target);
      setSelectedObject(target);
      onSelectionChangeRef.current?.(target);
      return;
    }

    if (target && isFrameObject(target) && (editStateRef.current.mode === 'frame' || editStateRef.current.mode === 'image')) {
      const img = getImageInFrame(target);
      if (img) {
        (target as any)._imgOffsetX = (img.left || 0) - (target.left || 0);
        (target as any)._imgOffsetY = (img.top  || 0) - (target.top  || 0);
      }
    }

    if (target && (isFrameObject(target) || isFrameImage(target) || isFreeImage(target))) {
      const frameTarget = isFrameObject(target)
        ? target
        : isFrameImage(target)
        ? getFrameOfImage(target as fabric.Image)
        : null;
      const emitTarget = frameTarget || target;
      onSelectionChangeRef.current?.(emitTarget);
    }
  };

  // 鼠标移动事件
  const handleMouseMove = (e: fabric.IEvent) => {
    if (formatBrushRef.current.active && formatBrushSelectionRef.current.dragging && canvasInstance.current && e.e) {
      const pointer = canvasInstance.current.getPointer(e.e);
      updateFormatBrushSelection(new fabric.Point(pointer.x, pointer.y));
      return;
    }
    if (!draggingImageRef.current || !canvasInstance.current || !e.e) return;
    const hoverFrame = findFrameForDraggingImage(draggingImageRef.current);
    setDragPreview(hoverFrame, draggingImageRef.current);
  };

  // 鼠标释放事件
  const handleMouseUp = (e: fabric.IEvent) => {
    setEditState(prev => ({ ...prev, isDragging: false }));
    if (formatBrushRef.current.active && formatBrushSelectionRef.current.dragging) {
      finishFormatBrushSelection();
      return;
    }
    if (!draggingImageRef.current || !canvasInstance.current) {
      clearDragPreview();
      return;
    }

    const image = draggingImageRef.current;
    const hoverFrame = dragHoverFrameRef.current || findFrameForDraggingImage(image);
    clearDragPreview();
    draggingImageRef.current = null;

    if (!hoverFrame) {
      return;
    }
    if (!isFreeImage(image)) {
      window.alert('该图片已在相框中，不能拖拽到其他相框');
      return;
    }

    try {
      const assetEditorPath = (image as any)._assetEditorPath;
      const src = typeof assetEditorPath === 'string' && assetEditorPath
        ? resolveCanvasAssetUrl(buildImageUrl(assetEditorPath))
        : getImageSource(image);
      if (!src) {
        window.alert('图片资源不可用，无法拖拽到相框');
        return;
      }
      canvasInstance.current.remove(image);
      const sourceName = (image as any)._sourceName;
      void placeImageInFrame(src, hoverFrame, sourceName, image);
    } catch (error) {
      console.error('[CanvasEditor] 拖拽图片到相框失败:', error);
      window.alert('拖拽失败，请重试');
    }
  };

  // 右键菜单处理函数
  const handleContextMenu = (e: fabric.IEvent) => {
    e.e.preventDefault(); // 阻止浏览器默认右键菜单
    
    const target = e.target;
    let operableTarget = target;
    
    // 如果没有直接点击到对象，尝试查找可操作的对象
    if (!operableTarget && canvasInstance.current) {
      operableTarget = findOperableObject();
    }
    
    // 只有在有可操作对象时才显示右键菜单
    if (operableTarget && canvasInstance.current && 
        (operableTarget.selectable !== false || operableTarget.type === 'image')) {
      
      // 获取画布容器的位置信息
      const canvasContainer = canvasRef.current?.parentElement;
      const containerRect = canvasContainer?.getBoundingClientRect();
      
      // 计算相对于画布容器的位置
      const menuX = containerRect ? e.e.clientX - containerRect.left : e.e.clientX;
      const menuY = containerRect ? e.e.clientY - containerRect.top : e.e.clientY;
      
      console.log('[CanvasEditor] 右键菜单 - 目标对象:', operableTarget, '位置:', { x: menuX, y: menuY });
      
      setContextMenu({
        visible: true,
        x: menuX,
        y: menuY,
        targetObject: operableTarget
      });
      
      // 确保目标对象被选中
      canvasInstance.current.setActiveObject(operableTarget);
      canvasInstance.current.renderAll();
    }
  };

  // 隐藏右键菜单
  const hideContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  // 添加全局点击监听器来隐藏右键菜单
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (contextMenu.visible) {
        hideContextMenu();
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleGlobalClick);
    }

    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [contextMenu.visible]);

  // 内部图层操作函数
  const performBringForward = () => {
    if (!canvasInstance.current) return;
    
    rebuildFrameImagePairs();
    let activeObject = canvasInstance.current.getActiveObject();
    
    if (!activeObject) {
      activeObject = findOperableObject();
    }
    
    if (activeObject) {
      const { frame, image } = getFrameImagePair(activeObject);
      
      if (frame && image) {
        moveGroupForward(frame, image);
      } else {
        canvasInstance.current.bringForward(activeObject);
        canvasInstance.current.renderAll();
      }
      
      if (!activeObject.selectable) {
        activeObject.set({ selectable: true, evented: true });
      }
      
      canvasInstance.current.setActiveObject(activeObject);
      canvasInstance.current.renderAll();
    }
  };

  const performSendBackwards = () => {
    if (!canvasInstance.current) return;
    
    rebuildFrameImagePairs();
    let activeObject = canvasInstance.current.getActiveObject();
    
    if (!activeObject) {
      activeObject = findOperableObject();
    }
    
    if (activeObject) {
      const { frame, image } = getFrameImagePair(activeObject);
      
      if (frame && image) {
         moveGroupBackward(frame, image);
       } else {
        canvasInstance.current.sendBackwards(activeObject);
        canvasInstance.current.renderAll();
      }
      
      if (!activeObject.selectable) {
        activeObject.set({ selectable: true, evented: true });
      }
      
      canvasInstance.current.setActiveObject(activeObject);
      canvasInstance.current.renderAll();
    }
  };

  const performBringToFront = () => {
    if (!canvasInstance.current) return;
    
    rebuildFrameImagePairs();
    let activeObject = canvasInstance.current.getActiveObject();
    
    if (!activeObject) {
      activeObject = findOperableObject();
    }
    
    if (activeObject) {
      const { frame, image } = getFrameImagePair(activeObject);
      
      if (frame && image) {
        moveGroupToFront(frame, image);
      } else {
        canvasInstance.current.bringToFront(activeObject);
        canvasInstance.current.renderAll();
      }
      
      if (!activeObject.selectable) {
        activeObject.set({ selectable: true, evented: true });
      }
      
      canvasInstance.current.setActiveObject(activeObject);
      canvasInstance.current.renderAll();
    }
  };

  const performSendToBack = () => {
    if (!canvasInstance.current) return;
    
    rebuildFrameImagePairs();
    let activeObject = canvasInstance.current.getActiveObject();
    
    if (!activeObject) {
      activeObject = findOperableObject();
    }
    
    if (activeObject) {
      const { frame, image } = getFrameImagePair(activeObject);
      
      if (frame && image) {
        moveGroupToBack(frame, image);
      } else {
        canvasInstance.current.sendToBack(activeObject);
        canvasInstance.current.renderAll();
      }
      
      if (!activeObject.selectable) {
        activeObject.set({ selectable: true, evented: true });
      }
      
      canvasInstance.current.setActiveObject(activeObject);
      canvasInstance.current.renderAll();
    }
  };

  // 右键菜单项点击处理
  const handleContextMenuAction = (action: string) => {
    const target = contextMenu.targetObject;
    if (!target || !canvasInstance.current) return;
    
    console.log('[CanvasEditor] 执行右键菜单操作:', action, '目标对象:', target);
    
    // 确保目标对象被选中
    canvasInstance.current.setActiveObject(target);
    
    // 执行对应的图层操作
    switch (action) {
      case 'bringForward':
        performBringForward();
        break;
      case 'sendBackwards':
        performSendBackwards();
        break;
      case 'bringToFront':
        performBringToFront();
        break;
      case 'sendToBack':
        performSendToBack();
        break;
    }
    
    // 隐藏菜单
    hideContextMenu();
  };

  // 对象变换事件
  const handleObjectModified = (e: fabric.IEvent) => {
    const target = e.target;
    if (!validateObject(target, 'handleObjectModified')) return;

    try {
      // 根据对象类型进行边界检查
      if (isFrameObject(target)) {
        if (!validateFrameBounds(target)) {
          // 如果边界检查失败，撤销这次变换
          historyManagerRef.current.undo();
          return;
        }
      } else if (isImageObject(target)) {
        if (!validateImageBounds(target)) {
          // 如果边界检查失败，撤销这次变换
          historyManagerRef.current.undo();
          return;
        }
      }

      // 同步裁剪路径和高亮对象
      if (isFrameObject(target)) {
        syncClipPathOnTransform(target);
        syncFrameRotationToImage(target);
        // 使用原生选择样式，无需额外同步
      }

      // 更新图片编辑模式的视觉反馈
      if (editStateRef.current.mode === 'image' && editStateRef.current.selectedImage === target) {
        updateImageEditModeVisuals();
      }

      // 保存状态到历史
      saveStateToHistory();
    } catch (error) {
      console.error('[CanvasEditor] Error in handleObjectModified:', error);
      // 发生错误时撤销这次变换
      historyManagerRef.current.undo();
    }
  };

  // 对象缩放事件 - 使用节流优化
  const handleObjectScaling = (e: fabric.IEvent) => {
    const target = e.target;
    if (!validateObject(target, 'handleObjectScaling')) return;

    try {
      // 实时同步相框裁剪路径、图片缩放和高亮对象
      if (isFrameObject(target)) {
        syncClipPathOnTransform(target);
        // 使用原生选择样式，无需额外同步
      }

      // 实时更新图片编辑模式的视觉反馈
      if (editStateRef.current.mode === 'image' && editStateRef.current.selectedImage === target) {
        updateImageEditModeVisuals();
      }

      // 在图片编辑模式下，如果缩放的是相框，也需要同步裁剪路径
      if (editStateRef.current.mode === 'image' && isFrameObject(target) && target === editStateRef.current.selectedFrame) {
        syncClipPathOnTransform(target);
      }

      // 同步 imageBorder
      if (isImageObject(target)) {
        syncImageBorder(target);
        syncImageStrokeOverlay(target as fabric.Image);
      }
    } catch (error) {
      console.error('[CanvasEditor] Error in handleObjectScaling:', error);
    }
  };

  // 对象旋转事件 - 使用节流优化
  const handleObjectRotating = (e: fabric.IEvent) => {
    const target = e.target;
    if (!validateObject(target, 'handleObjectRotating')) return;

    try {
      if (isFrameObject(target)) {
        syncFrameRotationToImage(target);
        syncClipPathOnTransform(target);
      }

      // 实时更新图片编辑模式的视觉反馈
      if (editStateRef.current.mode === 'image' && editStateRef.current.selectedImage === target) {
        updateImageEditModeVisuals();
      }

      // 同步 imageBorder
      if (isImageObject(target)) {
        syncImageBorder(target);
        syncImageStrokeOverlay(target as fabric.Image);
      }
    } catch (error) {
      console.error('[CanvasEditor] Error in handleObjectRotating:', error);
    }
  };

  // 处理对象移动 - 使用节流优化
  const handleObjectMoving = (e: fabric.IEvent) => {
    const obj = e.target;
    if (!validateObject(obj, 'handleObjectMoving')) return;

    try {
      if (isFreeImage(obj as fabric.Object) && draggingImageRef.current === obj) {
        const hoverFrame = findFrameForDraggingImage(obj as fabric.Image);
        setDragPreview(hoverFrame, obj as fabric.Image);
      }

      if (isFrameObject(obj)) {
        // 在相框编辑模式或图片编辑模式下，都需要让图片跟随相框移动
        if (editStateRef.current.mode === 'frame' || editStateRef.current.mode === 'image') {
          const img = getImageInFrame(obj);
          if (img) {
            const ox = (obj as any)._imgOffsetX ?? 0;
            const oy = (obj as any)._imgOffsetY ?? 0;
            img.set({
              left: (obj.left || 0) + ox,
              top:  (obj.top  || 0) + oy,
            });
            img.setCoords();
            
            // 同步图片的 border
            syncImageBorder(img);
            syncImageStrokeOverlay(img);
          }
        }
        // 裁剪中心同步
        syncClipPathOnTransform(obj);
      } else if (isImageObject(obj)) {
        // 图片编辑模式下更新视觉反馈
        if (editStateRef.current.mode === 'image' && editStateRef.current.selectedImage === obj) {
          updateImageEditModeVisuals();
        }
        // 同步图片的 border
        syncImageBorder(obj);
        syncImageStrokeOverlay(obj as fabric.Image);
      }
    } catch (error) {
      console.error('[CanvasEditor] Error in handleObjectMoving:', error);
    }
  };

  // 双击事件防抖
  const lastDoubleClickTime = useRef(0);
  const DOUBLE_CLICK_DEBOUNCE = 300; // 300ms 防抖

  // 双击事件处理 - 实现模式切换和空相框上传
  const handleDoubleClick = (e: fabric.IEvent) => {
    const now = Date.now();
    
    // 防抖检查
    if (now - lastDoubleClickTime.current < DOUBLE_CLICK_DEBOUNCE) {
      console.log('[CanvasEditor] 双击事件被防抖忽略');
      return;
    }
    lastDoubleClickTime.current = now;

    console.log('[CanvasEditor] 双击事件触发');
    if (!canvasInstance.current) {
      console.log('[CanvasEditor] 画布实例不存在');
      return;
    }

    const target = e.target;
    console.log('[CanvasEditor] 双击目标:', target);
    if (!target) {
      console.log('[CanvasEditor] 没有双击目标');
      return;
    }

    try {
      console.log('[CanvasEditor] 目标对象属性:', {
        _isFrame: (target as any)._isFrame,
        _isEmptyFrame: (target as any)._isEmptyFrame,
        _frameType: (target as any)._frameType,
        type: target.type,
        selectable: target.selectable,
        evented: target.evented
      });

      // 1) 双击"相框"：如果已放图 → 进入图片编辑；如果是空相框 → 打开上传
      if (isFrameObject(target)) {
        console.log('[CanvasEditor] 识别为相框对象');
        if ((target as any)._isEmptyFrame) {
          console.log('[CanvasEditor] 空相框，触发文件上传');
          triggerFileUpload(target);
          return;
        }
        const img = getImageInFrame(target);
        if (img) {
          console.log('[CanvasEditor] 相框有图片，进入图片编辑模式');
          enterImageEditMode(img);
        }
        return;
      }

      // 2) 双击"相框图片"：同样进入图片编辑
      if (isFrameImage(target)) {
        console.log('[CanvasEditor] 识别为相框图片，进入图片编辑模式');
        enterImageEditMode(target as fabric.Image);
        return;
      }

      // 3) 双击"自由图片"：进入裁剪模式
      if (isFreeImage(target)) {
        console.log('[CanvasEditor] 识别为自由图片，进入裁剪模式');
        enterCropMode(target as fabric.Image);
        return;
      }
    } catch (error) {
      console.error('[CanvasEditor] Error in handleDoubleClick:', error);
    }
  };

  // 防重复触发的状态
  const isUploadingRef = useRef(false);

  // 触发文件上传对话框
  const triggerFileUpload = (frame: fabric.Object) => {
    console.log('[CanvasEditor] triggerFileUpload 被调用，相框:', frame);
    
    // 防重复触发检查
    if (isUploadingRef.current) {
      console.log('[CanvasEditor] 文件上传已在进行中，忽略重复触发');
      return;
    }
    
    if (!canvasInstance.current) {
      console.log('[CanvasEditor] 画布实例不存在，无法触发文件上传');
      return;
    }

    // 设置上传状态
    isUploadingRef.current = true;

    // 创建隐藏的文件输入框
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    console.log('[CanvasEditor] 文件输入框已创建');

    // 处理文件选择
    fileInput.onchange = (event) => {
      console.log('[CanvasEditor] 文件选择事件触发');
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      
      if (file) {
        console.log('[CanvasEditor] 选择的文件:', file.name);
        uploadImageToFrame(file, frame);
      } else {
        console.log('[CanvasEditor] 没有选择文件');
      }
      
      // 清理文件输入框和重置状态
      document.body.removeChild(fileInput);
      isUploadingRef.current = false;
      console.log('[CanvasEditor] 文件输入框已清理，上传状态已重置');
    };

    // 处理取消选择（ESC键或点击取消）
    fileInput.oncancel = () => {
      console.log('[CanvasEditor] 文件选择被取消');
      document.body.removeChild(fileInput);
      isUploadingRef.current = false;
      console.log('[CanvasEditor] 文件输入框已清理，上传状态已重置');
    };

    // 添加到DOM并触发点击
    document.body.appendChild(fileInput);
    console.log('[CanvasEditor] 文件输入框已添加到DOM');
    fileInput.click();
    console.log('[CanvasEditor] 文件输入框点击事件已触发');
  };

  // 修改uploadImageToFrame函数以支持传入相框参数
  const inheritImageAssetFromSource = (targetImage: fabric.Image, sourceImage?: fabric.Image | null) => {
    if (!sourceImage) {
      markImageAsLocal(targetImage);
      return;
    }

    const sourceAny = sourceImage as any;
    const targetAny = targetImage as any;
    const sourceStatus = String(sourceAny._assetUploadStatus || '');
    const sourceOriginalPath = typeof sourceAny._assetOriginalPath === 'string' ? sourceAny._assetOriginalPath : '';
    const sourceEditorPath = typeof sourceAny._assetEditorPath === 'string' ? sourceAny._assetEditorPath : '';
    const sourceThumbPath = typeof sourceAny._assetThumbPath === 'string' ? sourceAny._assetThumbPath : '';
    const sourceNaturalWidth = Number(sourceAny._assetNaturalWidth) || 0;
    const sourceNaturalHeight = Number(sourceAny._assetNaturalHeight) || 0;
    const sourceCropX = Number(sourceImage.cropX) || 0;
    const sourceCropY = Number(sourceImage.cropY) || 0;
    const sourceCropWidth = Number(sourceImage.width) || 0;
    const sourceCropHeight = Number(sourceImage.height) || 0;

    if (sourceOriginalPath) {
      targetAny._assetOriginalPath = sourceOriginalPath;
    }
    if (sourceEditorPath) {
      targetAny._assetEditorPath = sourceEditorPath;
    }
    if (sourceThumbPath) {
      targetAny._assetThumbPath = sourceThumbPath;
    }
    if (sourceNaturalWidth > 0) {
      targetAny._assetNaturalWidth = sourceNaturalWidth;
    }
    if (sourceNaturalHeight > 0) {
      targetAny._assetNaturalHeight = sourceNaturalHeight;
    }
    if (Number.isFinite(sourceCropX)) {
      targetImage.cropX = sourceCropX;
    }
    if (Number.isFinite(sourceCropY)) {
      targetImage.cropY = sourceCropY;
    }
    if (sourceCropWidth > 0) {
      targetImage.width = sourceCropWidth;
    }
    if (sourceCropHeight > 0) {
      targetImage.height = sourceCropHeight;
    }
    if (sourceStatus === 'synced') {
      targetAny._assetUploadStatus = 'synced';
    } else if (sourceStatus) {
      targetAny._assetUploadStatus = sourceStatus;
    } else if (sourceOriginalPath || sourceEditorPath) {
      targetAny._assetUploadStatus = 'synced';
    } else {
      markImageAsLocal(targetImage);
      return;
    }
    syncRelativeCropProps(targetImage);
  };

  const placeImageInFrame = (url: string, selectedFrame: fabric.Object, sourceName?: string, sourceImage?: fabric.Image | null) => {
    return new Promise<fabric.Image>((resolve, reject) => {
      fabric.Image.fromURL(url, (img) => {
        if (!img) {
          reject(new Error('图片加载失败'));
          return;
        }
        const sourceCropWidth = Number(sourceImage?.width) || 0;
        const sourceCropHeight = Number(sourceImage?.height) || 0;
        const placement = getFramePlacementData(
          selectedFrame,
          sourceCropWidth > 0 ? sourceCropWidth : (img.width || 100),
          sourceCropHeight > 0 ? sourceCropHeight : (img.height || 100)
        );

      // 确保相框有唯一ID
      if (!(selectedFrame as any).__uid) {
        (selectedFrame as any).__uid = generateUniqueId();
      }

      // 生成图片唯一ID
      const imageId = generateUniqueId();

      const frameAngle = placement.angle;

      const oldImage = getImageInFrame(selectedFrame);
      const inheritedAdjustments = (oldImage as any)?._imageAdjustments || (selectedFrame as any)._imageAdjustments || { ...DEFAULT_IMAGE_ADJUSTMENTS };
      const inheritedStroke = (oldImage as any)?._imageStrokeSettings || (selectedFrame as any)._imageStrokeSettings || { ...DEFAULT_IMAGE_STROKE_SETTINGS };

      // 设置图片属性 - 确保图片在相框中心位置
      img.set({
        left: placement.left,
        top: placement.top,
        scaleX: placement.scale,
        scaleY: placement.scale,
        angle: frameAngle,
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: true,
        hasBorders: true,
        _isFrameImage: true,
        _imageAdjustments: inheritedAdjustments,
        _imageStrokeSettings: inheritedStroke,
        // 保存原始缩放比例，用于相框缩放时的同步计算
        _originalScale: placement.scale,
        // 建立强绑定关系
        __uid: imageId,
        _frameId: (selectedFrame as any).__uid,
      });
      if (sourceName) {
        (img as any)._sourceName = sourceName;
      }
        inheritImageAssetFromSource(img, sourceImage);

      // 在相框中记录图片ID
      (selectedFrame as any)._imageId = imageId;
      (selectedFrame as any)._lastSyncedAngle = frameAngle;

      img.clipPath = createFrameClipPath(selectedFrame, placement);

      // 移除旧图片和提示文字
      const originalIndex = canvasInstance.current?.getObjects().indexOf(selectedFrame);
      
      if (oldImage) {
        cleanupObject(oldImage);
        canvasInstance.current?.remove(oldImage);
      }

      // 添加新图片并保持层级关系
      if (originalIndex !== undefined && originalIndex !== -1) {
        // 图片应该紧贴在相框上面
        canvasInstance.current?.insertAt(img, originalIndex + 1, false);
      } else {
        canvasInstance.current?.add(img);
      }

      // 更新相框状态
      (selectedFrame as any)._isEmptyFrame = false;

      // 清理相框高亮效果（解决蓝色虚线残留问题）
      setFrameSelectionStyle(selectedFrame, false);

      // 上传成功后进入相框编辑模式，让用户可以立即调整相框大小
      canvasInstance.current?.setActiveObject(selectedFrame);
      enterFrameEditMode(selectedFrame);
      onSelectionChangeRef.current?.(selectedFrame);

      // 保存状态到历史
      saveStateToHistory();

      applyImageAdjustmentsInternal(img, inheritedAdjustments, true);
      applyImageStrokeInternal(img, inheritedStroke, true);

      canvasInstance.current?.renderAll();
      
      // 通知对象数量变化
        notifyObjectCountChange();
        resolve(img);
      }, {
        crossOrigin: 'anonymous',
        onError: () => reject(new Error('图片加载失败'))
      } as any);
    });
  };

  const addImageToFrame = (url: string, targetFrame?: fabric.Object, sourceName?: string) => {
    if (!canvasInstance.current) return;

    // 使用传入的相框或当前选中的相框
    const selectedFrame = targetFrame || editState.selectedFrame;
    if (!selectedFrame || !isFrameObject(selectedFrame)) {
      alert('请先选择一个相框');
      return;
    }

    void placeImageInFrame(url, selectedFrame, sourceName);
  };

  const insertImageFile = async (file: File, targetFrame?: fabric.Object | null, uploadTaskId?: string) => {
    if (!canvasInstance.current) return;
    const taskId = uploadTaskId || createUploadToastItem(file, 0);
    startUploadProgress(taskId);
    const sourceName = file.name.replace(/\.[^/.]+$/, '');
    let uploadCounterIncreased = false;
    try {
      const localUrl = await readFileAsDataUrl(file);
      const selectedFrame = targetFrame || canvasInstance.current.getActiveObject();
      let insertedImage: fabric.Image;

      if (selectedFrame && isFrameObject(selectedFrame)) {
        insertedImage = await placeImageInFrame(localUrl, selectedFrame, sourceName);
      } else {
        insertedImage = await loadImageObjectFromUrl(localUrl, sourceName);
      }

      pendingUploadsRef.current += 1;
      uploadCounterIncreased = true;
      notifyPendingUploadsChange();
      (insertedImage as any)._assetUploadStatus = 'uploading';
      const uploaded = await uploadAPI.uploadImage(file) as { imagePath?: string };
      const imagePath = typeof uploaded?.imagePath === 'string' ? uploaded.imagePath : '';
      if (!imagePath) {
        throw new Error('上传成功但未返回图片地址');
      }
      setUploadProcessing(taskId);
      const syncResult = await syncImageObjectToUploadedAsset(insertedImage, imagePath, taskId);
      if (syncResult.usedOriginalFallback) {
        finishUploadFallbackWarning(taskId, '已自动回退原图，建议稍后重试上传以恢复代理图');
      } else {
        finishUploadSuccess(taskId);
      }
    } catch (error) {
      finishUploadFailed(taskId, error instanceof Error ? error.message : '未知错误');
      throw error;
    } finally {
      if (uploadCounterIncreased) {
        pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1);
        notifyPendingUploadsChange();
      }
    }
  };

  const uploadImageToFrame = (file: File, targetFrame?: fabric.Object) => {
    if (!canvasInstance.current) return;

    const selectedFrame = targetFrame || editState.selectedFrame;
    if (!selectedFrame || !isFrameObject(selectedFrame)) {
      alert('请先选择一个相框');
      return;
    }

    void insertImageFile(file, selectedFrame).catch((error) => {
      console.error('相框图片上传失败:', error);
      alert(error instanceof Error ? error.message : '图片上传失败');
    });
  };

  // 在相框变换时同步裁剪路径
  const syncClipPathOnTransform = (frame: fabric.Object) => {
    if (!validateObject(frame, 'syncClipPathOnTransform')) return;

    const image = getImageInFrame(frame);
    if (!image) return;

    try {
      // 更新图片的裁剪路径和缩放比例
      updateFrameClipPath(frame, image);
      
      // 强制重新渲染
      canvasInstance.current?.renderAll();
    } catch (error) {
      console.error('[CanvasEditor] Error in syncClipPathOnTransform:', error);
    }
  };

  // 更新相框裁剪路径 - 只改变裁剪区域，不移动图片
  const updateFrameClipPath = (frame: fabric.Object, image: fabric.Image) => {
    if (!validateObject(frame, 'updateFrameClipPath')) return;
    if (!validateObject(image, 'updateFrameClipPath')) return;

    try {
      const frameType = (frame as any)._frameType;

      const frameAngle = frame.angle || 0;

      if (frameType === 'circle') {
        const centerX = frame.left || 0;
        const centerY = frame.top || 0;

        // 使用getScaledWidth/Height避免重复缩放
        const rx = frame.getScaledWidth() / 2;
        const ry = frame.getScaledHeight() / 2;

        // 创建新的椭圆裁剪路径 - 只更新裁剪区域的形状和位置
        const clipPath = new fabric.Ellipse({
          rx: rx,
          ry: ry,
          left: centerX,
          top: centerY,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
          angle: frameAngle,
        });

        // 只更新裁剪路径，不改变图片的位置和缩放
        image.clipPath = clipPath;

        // 相框变形时，图片保持原有的位置和缩放不变
        // 只有裁剪区域（透明与不透明区域）会发生变化
        console.log('[CanvasEditor] 相框变形：只更新裁剪路径，图片位置和缩放保持不变');
      } else if (frameType === 'rect') {
        const centerX = frame.left || 0;
        const centerY = frame.top || 0;
        const width = frame.getScaledWidth();
        const height = frame.getScaledHeight();

        const clipPath = new fabric.Rect({
          width: width,
          height: height,
          left: centerX,
          top: centerY,
          originX: 'center',
          originY: 'center',
          absolutePositioned: true,
          angle: frameAngle,
        });

        image.clipPath = clipPath;
      }
    } catch (error) {
      console.error('[CanvasEditor] Error in updateFrameClipPath:', error);
    }
  };

  const syncFrameRotationToImage = (frame: fabric.Object) => {
    const image = getImageInFrame(frame);
    if (!image) return;

    const frameAngle = frame.angle || 0;
    const lastAngle = (frame as any)._lastSyncedAngle;
    if (lastAngle !== undefined && frameAngle === lastAngle) return;

    const frameCenterX = frame.left || 0;
    const frameCenterY = frame.top || 0;
    const imageCenterX = image.left || 0;
    const imageCenterY = image.top || 0;

    const deltaAngle = (lastAngle !== undefined ? frameAngle - lastAngle : 0);
    if (deltaAngle !== 0) {
      const radians = fabric.util.degreesToRadians(deltaAngle);
      const offsetX = imageCenterX - frameCenterX;
      const offsetY = imageCenterY - frameCenterY;
      const rotatedX = offsetX * Math.cos(radians) - offsetY * Math.sin(radians);
      const rotatedY = offsetX * Math.sin(radians) + offsetY * Math.cos(radians);
      image.set({
        left: frameCenterX + rotatedX,
        top: frameCenterY + rotatedY,
      });
    }

    image.set({ angle: frameAngle });
    if (image.clipPath) {
      image.clipPath.set({ angle: frameAngle });
    }
    image.setCoords();
    syncImageStrokeOverlay(image);
    (frame as any)._lastSyncedAngle = frameAngle;
  };

  // 进入裁剪模式
  const enterCropMode = (image: fabric.Image) => {
    if (!canvasInstance.current) return;
    
    // 保存状态到历史
    saveStateToHistory();
    
    // 设置编辑状态
    setEditState({
      mode: 'crop',
      selectedFrame: null,
      selectedImage: image,
      selectedText: null,
      isDragging: false,
    });

    canvasInstance.current.defaultCursor = 'pointer';
    canvasInstance.current.hoverCursor = 'pointer';
    
    // 禁用图片的选择和事件，由裁剪框接管交互
    image.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      opacity: 0.5 // 降低不透明度，作为背景参考
    });
    
    // 创建裁剪框
    // 初始大小和位置与图片一致（考虑当前的裁剪情况）
    // 注意：这里的图片已经是经过 scaling 和 positioning 的
    // 我们需要在图片当前可视区域上创建一个矩形
    
    const cropRect = new fabric.Rect({
      left: image.left,
      top: image.top,
      width: image.getScaledWidth(),
      height: image.getScaledHeight(),
      angle: image.angle,
      fill: 'transparent',
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      cornerColor: '#3b82f6',
      cornerSize: 10,
      transparentCorners: false,
      originX: image.originX, // 通常是 'center'
      originY: image.originY,
      selectable: true,
      hasControls: true,
      hasBorders: true,
      lockRotation: true, // 暂不支持旋转裁剪框，需保持与图片一致
    });

    cropRect.hoverCursor = 'move';
    cropRect.moveCursor = 'move';
    
    // 标记为临时裁剪框，避免被序列化或错误处理
    (cropRect as any)._isCropZone = true;
    (cropRect as any)._targetImageId = (image as any).__uid || (image as any).id;
    
    canvasInstance.current.add(cropRect);
    canvasInstance.current.setActiveObject(cropRect);
    canvasInstance.current.renderAll();
    
    // 通知父组件
    props.onEditModeChange?.('crop', image);
    
    console.log('[CanvasEditor] 进入裁剪模式', { image, cropRect });
  };

  // 确认裁剪
  const confirmCrop = () => {
    if (!canvasInstance.current || editStateRef.current.mode !== 'crop') return;
    
    const cropZone = canvasInstance.current.getObjects().find(obj => (obj as any)._isCropZone) as fabric.Rect;
    const image = editStateRef.current.selectedImage;
    
    if (!cropZone || !image) {
      exitCropMode();
      return;
    }
    
    try {
      const cropCenter = cropZone.getCenterPoint();
      const invertedMatrix = fabric.util.invertTransform(image.calcTransformMatrix());
      const localPoint = fabric.util.transformPoint(cropCenter, invertedMatrix);
      const currentWidth = Math.max(1, Number(image.width) || 1);
      const currentHeight = Math.max(1, Number(image.height) || 1);
      const currentCropX = Math.max(0, Number(image.cropX) || 0);
      const currentCropY = Math.max(0, Number(image.cropY) || 0);
      const scaleX = Number(image.scaleX) || 1;
      const scaleY = Number(image.scaleY) || 1;
      const absScaleX = Math.max(1e-6, Math.abs(scaleX));
      const absScaleY = Math.max(1e-6, Math.abs(scaleY));
      const signedScaleX = scaleX >= 0 ? 1 : -1;
      const signedScaleY = scaleY >= 0 ? 1 : -1;
      const imageNaturalSize = getImageIntrinsicSize(image);
      const naturalWidth = Math.max(1, Number((image as any)._assetNaturalWidth) || imageNaturalSize.naturalWidth || currentWidth);
      const naturalHeight = Math.max(1, Number((image as any)._assetNaturalHeight) || imageNaturalSize.naturalHeight || currentHeight);
      const localCenterX = localPoint.x + currentWidth / 2;
      const localCenterY = localPoint.y + currentHeight / 2;
      const zoneWidthInSource = cropZone.getScaledWidth() / absScaleX;
      const zoneHeightInSource = cropZone.getScaledHeight() / absScaleY;
      const unclampedWidth = Math.max(1, zoneWidthInSource);
      const unclampedHeight = Math.max(1, zoneHeightInSource);
      const nextWidth = Math.min(currentWidth, naturalWidth, unclampedWidth);
      const nextHeight = Math.min(currentHeight, naturalHeight, unclampedHeight);
      let nextCropX = currentCropX + (localCenterX - nextWidth / 2);
      let nextCropY = currentCropY + (localCenterY - nextHeight / 2);
      const maxCropX = Math.max(0, naturalWidth - nextWidth);
      const maxCropY = Math.max(0, naturalHeight - nextHeight);
      nextCropX = Math.min(maxCropX, Math.max(0, nextCropX));
      nextCropY = Math.min(maxCropY, Math.max(0, nextCropY));
      image.set({
        cropX: nextCropX,
        cropY: nextCropY,
        width: nextWidth,
        height: nextHeight,
        scaleX: signedScaleX * absScaleX,
        scaleY: signedScaleY * absScaleY,
      });
      image.setPositionByOrigin(cropCenter, 'center', 'center');
      image.set({ opacity: 1 });
      (image as any)._assetNaturalWidth = naturalWidth;
      (image as any)._assetNaturalHeight = naturalHeight;
      syncRelativeCropProps(image);
      console.log('[CanvasEditor] 裁剪完成', { cropX: nextCropX, cropY: nextCropY, width: nextWidth, height: nextHeight });
    } catch (error) {
      console.error('[CanvasEditor] 裁剪计算失败:', error);
    }
    
    exitCropMode();
    saveStateToHistory(); // 保存裁剪后的状态
  };

  // 取消裁剪
  const cancelCrop = () => {
    const image = editStateRef.current.selectedImage;
    if (image) {
      image.set({ opacity: 1 });
    }
    exitCropMode();
  };

  // 退出裁剪模式通用逻辑
  const exitCropMode = () => {
    if (!canvasInstance.current) return;
    
    // 移除 cropZone
    const objects = canvasInstance.current.getObjects();
    const cropZone = objects.find(obj => (obj as any)._isCropZone);
    if (cropZone) {
      canvasInstance.current.remove(cropZone);
    }
    
    const image = editStateRef.current.selectedImage;
    if (image) {
      // 恢复交互
      image.set({
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
      });
      
      // 选中图片
      canvasInstance.current.setActiveObject(image);
      props.onEditModeChange?.(null, null); // 退出 crop 模式，回到默认选择模式
    }
    
    setEditState({
      mode: null,
      selectedFrame: null,
      selectedImage: null, // 清除选中，或者保留？
      selectedText: null,
      isDragging: false,
    });

    canvasInstance.current.defaultCursor = 'default';
    canvasInstance.current.hoverCursor = 'default';
    
    canvasInstance.current.renderAll();
  };

  // 进入相框编辑模式
  const enterFrameEditMode = (frame: fabric.Object) => {
    if (!canvasInstance.current) return;

    const image = getImageInFrame(frame);
    // 移除对图片的强制要求，空相框也可以编辑

    // 保存当前状态到历史
    saveStateToHistory();

    // 设置编辑状态
    setEditState({
      mode: 'frame',
      selectedFrame: frame,
      selectedImage: image, // 可能为null（空相框）
      selectedText: null,
      isDragging: false,
    });

    // 如果有图片，锁定图片，只允许编辑相框
    if (image) {
      image.selectable = false;
      image.evented = false;
    }

    // 核心修复：确保相框层级在图片之上，避免被图片遮挡
    // canvasInstance.current.bringToFront(frame); // 移除此行，避免置顶
    // 强制刷新一次坐标，确保 clipPath 位置同步，但不改变 z-index
    frame.setCoords();
    image?.setCoords();

    // 清理偏移缓存，避免历史值干扰
    (frame as any)._imgOffsetX = undefined;
    (frame as any)._imgOffsetY = undefined;

    // 显示相框编辑手柄和高亮效果（使用对象自身边框，不创建额外图层）
    frame.set({
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      borderColor: '#3b82f6',
      borderDashArray: [10, 5],
      borderScaleFactor: 2,
      cornerColor: '#3b82f6',
      cornerSize: 8,
      cornerStyle: 'circle',
      transparentCorners: false,
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: false,
      lockScalingY: false,
      lockRotation: false,
      // 在编辑模式下显示半透明背景，让用户能看到相框区域
      fill: image ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
      stroke: '#3b82f6',
      strokeWidth: 2,
    });

    // 通知父组件
    props.onEditModeChange?.('frame', frame);

    canvasInstance.current.renderAll();
  };

  // 进入图片编辑模式
  const enterImageEditMode = (image: fabric.Image) => {
    if (!canvasInstance.current) return;
    const frame = getFrameOfImage(image);
    if (!frame) return;

    saveStateToHistory();

    // 相框设置：允许移动和缩放，但使用不同的视觉样式区分
    frame.set({
      selectable: true,      // 保持可选择，允许移动
      evented: true,         // 保持事件响应
      hasControls: true,     // 显示缩放控制点，允许调整大小
      hasBorders: true,      // 显示边框
      borderColor: '#3b82f6', // 蓝色边框，与图片的橙色区分
      borderDashArray: [5, 5], // 虚线边框，与图片的实线区分
      cornerColor: '#3b82f6', // 蓝色控制点
      cornerSize: 6,         // 稍小的控制点
      cornerStyle: 'rect',   // 方形控制点，与图片的圆形区分
      lockMovementX: false,  // 允许水平移动
      lockMovementY: false,  // 允许垂直移动
      lockScalingX: false,   // 允许水平缩放
      lockScalingY: false,   // 允许垂直缩放
      lockRotation: true,    // 锁定旋转
    });

    // 图片启用
    image.set({
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      borderColor: '#f97316',
      borderDashArray: [10, 5],
      borderScaleFactor: 2,
      cornerColor: '#f97316',
      cornerSize: 8,
      cornerStyle: 'circle',
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: false,
      lockScalingY: false,
      lockRotation: true,
    });

    // 核心修复：在图片编辑模式下，确保图片层级在相框之上
    // canvasInstance.current.bringToFront(image); // 移除此行，避免置顶
    image.setCoords();
    frame.setCoords();

    setEditState({ mode: 'image', selectedFrame: frame, selectedImage: image, selectedText: null, isDragging: false });
    canvasInstance.current.setActiveObject(image);
    props.onEditModeChange?.('image', image);
    canvasInstance.current.renderAll();
  };

  // 退出编辑模式
  const exitEditMode = () => {
    if (!canvasInstance.current) return;

    const { mode, selectedFrame, selectedImage } = editState;

    if (mode === 'frame' && selectedFrame) {
      // 如果有图片，恢复图片可选择性
      if (selectedImage) {
        selectedImage.selectable = true;
        selectedImage.evented = true;
      }

      // 恢复相框默认状态，但保持可编辑性
      selectedFrame.set({
        hasControls: true,  // 保持控件可见
        hasBorders: true,   // 保持边框可见
        borderColor: 'rgba(102, 153, 255, 0.75)',
        cornerColor: 'rgba(102, 153, 255, 0.5)',
        cornerSize: 6,
        cornerStyle: 'rect',
        transparentCorners: true,
        // 确保相框保持可编辑状态
        selectable: true,
        evented: true,
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: true,
        // 恢复透明状态
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
      });
    } else if (mode === 'image' && selectedFrame && selectedImage) {
      // 恢复相框可选择性
      selectedFrame.selectable = true;
      selectedFrame.evented = true;
      // 确保相框在图片编辑模式退出后也保持可编辑
      selectedFrame.set({
        hasControls: true,
        hasBorders: true,
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: true,
      });

      // 关键：让图片在"默认/相框编辑"状态下不可交互
      selectedImage.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        hoverCursor: 'default',
        moveCursor: 'default',
      });

      // 核心修复：确保相框层级在图片之上，避免图片遮挡相框
      // canvasInstance.current.bringToFront(selectedFrame); // 移除此行，避免置顶
      selectedFrame.setCoords();
      selectedImage.setCoords();

      // 关键修复：退出图片编辑模式后，自动选中相框并进入相框编辑模式
      canvasInstance.current.setActiveObject(selectedFrame);
      
      // 设置相框的正确编辑样式
      selectedFrame.set({
        hasControls: true,
        hasBorders: true,
        borderColor: '#3b82f6',
        borderDashArray: [10, 5],
        borderScaleFactor: 2,
        cornerColor: '#3b82f6',
        cornerSize: 8,
        cornerStyle: 'circle',
        transparentCorners: false,
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: true,
        // 在编辑模式下显示半透明背景，让用户能看到相框区域
        fill: selectedImage ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
        stroke: '#3b82f6',
        strokeWidth: 2,
      });
      
      // 进入相框编辑模式，而不是完全退出编辑
      setEditState({
        mode: 'frame',
        selectedFrame: selectedFrame,
        selectedImage: selectedImage,
        selectedText: null,
        isDragging: false,
      });

      // 通知父组件进入相框编辑模式
      props.onEditModeChange?.('frame', selectedFrame);

      // 强制重新渲染画布
      canvasInstance.current.renderAll();
      return; // 提前返回，不执行下面的完全退出逻辑
    }

    // 只有在相框编辑模式或其他情况下才完全退出
    // 显式清空画布的活动对象选择
    canvasInstance.current.discardActiveObject();
    
    // 重置编辑状态
    setEditState({
      mode: null,
      selectedFrame: null,
      selectedImage: null,
      selectedText: null,
      isDragging: false,
    });

    // 通知父组件
    props.onEditModeChange?.(null, null);

    // 强制重新渲染画布
    canvasInstance.current.renderAll();
  };

  // 设置相框的原生选择样式
  const setFrameSelectionStyle = (frame: fabric.Object, isSelected: boolean) => {
    if (isSelected) {
      frame.set({
        borderColor: '#3b82f6',
        borderDashArray: [10, 5],
        borderScaleFactor: 2,
        hasBorders: true,
        hasControls: true,
      });
    } else {
      frame.set({
        hasBorders: false,
        hasControls: false,
      });
    }
  };

  // 保存状态到历史
  // 原始的保存状态函数
  const saveStateToHistoryImmediate = () => {
    if (!canvasInstance.current) return;

    // 关键修复：保存所有自定义属性，防止撤回时丢失
    const state = canvasInstance.current.toJSON(CANVAS_CUSTOM_PROPS);
    historyManagerRef.current.push(state);
    
    // 通知外部变化
    props.onChange?.();
  };

  const applyImageAdjustmentsInternal = (image: fabric.Image, adjustments: ImageAdjustments, skipHistory: boolean) => {
    if (!canvasInstance.current || !image) return;
    const normalized = normalizeImageAdjustments(adjustments);
    (image as any)._imageAdjustments = normalized;
    const frame = getFrameOfImage(image);
    if (frame) {
      (frame as any)._imageAdjustments = normalized;
    }
    image.filters = buildImageFilters(normalized);
    (image as any)._originalFilters = image.filters;
    image.applyFilters();
    canvasInstance.current.requestRenderAll();
    if (!skipHistory) {
      saveStateToHistoryImmediate();
    }
  };

  const removeImageStrokeOverlay = (image: fabric.Image) => {
    const overlay = (image as any)._strokeOverlay as fabric.Image | undefined;
    if (overlay && canvasInstance.current) {
      canvasInstance.current.remove(overlay);
    }
    (image as any)._strokeOverlay = null;
  };

  const syncImageStrokeOverlay = (image: fabric.Image) => {
    const overlay = (image as any)._strokeOverlay as fabric.Image | undefined;
    if (!overlay) return;
    const renderScale = (image as any)._strokeRenderScale || 1;
    const center = image.getCenterPoint();
    overlay.set({
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
    });
    overlay.setCoords();
  };

  const applyImageStrokeInternal = async (image: fabric.Image, settings: ImageStrokeSettings, skipHistory: boolean) => {
    if (!canvasInstance.current || !image) return;
    const normalized = normalizeImageStrokeSettings(settings);
    (image as any)._imageStrokeSettings = normalized;
    const frame = getFrameOfImage(image);
    if (frame) {
      (frame as any)._imageStrokeSettings = normalized;
    }
    const isUnderlayStroke = normalized.style === 'regular' || normalized.style === 'double-regular';
    const singleStrokeHidden = normalized.opacity <= 0 || normalized.thickness <= 0;
    const doubleStrokeHidden = normalized.innerLayer.opacity <= 0 && normalized.outerLayer.opacity <= 0;
    (image as any)._strokeJobId = ((image as any)._strokeJobId || 0) + 1;
    const jobId = (image as any)._strokeJobId;
    if (
      normalized.style === 'none' ||
      (!isUnderlayStroke && singleStrokeHidden) ||
      (normalized.style === 'double-regular' && doubleStrokeHidden)
    ) {
      removeImageStrokeOverlay(image);
      if (!skipHistory) {
        saveStateToHistoryImmediate();
      }
      return;
    }
    try {
      const result = await buildStrokeCanvas(image, normalized);
      if ((image as any)._strokeJobId !== jobId) return;
      if (!result) {
        removeImageStrokeOverlay(image);
        if (!skipHistory) {
          saveStateToHistoryImmediate();
        }
        return;
      }
      const { canvas, padding, renderScale } = result;
      const center = image.getCenterPoint();
      let overlay = (image as any)._strokeOverlay as fabric.Image | undefined;
      if (!overlay) {
        overlay = new fabric.Image(canvas, {
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
          excludeFromExport: true,
        });
        (overlay as any)._isStrokeOverlay = true;
        (overlay as any)._assetUploadStatus = 'generated';
        (image as any)._strokeOverlay = overlay;
        canvasInstance.current.add(overlay);
      } else {
        overlay.setElement(canvas);
        overlay.set({
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
        });
        (overlay as any)._isStrokeOverlay = true;
        (overlay as any)._assetUploadStatus = 'generated';
      }
      (image as any)._strokePadding = padding;
      (image as any)._strokeRenderScale = renderScale;
      const imageIndex = canvasInstance.current.getObjects().indexOf(image);
      if (imageIndex >= 0 && overlay) {
        canvasInstance.current.moveTo(overlay, isUnderlayStroke ? imageIndex : imageIndex + 1);
      }
      overlay.setCoords();
      canvasInstance.current.requestRenderAll();
      if (!skipHistory) {
        saveStateToHistoryImmediate();
      }
    } catch (error) {
      console.error('[CanvasEditor] Image stroke failed:', error);
    }
  };

  const applyTextFormatInternal = (textObject: fabric.IText, options: any, skipHistory: boolean) => {
    if (!textObject || !canvasInstance.current) return;
    const previousState = textObject.toObject(['curve', 'path', 'stroke', 'strokeWidth']);
    const { curve, ...otherOptions } = options;
    if (typeof otherOptions.fontFamily === 'string') {
      const normalizedFontFamily = otherOptions.fontFamily.trim();
      if (normalizedFontFamily) {
        otherOptions.fontFamily = normalizedFontFamily;
      } else {
        delete otherOptions.fontFamily;
      }
      const textStyles = (textObject as any).styles;
      if (textStyles && typeof textStyles === 'object') {
        Object.values(textStyles).forEach((line: any) => {
          if (!line || typeof line !== 'object') return;
          Object.values(line).forEach((charStyle: any) => {
            if (charStyle && typeof charStyle === 'object' && 'fontFamily' in charStyle) {
              delete charStyle.fontFamily;
            }
          });
        });
      }
    }
    if (Object.keys(otherOptions).length > 0) {
      textObject.set(otherOptions);
    }
    const hasStrokeChange = Object.prototype.hasOwnProperty.call(otherOptions, 'stroke')
      || Object.prototype.hasOwnProperty.call(otherOptions, 'strokeWidth');
    if (hasStrokeChange) {
      const center = textObject.getCenterPoint();
      textObject.set({
        paintFirst: 'stroke',
        strokeUniform: true,
        strokeLineJoin: 'round',
        strokeMiterLimit: 2,
        originX: 'center',
        originY: 'center',
      });
      textObject.setPositionByOrigin(center, 'center', 'center');
    }
    const nextFontSize = (otherOptions.fontSize as number) ?? textObject.fontSize ?? ARC_BASE_FONT_SIZE;
    if (curve !== undefined) {
      (textObject as any).curve = curve;
      if (curve === 0) {
        textObject.set('path', null);
      } else {
        const radius = getArcRadius(curve, nextFontSize);
        const path = buildCirclePath(radius, curve > 0);
        textObject.set('path', path);
      }
    }
    if (curve === undefined) {
      const existingCurve = (textObject as any).curve || 0;
      if (existingCurve !== 0 && otherOptions.fontSize !== undefined) {
        const radius = getArcRadius(existingCurve, nextFontSize);
        const path = buildCirclePath(radius, existingCurve > 0);
        textObject.set('path', path);
      }
    }
    const currentState = textObject.toObject(['curve', 'path', 'stroke', 'strokeWidth']);
    if (!skipHistory) {
      historyManagerRef.current.push(new TextTransformCommand(
        textObject,
        previousState,
        currentState
      ));
    }
    textObject.dirty = true;
    textObject.initDimensions();
    textObject.setCoords();
    canvasInstance.current.requestRenderAll();
  };

  const getFormatBrushType = (obj: fabric.Object): FormatBrushType => {
    if (isTextObject(obj)) return 'text';
    if (isFrameObject(obj) || isFrameImage(obj)) return 'frame-image';
    if (isImageObject(obj)) return 'image';
    return null;
  };

  const clearFormatBrush = () => {
    if (!canvasInstance.current) return;
    if (!formatBrushRef.current.active) return;
    const rect = formatBrushSelectionRef.current.rect;
    if (rect) {
      canvasInstance.current.remove(rect);
    }
    formatBrushSelectionRef.current = { start: null, rect: null, dragging: false };
    formatBrushRef.current = { active: false, sourceType: null };
    canvasInstance.current.defaultCursor = 'default';
    canvasInstance.current.hoverCursor = 'default';
    canvasInstance.current.selection = true;
    props.onFormatBrushChange?.(false, null);
    canvasInstance.current.requestRenderAll();
  };

  const activateFormatBrushFromObject = (source: fabric.Object) => {
    if (!canvasInstance.current) return;
    if (editStateRef.current.mode === 'crop') return;
    const sourceType = getFormatBrushType(source);
    if (!sourceType) return;
    const nextState: typeof formatBrushRef.current = { active: true, sourceType };
    if (sourceType === 'text') {
      const textObj = source as fabric.IText;
      nextState.textOptions = {
        fontFamily: textObj.fontFamily,
        fontSize: textObj.fontSize,
        fill: textObj.fill,
        charSpacing: textObj.charSpacing,
        stroke: textObj.stroke,
        strokeWidth: textObj.strokeWidth,
        paintFirst: textObj.paintFirst,
        fontWeight: textObj.fontWeight,
        fontStyle: textObj.fontStyle,
        textAlign: textObj.textAlign,
        underline: textObj.underline,
        linethrough: textObj.linethrough,
        overline: textObj.overline,
        opacity: textObj.opacity,
        shadow: textObj.shadow,
        lineHeight: textObj.lineHeight,
        backgroundColor: (textObj as any).backgroundColor,
        curve: (textObj as any).curve || 0,
      };
    } else if (sourceType === 'image') {
      const imageObj = source as fabric.Image;
      if (!isFreeImage(imageObj)) return;
      nextState.imageAdjustments = normalizeImageAdjustments((imageObj as any)._imageAdjustments ?? DEFAULT_IMAGE_ADJUSTMENTS);
      nextState.imageStrokeSettings = normalizeImageStrokeSettings((imageObj as any)._imageStrokeSettings ?? DEFAULT_IMAGE_STROKE_SETTINGS);
      nextState.imageOpacity = imageObj.opacity;
    } else if (sourceType === 'frame-image') {
      const sourceImage = isFrameImage(source)
        ? (source as fabric.Image)
        : isFrameObject(source)
          ? getImageInFrame(source)
          : null;
      if (!sourceImage) return;
      nextState.imageAdjustments = normalizeImageAdjustments((sourceImage as any)._imageAdjustments ?? DEFAULT_IMAGE_ADJUSTMENTS);
      nextState.imageStrokeSettings = normalizeImageStrokeSettings((sourceImage as any)._imageStrokeSettings ?? DEFAULT_IMAGE_STROKE_SETTINGS);
      nextState.imageOpacity = sourceImage.opacity;
    }
    formatBrushRef.current = nextState;
    canvasInstance.current.defaultCursor = 'copy';
    canvasInstance.current.hoverCursor = 'copy';
    canvasInstance.current.selection = false;
    props.onFormatBrushChange?.(true, sourceType);
  };

  const applyFormatBrushToObject = (target: fabric.Object): boolean => {
    const brush = formatBrushRef.current;
    if (!brush.active || !brush.sourceType) return false;
    if (brush.sourceType === 'text' && isTextObject(target) && brush.textOptions) {
      applyTextFormatInternal(target, brush.textOptions, false);
      return true;
    }
    if (brush.sourceType === 'image' && isFreeImage(target)) {
      const imageTarget = target as fabric.Image;
      if (brush.imageOpacity !== undefined) {
        imageTarget.set({ opacity: brush.imageOpacity });
      }
      if (brush.imageAdjustments) {
        applyImageAdjustmentsInternal(imageTarget, brush.imageAdjustments, true);
      }
      if (brush.imageStrokeSettings) {
        void applyImageStrokeInternal(imageTarget, brush.imageStrokeSettings, true);
      }
      saveStateToHistoryImmediate();
      canvasInstance.current?.requestRenderAll();
      return true;
    }
    if (brush.sourceType === 'frame-image') {
      const imageTarget = isFrameImage(target)
        ? (target as fabric.Image)
        : isFrameObject(target)
          ? getImageInFrame(target)
          : null;
      if (!imageTarget) return false;
      if (brush.imageOpacity !== undefined) {
        imageTarget.set({ opacity: brush.imageOpacity });
      }
      if (brush.imageAdjustments) {
        applyImageAdjustmentsInternal(imageTarget, brush.imageAdjustments, true);
      }
      if (brush.imageStrokeSettings) {
        void applyImageStrokeInternal(imageTarget, brush.imageStrokeSettings, true);
      }
      saveStateToHistoryImmediate();
      canvasInstance.current?.requestRenderAll();
      return true;
    }
    return false;
  };

  const beginFormatBrushSelection = (start: fabric.Point) => {
    if (!canvasInstance.current) return;
    const rect = new fabric.Rect({
      left: start.x,
      top: start.y,
      width: 1,
      height: 1,
      fill: 'rgba(59, 130, 246, 0.08)',
      stroke: '#3b82f6',
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      excludeFromExport: true,
    });
    (rect as any)._isFormatBrushZone = true;
    canvasInstance.current.add(rect);
    formatBrushSelectionRef.current = { start, rect, dragging: true };
    canvasInstance.current.requestRenderAll();
  };

  const updateFormatBrushSelection = (point: fabric.Point) => {
    const selection = formatBrushSelectionRef.current;
    if (!selection.dragging || !selection.start || !selection.rect) return;
    const left = Math.min(selection.start.x, point.x);
    const top = Math.min(selection.start.y, point.y);
    const width = Math.abs(point.x - selection.start.x);
    const height = Math.abs(point.y - selection.start.y);
    selection.rect.set({ left, top, width, height });
    selection.rect.setCoords();
    canvasInstance.current?.requestRenderAll();
  };

  const isRectIntersect = (a: fabric.IBoundingRect, b: fabric.IBoundingRect) => {
    return a.left < b.left + b.width &&
      a.left + a.width > b.left &&
      a.top < b.top + b.height &&
      a.top + a.height > b.top;
  };

  const finishFormatBrushSelection = () => {
    if (!canvasInstance.current) return;
    const selection = formatBrushSelectionRef.current;
    if (!selection.dragging || !selection.rect) return;
    const rect = selection.rect;
    const bounds = rect.getBoundingRect();
    const objects = canvasInstance.current.getObjects();
    let appliedCount = 0;
    objects.forEach((obj) => {
      if (obj === rect) return;
      if ((obj as any)._isCropZone) return;
      if (formatBrushRef.current.sourceType === 'text' && isTextObject(obj)) {
        const objBounds = obj.getBoundingRect(true);
        if (isRectIntersect(bounds, objBounds)) {
          if (applyFormatBrushToObject(obj)) appliedCount += 1;
        }
      }
      if (formatBrushRef.current.sourceType === 'image' && isFreeImage(obj)) {
        const objBounds = obj.getBoundingRect(true);
        if (isRectIntersect(bounds, objBounds)) {
          if (applyFormatBrushToObject(obj)) appliedCount += 1;
        }
      }
      if (formatBrushRef.current.sourceType === 'frame-image' && isFrameObject(obj)) {
        const objBounds = obj.getBoundingRect(true);
        if (isRectIntersect(bounds, objBounds)) {
          if (applyFormatBrushToObject(obj)) appliedCount += 1;
        }
      }
    });
    canvasInstance.current.remove(rect);
    formatBrushSelectionRef.current = { start: null, rect: null, dragging: false };
    if (appliedCount > 0) {
      clearFormatBrush();
    } else {
      canvasInstance.current.requestRenderAll();
    }
  };

  const nudgeSelection = (direction: 'up' | 'down' | 'left' | 'right', step: number = 1): boolean => {
    if (!canvasInstance.current || lockedRef.current) return false;
    const canvas = canvasInstance.current;
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as fabric.IText).isEditing) return false;

    const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
    const deltaX = direction === 'left' ? -safeStep : direction === 'right' ? safeStep : 0;
    const deltaY = direction === 'up' ? -safeStep : direction === 'down' ? safeStep : 0;
    if (deltaX === 0 && deltaY === 0) return false;

    const baseTargets = activeObject.type === 'activeSelection'
      ? (activeObject as fabric.ActiveSelection).getObjects()
      : [activeObject];
    const selectedSet = new Set(baseTargets);
    const movedSet = new Set<fabric.Object>();

    const moveObject = (obj: fabric.Object | null) => {
      if (!obj || movedSet.has(obj)) return;
      obj.set({
        left: (obj.left || 0) + deltaX,
        top: (obj.top || 0) + deltaY
      });
      obj.setCoords();
      if (isImageObject(obj)) {
        syncImageStrokeOverlay(obj as fabric.Image);
      }
      movedSet.add(obj);
    };

    baseTargets.forEach((obj) => {
      if (isFrameObject(obj)) {
        moveObject(obj);
        const image = getImageInFrame(obj);
        if (image && !selectedSet.has(image)) {
          moveObject(image);
        }
        syncClipPathOnTransform(obj);
        return;
      }

      if (isFrameImage(obj)) {
        moveObject(obj);
        const frame = getFrameOfImage(obj as fabric.Image);
        if (frame && !selectedSet.has(frame)) {
          moveObject(frame);
          syncClipPathOnTransform(frame);
        }
        return;
      }

      moveObject(obj);
    });

    if (movedSet.size === 0) return false;
    canvas.requestRenderAll();
    saveStateToHistoryImmediate();
    return true;
  };

  // 防抖版本的保存状态函数，避免频繁保存
  const saveStateToHistory = debounce(saveStateToHistoryImmediate, 500);

  // 撤销
  const undo = () => {
    const state = historyManagerRef.current.undo();
    if (state && canvasInstance.current) {
      canvasInstance.current.loadFromJSON(state, () => {
        // 关键修复：撤回后重建配对关系
        rebuildFrameImagePairs();
        
        // 强制重置编辑状态，防止引用失效
        setEditState({
          mode: null,
          selectedFrame: null,
          selectedImage: null,
          selectedText: null,
          isDragging: false
        });
        props.onEditModeChange?.(null, null);

        // 清除残留的视觉效果
        clearUnselectedVisuals();
        
        canvasInstance.current?.renderAll();
        notifyObjectCountChange();
        props.onSelectionChange?.(null);
      });
    }
  };

  // 重做
  const redo = () => {
    const state = historyManagerRef.current.redo();
    if (state && canvasInstance.current) {
      canvasInstance.current.loadFromJSON(state, () => {
        // 关键修复：重做后重建配对关系
        rebuildFrameImagePairs();
        
        // 强制重置编辑状态
        setEditState({
          mode: null,
          selectedFrame: null,
          selectedImage: null,
          selectedText: null,
          isDragging: false
        });
        props.onEditModeChange?.(null, null);

        clearUnselectedVisuals();

        canvasInstance.current?.renderAll();
        notifyObjectCountChange();
        props.onSelectionChange?.(null);
      });
    }
  };

  // 删除选中对象
  const deleteSelected = () => {
    if (!canvasInstance.current) return;

    const activeObject = canvasInstance.current.getActiveObject();
    if (!activeObject) return;

    // 保存状态到历史记录
    saveStateToHistory();
    let shouldRemoveActiveObject = true;

    // 如果删除的是相框，同时删除对应的图片
    if (isFrameObject(activeObject)) {
      const image = getImageInFrame(activeObject);
      if (image) {
        cleanupObject(image);
        canvasInstance.current.remove(image);
      }
      // 如果当前在相框编辑模式，退出编辑模式
      if (editState.mode === 'frame' && editState.selectedFrame === activeObject) {
        setEditState({
          mode: null,
          selectedFrame: null,
          selectedImage: null,
          selectedText: null,
          isDragging: false
        });
        props.onEditModeChange?.(null, null);
      }
    }
    
    // 如果删除的是相框内的图片，只删除图片，保留相框
    else if (isImageObject(activeObject) && (activeObject as any)._isFrameImage) {
      cleanupObject(activeObject as fabric.Image);
      const frame = getFrameOfImage(activeObject as fabric.Image);
      canvasInstance.current.remove(activeObject);
      shouldRemoveActiveObject = false;
      if (frame) {
        (frame as any)._isEmptyFrame = true;
        (frame as any)._imageId = null;
        canvasInstance.current.setActiveObject(frame);
        enterFrameEditMode(frame);
      }
      // 如果当前在图片编辑模式，退出编辑模式并选中相框
      if (editState.mode === 'image' && editState.selectedImage === activeObject) {
        if (!frame) {
          setEditState({
            mode: null,
            selectedFrame: null,
            selectedImage: null,
            selectedText: null,
            isDragging: false
          });
          props.onEditModeChange?.(null, null);
        }
      }
    }
    
    // 如果删除的是普通图片或其他元素
    else {
      // 如果当前有编辑模式，退出编辑模式
      if (editState.mode !== null) {
        setEditState({
          mode: null,
          selectedFrame: null,
          selectedImage: null,
          selectedText: null,
          isDragging: false
        });
        props.onEditModeChange?.(null, null);
      }
    }

    // 删除选中的对象
    if (shouldRemoveActiveObject) {
      cleanupObject(activeObject);
      canvasInstance.current.remove(activeObject);
    }
    canvasInstance.current.discardActiveObject();
    canvasInstance.current.renderAll();
    
    // 通知选择变化
    props.onSelectionChange?.(null);
    
    // 通知对象数量变化
    notifyObjectCountChange();
  };

  // 更新图片编辑模式的视觉反馈 - 使用批量渲染优化
  const updateImageEditModeVisuals = debounce(() => {
    if (!validateCanvas('updateImageEditModeVisuals')) return;

    const { mode } = editState;

    if (mode === 'image') {
      // 不创建遮罩/额外边框，仅批量渲染
      batchRender();
    }
  }, 50); // 50ms防抖

  // 监听图片变换事件
  const handleImageTransform = (e: fabric.IEvent) => {
    const target = e.target;
    if (!target || !isImageObject(target)) return;

    updateImageEditModeVisuals();
  };

  // 同步 imageBorder
  const syncImageBorder = (image: fabric.Object) => {
    // 移除 imageBorder 相关逻辑
  };

  const loadCanvasDataInternal = async (data: string) => {
    if (!canvasInstance.current) return;
    try {
      const { canvasData } = await deserializeCanvasData(data);
      const jsonData = normalizeCanvasJsonForLoad(JSON.parse(canvasData));
      if (!jsonData || !Array.isArray(jsonData.objects)) {
        throw new Error('画布数据结构无效');
      }
      const canvas = canvasInstance.current;
      const prevRenderFlag = canvas.renderOnAddRemove;
      canvas.renderOnAddRemove = false;
      canvas.loadFromJSON(jsonData, () => {
        setupCanvasEvents();
        const objects = canvas.getObjects();
        objects.forEach((obj, index) => {
          if (isFrameObject(obj) && (obj as any)._isEmptyFrame) {
            obj.set({
              selectable: true,
              evented: true,
              hasControls: true,
              hasBorders: true,
              hoverCursor: 'pointer',
              moveCursor: 'move',
            });
          }
          if (isFrameObject(obj)) {
            obj.set({
              selectable: true,
              evented: true,
              lockRotation: true,
            });
          }
          if (isImageObject(obj)) {
            obj.set({
              selectable: true,
              evented: true,
            });
            const image = obj as fabric.Image;
            const sourceCandidate = (obj as any)._assetOriginalPath || (obj as any)._assetEditorPath || getImageSource(image) || '';
            const normalizedPath = normalizeImageAssetPath(String(sourceCandidate || ''));
            if (normalizedPath && !normalizedPath.startsWith('data:') && !normalizedPath.startsWith('blob:')) {
              (obj as any)._assetOriginalPath = buildImageVariantPath(normalizedPath, 'original');
              (obj as any)._assetEditorPath = buildImageVariantPath(normalizedPath, 'medium');
              (obj as any)._assetThumbPath = buildImageVariantPath(normalizedPath, 'thumb');
              (obj as any)._assetUploadStatus = 'synced';
            }
            const { naturalWidth, naturalHeight } = getImageIntrinsicSize(image);
            if (naturalWidth > 0) {
              (obj as any)._assetNaturalWidth = naturalWidth;
            }
            if (naturalHeight > 0) {
              (obj as any)._assetNaturalHeight = naturalHeight;
            }
            syncRelativeCropProps(image);
            const adjustments = normalizeImageAdjustments((obj as any)._imageAdjustments ?? DEFAULT_IMAGE_ADJUSTMENTS);
            (obj as any)._imageAdjustments = adjustments;
            applyImageAdjustmentsInternal(image, adjustments, true);
            const strokeSettings = normalizeImageStrokeSettings((obj as any)._imageStrokeSettings ?? DEFAULT_IMAGE_STROKE_SETTINGS);
            (obj as any)._imageStrokeSettings = strokeSettings;
            applyImageStrokeInternal(image, strokeSettings, true);
          }
          if (isTextObject(obj)) {
            obj.set({
              selectable: true,
              evented: true,
              editable: true,
            });
            const curve = (obj as any).curve || 0;
            const fontSize = (obj as any).fontSize || ARC_BASE_FONT_SIZE;
            if (curve !== 0) {
              const radius = getArcRadius(curve, fontSize);
              const path = buildCirclePath(radius, curve > 0);
              obj.set({ path });
            } else {
              obj.set({ path: null });
            }
          }
          (obj as any).__uid = (obj as any).__uid || (obj as any).id || `${Date.now()}-${index}`;
        });
        clearUnselectedVisuals();
        const allObjects = canvas.getObjects();
        allObjects.forEach((obj) => {
          if (isFrameObject(obj)) {
            (obj as any)._lastSyncedAngle = obj.angle || 0;
            syncFrameRotationToImage(obj);
          }
        });
        rebuildFrameImagePairs();
        canvas.renderOnAddRemove = prevRenderFlag;
        canvas.preserveObjectStacking = true;
        canvas.requestRenderAll();
        notifyObjectCountChange();
        console.log('[CanvasEditor] 画布数据加载成功，对象数:', objects.length);
      });
    } catch (error) {
      console.error('[CanvasEditor] 加载画布数据失败:', error);
    }
  };

  // 使用 useImperativeHandle 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    getWidth: () => canvasInstance.current?.getWidth() ?? 0,
    getHeight: () => canvasInstance.current?.getHeight() ?? 0,
    getObjects: () => canvasInstance.current?.getObjects() || [],
    get canvas() { return canvasInstance.current; },
    getBackgroundColor: () => canvasBackground,
    getLayerMetadata: () => {
      if (!canvasInstance.current) return [];
      const json = canvasInstance.current.toJSON(CANVAS_CUSTOM_PROPS);
      return buildCanvasLayerMetadata(json);
    },
    getPendingUploadsCount: () => pendingUploadsRef.current,
    hasUnsyncedImages: () => hasUnsyncedImagesInternal(),
    updateLayerById: (id: string, props: Partial<fabric.Object>) => {
      if (!canvasInstance.current) return false;
      const target = canvasInstance.current.getObjects().find((obj) => (obj as any).__uid === id || (obj as any).id === id);
      if (!target) return false;
      target.set(props);
      target.setCoords();
      canvasInstance.current.requestRenderAll();
      saveStateToHistoryImmediate();
      return true;
    },
    selectLayerById: (id: string) => {
      if (!canvasInstance.current) return;
      const target = canvasInstance.current.getObjects().find((obj) => (obj as any).__uid === id || (obj as any).id === id);
      if (!target) return;
      suppressSelectionCallbacksRef.current = true;
      canvasInstance.current.setActiveObject(target);
      canvasInstance.current.requestRenderAll();
    },
    deleteLayerById: (id: string) => {
      if (!canvasInstance.current) return false;
      const target = canvasInstance.current.getObjects().find((obj) => (obj as any).__uid === id || (obj as any).id === id);
      if (!target) return false;
      cleanupObject(target);
      canvasInstance.current.remove(target);
      canvasInstance.current.discardActiveObject();
      canvasInstance.current.requestRenderAll();
      notifyObjectCountChange();
      saveStateToHistoryImmediate();
      return true;
    },
    addImage: (url: string, options?: fabric.IImageOptions & { _sourceName?: string }) => {
      if (!canvasInstance.current) return;

      fabric.Image.fromURL(url, (img) => {
        // 获取图片原始尺寸
        const originalWidth = img.width || 0;
        const originalHeight = img.height || 0;
        
        // 计算适配画布的尺寸和位置
        const fitData = calculateImageFitToCanvas(originalWidth, originalHeight);
        
        img.set({
          left: options?.left ?? fitData.left,
          top: options?.top ?? fitData.top,
          scaleX: options?.scaleX ?? fitData.scale,
          scaleY: options?.scaleY ?? fitData.scale,
          angle: options?.angle || 0,
          selectable: true,
          hasControls: true,
          hasBorders: true,
          _isImage: true,
          _imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
          _imageStrokeSettings: { ...DEFAULT_IMAGE_STROKE_SETTINGS },
        });

        if ((options as any)?._sourceName) {
          (img as any)._sourceName = (options as any)._sourceName;
        }
        const normalizedPath = normalizeImageAssetPath(url);
        if (normalizedPath && !normalizedPath.startsWith('data:') && !normalizedPath.startsWith('blob:')) {
          assignUploadedAssetToImage(img, normalizedPath);
          syncNaturalSizeAndRelativeCropProps(img);
        } else {
          markImageAsLocal(img);
        }

        canvasInstance.current?.add(img);
        canvasInstance.current?.renderAll();
        
        // 选中新添加的图片
        canvasInstance.current?.setActiveObject(img);
        props.onSelectionChange?.(img);
        
        // 通知对象数量变化
        notifyObjectCountChange();
      }, { crossOrigin: 'anonymous' });
    },
    insertImageFile: async (file: File, targetFrame?: fabric.Object | null) => {
      await insertImageFile(file, targetFrame);
    },

    addText: (text: string, options?: fabric.ITextOptions) => {
      if (!canvasInstance.current) return;
      
      const textObj = new fabric.IText(text, {
        left: 100,
        top: 100,
        fontSize: 40,
        fill: '#000000',
        fontFamily: 'Arial',
        charSpacing: 0,
        editable: true,
        paintFirst: 'stroke',
        strokeUniform: true,
        strokeLineJoin: 'round',
        strokeMiterLimit: 2,
        ...options
      });
      
      // 添加自定义属性用于保存弧度值
      (textObj as any).curve = 0;

      canvasInstance.current.add(textObj);
      canvasInstance.current.setActiveObject(textObj);
      canvasInstance.current.renderAll();
      props.onSelectionChange?.(textObj);
      notifyObjectCountChange();
    },

    updateText: (textObject: fabric.IText, options: any, skipHistory: boolean = false) => {
      applyTextFormatInternal(textObject, options, skipHistory);
    },

    updateImageAdjustments: (image: fabric.Image, adjustments: ImageAdjustments, skipHistory: boolean = false) => {
      if (!image) return;
      applyImageAdjustmentsInternal(image, adjustments, skipHistory);
    },
    updateImageStroke: (image: fabric.Image, settings: ImageStrokeSettings, skipHistory: boolean = false) => {
      if (!image) return;
      applyImageStrokeInternal(image, settings, skipHistory);
    },
    activateFormatBrush: (source: fabric.Object) => {
      activateFormatBrushFromObject(source);
    },
    cancelFormatBrush: () => {
      clearFormatBrush();
    },
    isFormatBrushActive: () => formatBrushRef.current.active,

    exportCanvas: async (
      backgroundType: 'transparent' | 'white' = 'white',
      highResolution: boolean = false,
      maxWidth?: number,
      imageFormat: 'png' | 'jpeg' = 'png',
      quality: number = 1
    ) => {
      if (!canvasInstance.current) return '';
      const canvas = canvasInstance.current;
      
      try {
        const { width: logicalWidth, height: logicalHeight } = getLogicalCanvasSize();
        const safeWidth = Math.max(1, Math.round(logicalWidth));
        const safeHeight = Math.max(1, Math.round(logicalHeight));
        const safeMaxWidth = typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : safeWidth;
        const normalizedQuality = Math.max(0.1, Math.min(1, quality));
        const normalizedFormat = imageFormat === 'jpeg' ? 'jpeg' : 'png';
        const serializedCanvasData = canvas.toJSON(CANVAS_CUSTOM_PROPS) as Record<string, any>;
        const objects = Array.isArray(serializedCanvasData.objects) ? serializedCanvasData.objects : [];
        objects.forEach((node: Record<string, any>) => {
          if (!(node?._isImage || node?._isFrameImage || node?.type === 'image')) return;
          normalizeImageObjectForSerialization(node);
        });
        return await renderCanvasToHighResImage(
          JSON.stringify(serializedCanvasData),
          backgroundType,
          highResolution,
          { width: safeWidth, height: safeHeight },
          {
            maxWidth: safeMaxWidth,
            imageFormat: normalizedFormat,
            quality: normalizedQuality,
            useOriginalAssets: highResolution,
          }
        );
      } catch (error) {
        console.warn('[CanvasEditor] Canvas导出失败，可能是由于CORS污染:', error);
        
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width || 800;
          tempCanvas.height = canvas.height || 600;
          const tempCtx = tempCanvas.getContext('2d');
          
          if (!tempCtx) {
            throw new Error('无法创建临时Canvas上下文');
          }
          
          // 根据背景类型设置背景
          if (backgroundType === 'white') {
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          }
          // 透明背景不需要填充背景色
          
          // 绘制提示信息
          tempCtx.fillStyle = backgroundType === 'transparent' ? '#333333' : '#666666';
          tempCtx.font = '16px Arial';
          tempCtx.textAlign = 'center';
          tempCtx.fillText('设计预览', tempCanvas.width / 2, tempCanvas.height / 2 - 20);
          tempCtx.fillText('(包含外部图片，无法完整导出)', tempCanvas.width / 2, tempCanvas.height / 2 + 20);
          
          if (imageFormat === 'jpeg') {
            return tempCanvas.toDataURL('image/jpeg', Math.max(0.1, Math.min(1, quality)));
          }
          return tempCanvas.toDataURL('image/png');
        } catch (fallbackError) {
          console.error('[CanvasEditor] 备用导出方案也失败:', fallbackError);
          
          // 最后的备用方案：返回一个简单的占位图
          const placeholderCanvas = document.createElement('canvas');
          placeholderCanvas.width = 400;
          placeholderCanvas.height = 300;
          const placeholderCtx = placeholderCanvas.getContext('2d');
          
          if (placeholderCtx) {
            // 根据背景类型设置占位图背景
            if (backgroundType === 'white') {
              placeholderCtx.fillStyle = '#f0f0f0';
              placeholderCtx.fillRect(0, 0, 400, 300);
            }
            
            placeholderCtx.fillStyle = backgroundType === 'transparent' ? '#333333' : '#999999';
            placeholderCtx.font = '14px Arial';
            placeholderCtx.textAlign = 'center';
            placeholderCtx.fillText('无法导出设计预览', 200, 150);
            if (imageFormat === 'jpeg') {
              return placeholderCanvas.toDataURL('image/jpeg', Math.max(0.1, Math.min(1, quality)));
            }
            return placeholderCanvas.toDataURL('image/png');
          }
          
          return '';
        }
      }
    },

    addCircleFrame: (x: number, y: number, radius: number) => {
      console.log('[CanvasEditor] addCircleFrame 调用参数:', { x, y, radius });
      if (!canvasInstance.current) {
        console.warn('[CanvasEditor] 画布未初始化，无法添加相框');
        return;
      }

      console.log('[CanvasEditor] 当前画布对象数:', canvasInstance.current.getObjects().length);
      saveStateToHistory();

      const frameId = generateUniqueId();
      const frame = new fabric.Circle({
        left: x,
        top: y,
        radius: radius,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        originX: 'center',
        originY: 'center',
        // 明确设置锁定属性
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: true,
        // 相框标识属性
        _isFrame: true,
        _frameType: 'circle',
        _frameRadius: radius,
        _isEmptyFrame: true,
        // 分配唯一ID
        __uid: frameId,
        _imageId: null, // 初始时没有绑定图片
      });

      canvasInstance.current.add(frame);
      console.log('[CanvasEditor] 相框已添加，新的对象数:', canvasInstance.current.getObjects().length);
      // 激活相框并进入相框编辑模式，提供即时可见反馈
      canvasInstance.current.setActiveObject(frame);
      enterFrameEditMode(frame);
      canvasInstance.current.renderAll();
      
      // 通知对象数量变化
      notifyObjectCountChange();
    },

    addSquareFrame: (x: number, y: number, width: number, height: number) => {
      if (!canvasInstance.current) return;
      saveStateToHistory();
      const frameId = generateUniqueId();
      const frame = new fabric.Rect({
        left: x,
        top: y,
        width: width,
        height: height,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        originX: 'center',
        originY: 'center',
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: true,
        _isFrame: true,
        _frameType: 'rect',
        _isEmptyFrame: true,
        __uid: frameId,
        _imageId: null,
      });
      canvasInstance.current.add(frame);
      canvasInstance.current.setActiveObject(frame);
      enterFrameEditMode(frame);
      canvasInstance.current.renderAll();
      notifyObjectCountChange();
    },

    uploadImageToFrame: (file: File) => {
      uploadImageToFrame(file);
    },
    getCanvasData: () => {
      if (!canvasInstance.current) return '';
      const canvasData = canvasInstance.current.toJSON(CANVAS_CUSTOM_PROPS) as Record<string, any>;
      const objects = Array.isArray(canvasData.objects) ? canvasData.objects : [];
      canvasData.objects = objects.filter((node: Record<string, any>) => !node?._isStrokeOverlay);
      objects.forEach((node: Record<string, any>) => {
        if (node?._isStrokeOverlay) return;
        if (!(node?._isImage || node?._isFrameImage || node?.type === 'image')) return;
        normalizeImageObjectForSerialization(node);
      });
      return JSON.stringify(canvasData);
    },
    loadCanvasData: (data: string) => {
      void loadCanvasDataInternal(data);
    },
    addTemplateImage: (url: string) => {
      if (!canvasInstance.current) return;
      
      fabric.Image.fromURL(url, (img) => {
        // 获取模板图片原始尺寸
        const originalWidth = img.width || 0;
        const originalHeight = img.height || 0;
        
        // 计算适配画布的尺寸和位置
        const fitData = calculateImageFitToCanvas(originalWidth, originalHeight);
        
        // 修复：使用中心点定位，确保与相框（也是中心定位）在保存/加载时行为一致
        // 同时设置 strokeWidth: 0 防止边框导致的微小位移
        img.set({
          left: canvasInstance.current!.width! / 2,
          top: canvasInstance.current!.height! / 2,
          originX: 'center',
          originY: 'center',
          scaleX: fitData.scale,
          scaleY: fitData.scale,
          strokeWidth: 0,
          selectable: true,
          hasControls: true,
          hasBorders: true,
          _isImage: true,
          _imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS },
          _imageStrokeSettings: { ...DEFAULT_IMAGE_STROKE_SETTINGS },
        });
        
        canvasInstance.current?.add(img);
        canvasInstance.current?.renderAll();
        
        // 选中新添加的模板
        canvasInstance.current?.setActiveObject(img);
        props.onSelectionChange?.(img);
        
        // 通知对象数量变化
        notifyObjectCountChange();
      }, { crossOrigin: 'anonymous' });
    },

    addImageToFrame: (url: string, targetFrame?: fabric.Object, sourceName?: string) => addImageToFrame(url, targetFrame, sourceName),
    nudgeSelection,
    bringForward: () => {
      if (!canvasInstance.current) return;
      
      // 先尝试重建配对，确保最新的配对关系
      rebuildFrameImagePairs();
      
      let activeObject = canvasInstance.current.getActiveObject();
      console.log('[CanvasEditor] bringForward - 选中对象:', activeObject);
      
      // 如果没有活动对象，尝试智能选择可操作的对象
      if (!activeObject) {
        activeObject = findOperableObject();
        if (activeObject) {
          console.log('[CanvasEditor] bringForward - 智能选择对象:', activeObject);
        }
      }
      
      if (activeObject) {
        const { frame, image } = getFrameImagePair(activeObject);
        console.log('[CanvasEditor] bringForward - 相框图片组合:', { frame, image });
        
        // 如果是相框-图片组合，使用组移动
        if (frame && image) {
          console.log('[CanvasEditor] bringForward - 使用组移动向前移动相框图片组合');
          moveGroupForward(frame, image);
        } else {
          // 单独对象的处理
          console.log('[CanvasEditor] bringForward - 移动单独对象');
          canvasInstance.current.bringForward(activeObject);
          canvasInstance.current.renderAll();
        }
        
        // 确保操作后对象可以被选择
        if (!activeObject.selectable) {
          activeObject.set({ selectable: true, evented: true });
        }
        
        // 设置为活动对象以便用户看到操作结果
        canvasInstance.current.setActiveObject(activeObject);
        canvasInstance.current.renderAll();
      } else {
        console.log('[CanvasEditor] bringForward - 没有找到可操作的对象');
      }
    },
    sendBackwards: () => {
      if (!canvasInstance.current) return;
      
      // 先尝试重建配对，确保最新的配对关系
      rebuildFrameImagePairs();
      
      let activeObject = canvasInstance.current.getActiveObject();
      console.log('[CanvasEditor] sendBackwards - 选中对象:', activeObject);
      
      // 如果没有活动对象，尝试智能选择可操作的对象
      if (!activeObject) {
        activeObject = findOperableObject();
        if (activeObject) {
          console.log('[CanvasEditor] sendBackwards - 智能选择对象:', activeObject);
        }
      }
      
      if (activeObject) {
        const { frame, image } = getFrameImagePair(activeObject);
        console.log('[CanvasEditor] sendBackwards - 相框图片组合:', { frame, image });
        
        // 如果是相框-图片组合，使用组移动
        if (frame && image) {
          console.log('[CanvasEditor] sendBackwards - 使用组移动向后移动相框图片组合');
          moveGroupBackward(frame, image);
        } else {
          // 单独对象的处理
          console.log('[CanvasEditor] sendBackwards - 移动单独对象');
          canvasInstance.current.sendBackwards(activeObject);
          canvasInstance.current.renderAll();
        }
        
        // 确保操作后对象可以被选择
        if (!activeObject.selectable) {
          activeObject.set({ selectable: true, evented: true });
        }
        
        // 设置为活动对象以便用户看到操作结果
        canvasInstance.current.setActiveObject(activeObject);
        canvasInstance.current.renderAll();
      } else {
        console.log('[CanvasEditor] sendBackwards - 没有找到可操作的对象');
      }
    },
    bringToFront: () => {
      if (!canvasInstance.current) return;
      
      // 先尝试重建配对，确保最新的配对关系
      rebuildFrameImagePairs();
      
      let activeObject = canvasInstance.current.getActiveObject();
      console.log('[CanvasEditor] bringToFront - 选中对象:', activeObject);
      
      // 如果没有活动对象，尝试智能选择可操作的对象
      if (!activeObject) {
        activeObject = findOperableObject();
        if (activeObject) {
          console.log('[CanvasEditor] bringToFront - 智能选择对象:', activeObject);
        }
      }
      
      if (activeObject) {
        const { frame, image } = getFrameImagePair(activeObject);
        console.log('[CanvasEditor] bringToFront - 相框图片组合:', { frame, image });
        
        // 如果是相框-图片组合，使用组移动
        if (frame && image) {
          console.log('[CanvasEditor] bringToFront - 使用组移动移动相框图片组合到最前');
          moveGroupToFront(frame, image);
        } else {
          // 单独对象的处理
          console.log('[CanvasEditor] bringToFront - 移动单独对象到最前');
          canvasInstance.current.bringToFront(activeObject);
          canvasInstance.current.renderAll();
        }
        
        // 确保操作后对象可以被选择
        if (!activeObject.selectable) {
          activeObject.set({ selectable: true, evented: true });
        }
        
        // 设置为活动对象以便用户看到操作结果
        canvasInstance.current.setActiveObject(activeObject);
        canvasInstance.current.renderAll();
      } else {
        console.log('[CanvasEditor] bringToFront - 没有找到可操作的对象');
      }
    },
    sendToBack: () => {
      if (!canvasInstance.current) return;
      
      // 先尝试重建配对，确保最新的配对关系
      rebuildFrameImagePairs();
      
      let activeObject = canvasInstance.current.getActiveObject();
      console.log('[CanvasEditor] sendToBack - 选中对象:', activeObject);
      
      // 如果没有活动对象，尝试智能选择可操作的对象
      if (!activeObject) {
        activeObject = findOperableObject();
        if (activeObject) {
          console.log('[CanvasEditor] sendToBack - 智能选择对象:', activeObject);
        }
      }
      
      if (activeObject) {
        const { frame, image } = getFrameImagePair(activeObject);
        console.log('[CanvasEditor] sendToBack - 相框图片组合:', { frame, image });
        
        // 如果是相框-图片组合，使用组移动
        if (frame && image) {
          console.log('[CanvasEditor] sendToBack - 使用组移动移动相框图片组合到最后');
          moveGroupToBack(frame, image);
        } else {
          // 单独对象的处理
          console.log('[CanvasEditor] sendToBack - 移动单独对象到最后');
          canvasInstance.current.sendToBack(activeObject);
          canvasInstance.current.renderAll();
        }
        
        // 确保操作后对象可以被选择
        if (!activeObject.selectable) {
          activeObject.set({ selectable: true, evented: true });
        }
        
        // 设置为活动对象以便用户看到操作结果
        canvasInstance.current.setActiveObject(activeObject);
        canvasInstance.current.renderAll();
      } else {
        console.log('[CanvasEditor] sendToBack - 没有找到可操作的对象');
      }
    },
    // 性能控制相关方法
    enableLowResolutionMode,
    disableLowResolutionMode,
    getPerformanceInfo: () => ({
      fps: performanceMonitor.currentFps,
      isLowResolution: canvasInstance.current?.getZoom() < 1 || false
    }),
    
    clearCanvas: () => {
      try {
        console.log('[CanvasEditor] 开始清空画布');
        
        if (!canvasInstance.current) {
          console.warn('[CanvasEditor] canvas实例不存在，无法清空');
          return;
        }
        
        // 保存当前状态到历史，以便撤销
        try {
          saveStateToHistory();
        } catch (error) {
          console.warn('[CanvasEditor] 保存历史状态失败:', error);
        }
        
        // 退出编辑模式
        try {
          exitEditMode();
        } catch (error) {
          console.warn('[CanvasEditor] 退出编辑模式失败:', error);
        }
        
        // 清空画布上的所有对象
        try {
          canvasInstance.current.clear();
          console.log('[CanvasEditor] 画布对象已清空');
        } catch (error) {
          console.error('[CanvasEditor] 清空画布对象失败:', error);
          // 如果 clear() 失败，尝试手动移除所有对象
          try {
            const objects = canvasInstance.current.getObjects();
            objects.forEach(obj => canvasInstance.current?.remove(obj));
            console.log('[CanvasEditor] 手动移除所有对象成功');
          } catch (manualError) {
            console.error('[CanvasEditor] 手动移除对象也失败:', manualError);
          }
        }
        
        // 重新设置画布背景色
        try {
          canvasInstance.current.setBackgroundColor(canvasBackground, () => {
            try {
              canvasInstance.current?.renderAll();
              console.log('[CanvasEditor] 画布重新渲染完成');
            } catch (renderError) {
              console.error('[CanvasEditor] 画布渲染失败:', renderError);
            }
          });
        } catch (error) {
          console.error('[CanvasEditor] 设置背景色失败:', error);
        }
        
        // 清空选中对象状态
        try {
          setSelectedObject(null);
          props.onSelectionChange?.(null);
        } catch (error) {
          console.warn('[CanvasEditor] 清空选中状态失败:', error);
        }
        
        // 通知对象数量变化
        try {
          notifyObjectCountChange();
        } catch (error) {
          console.warn('[CanvasEditor] 通知对象数量变化失败:', error);
        }
        
        console.log('[CanvasEditor] 画布清空完成');
      } catch (error) {
        console.error('[CanvasEditor] 清空画布时发生未知错误:', error);
      }
    },
  }));

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 p-4 overflow-hidden" ref={viewportRef}>
      <div 
        className="bg-white border-2 border-gray-300 shadow-lg rounded-lg overflow-hidden relative"
        style={{
          width: viewportFit.width,
          height: viewportFit.height,
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        ref={canvasContainerRef}
      >
        <canvas 
          ref={canvasRef} 
          className="block" 
          onContextMenu={(e) => e.preventDefault()}
        />

        {showBackgroundControl && (
          <div className="absolute top-2 right-2 z-40 flex items-center gap-2 rounded-md border border-gray-200 bg-white/90 px-2 py-1 shadow">
            <span className="text-xs text-gray-600">底色</span>
            <input
              type="color"
              value={canvasBackground}
              onChange={(e) => setCanvasBackground(e.target.value)}
              className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </div>
        )}
        {/* 右键菜单 */}
        {contextMenu.visible && (
          <div
            className="absolute bg-white border border-gray-300 rounded-lg shadow-lg py-2 z-50"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              minWidth: '150px'
            }}
            onMouseLeave={hideContextMenu}
          >
            <div
              className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
              onClick={() => handleContextMenuAction('bringForward')}
            >
              上移一层
            </div>
            <div
              className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
              onClick={() => handleContextMenuAction('sendBackwards')}
            >
              下移一层
            </div>
            <div className="border-t border-gray-200 my-1"></div>
            <div
              className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
              onClick={() => handleContextMenuAction('bringToFront')}
            >
              置顶
            </div>
            <div
              className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
              onClick={() => handleContextMenuAction('sendToBack')}
            >
              置底
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

CanvasEditor.displayName = 'CanvasEditor';

export default CanvasEditor;
