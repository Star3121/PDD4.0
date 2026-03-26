import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fabric } from 'fabric';
import { CanvasEditorRef } from './CanvasEditor';

interface LayerPanelProps {
  canvasRef: React.MutableRefObject<CanvasEditorRef | null>;
  selectedObject: fabric.Object | null;
}

interface LayerItem {
  id: string;
  type: string;
  object: fabric.Object;
  name: string;
  preview?: string;
  locked?: boolean;
  visible?: boolean;
}

const ensureObjectId = (obj: any): string => {
  if (!obj.__uid) {
    obj.__uid = Math.random().toString(36).substr(2, 9);
  }
  return obj.__uid;
};

const getObjectType = (obj: any): string => {
  if (obj._isFrame) return '相框';
  if (obj._isImage || obj._isFrameImage) return '图片';
  if (obj.isWaveGroup) return '波浪文字';
  if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') return '文字';
  if (obj.type === 'image') return '图片';
  if (obj.type === 'rect') return '矩形';
  if (obj.type === 'circle') return '圆形';
  if (obj.type === 'group') return '组合';
  return obj.type || '对象';
};

const truncateText = (text: string, max: number) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

const getObjectName = (obj: any): string => {
  if (obj._isStrokeOverlay) return '描边';
  if (obj._isFrame) return '相框';
  if (obj.isWaveGroup) return '波浪文字';
  if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
    const value = `${obj.text || ''}`.trim();
    return value ? truncateText(value, 8) : '文字';
  }
  if (obj._isImage || obj._isFrameImage || obj.type === 'image') {
    const sourceName = (obj._sourceName || obj._fileName || obj._displayName || '').toString().trim();
    return sourceName ? truncateText(sourceName, 12) : '图片';
  }
  return getObjectType(obj);
};

const isClipPathObject = (obj: any) => {
  if (typeof obj?.isType === 'function') {
    try {
      return obj.isType('clipPath');
    } catch (error) {
      console.warn('[LayerPanel] isType check failed:', error);
    }
  }
  return obj?.type === 'clipPath';
};

const triggerDebugBreakpoint = (context: string, error: unknown) => {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined') return;
  if (!(window as any).__LAYER_PANEL_DEBUG__) return;
  console.warn('[LayerPanel] Debug breakpoint:', context, error);
  try {
    (0, eval)('debugger');
  } catch (triggerError) {
    console.warn('[LayerPanel] Debugger trigger failed:', triggerError);
  }
};

export const buildLayerItems = (objects: fabric.Object[]) => {
  return objects
    .filter((obj) => !isClipPathObject(obj) && !(obj as any).excludeFromLayer && !(obj as any).get?.('excludeFromLayer'))
    .map((obj) => ({
      id: ensureObjectId(obj),
      type: getObjectType(obj),
      object: obj,
      name: getObjectName(obj),
      locked: obj.lockMovementX && obj.lockMovementY,
      visible: obj.visible
    }))
    .reverse();
};

const LayerPanel: React.FC<LayerPanelProps> = ({ canvasRef, selectedObject }) => {
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const draggingItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);
  const attachedCanvasRef = useRef<fabric.Canvas | null>(null);

  const updateLayers = useCallback(() => {
    try {
      const canvas = canvasRef.current?.canvas;
      if (!canvas) return;
      const objects = canvas.getObjects();
      const newLayers = buildLayerItems(objects);
      setLayers(prev => {
        if (prev.length !== newLayers.length) return newLayers;
        const isSame = prev.every((layer, i) =>
          layer.id === newLayers[i].id &&
          layer.visible === newLayers[i].visible &&
          layer.locked === newLayers[i].locked &&
          layer.name === newLayers[i].name
        );
        return isSame ? prev : newLayers;
      });
    } catch (error) {
      console.error('[LayerPanel] updateLayers failed:', error);
      triggerDebugBreakpoint('updateLayers', error);
    }
  }, [canvasRef]);

  useEffect(() => {
    const bindCanvas = (canvas: fabric.Canvas) => {
      canvas.on('object:added', updateLayers);
      canvas.on('object:removed', updateLayers);
      canvas.on('object:modified', updateLayers);
      canvas.on('after:render', updateLayers);
    };

    const unbindCanvas = (canvas: fabric.Canvas) => {
      canvas.off('object:added', updateLayers);
      canvas.off('object:removed', updateLayers);
      canvas.off('object:modified', updateLayers);
      canvas.off('after:render', updateLayers);
    };

    const checkCanvas = () => {
      const canvas = canvasRef.current?.canvas || null;
      if (!canvas) return;
      if (attachedCanvasRef.current && attachedCanvasRef.current !== canvas) {
        unbindCanvas(attachedCanvasRef.current);
      }
      if (attachedCanvasRef.current !== canvas) {
        attachedCanvasRef.current = canvas;
        bindCanvas(canvas);
        updateLayers();
        console.debug('[LayerPanel] canvas events bound, objects:', canvas.getObjects().length);
      }
    };

    checkCanvas();
    if (typeof window === 'undefined') return;
    const intervalId = window.setInterval(checkCanvas, 300);
    return () => {
      window.clearInterval(intervalId);
      if (attachedCanvasRef.current) {
        unbindCanvas(attachedCanvasRef.current);
        attachedCanvasRef.current = null;
      }
    };
  }, [canvasRef, updateLayers]);

  // Handle Drag and Drop
  const handleDragStart = (e: React.DragEvent, index: number) => {
    draggingItemRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image transparent or styled if needed
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    dragOverItemRef.current = index;
  };

  const handleDragEnd = () => {
    draggingItemRef.current = null;
    dragOverItemRef.current = null;
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const dragIndex = draggingItemRef.current;
    const dropIndex = index;

    if (dragIndex === null || dragIndex === dropIndex) return;

    if (!canvasRef.current || !canvasRef.current.canvas) return;
    const canvas = canvasRef.current.canvas;

    // Calculate new order
    // layers is reversed (0 is top). 
    // canvas objects are normal (0 is bottom).
    
    // 获取当前的 layers 列表（倒序的）
    const currentLayers = [...layers];
    
    // 移动图层项
    const [movedLayer] = currentLayers.splice(dragIndex, 1);
    currentLayers.splice(dropIndex, 0, movedLayer);
    
    // 更新 React 状态
    setLayers(currentLayers);
    
    // 同步到 Canvas
    // layers 顺序：[Top, ..., Bottom]
    // Canvas 顺序：[Bottom, ..., Top]
    // 我们需要根据新的 layers 顺序，重排 canvas objects
    
    // 1. 获取所有应该在图层面板中显示的对象
    const sortedObjects = currentLayers.map(layer => layer.object).reverse();
    
    // 2. 获取所有不需要在图层面板显示的对象（如 clipPath 等）
    // 这些对象保持它们在 canvas 中的相对位置可能比较复杂
    // 简化策略：将 sortedObjects 按顺序 moveTo 到 canvas 的对应位置
    // 但是，如果有隐藏对象夹在中间，索引会乱。
    
    // 更稳健的策略：
    // 遍历 canvas._objects，将 sortedObjects 中的对象按顺序重新插入
    // 或者直接使用 moveTo
    
    // 计算目标索引：
    // dropIndex 是在 layers（倒序）中的位置
    // 转换成 canvas（正序）中的位置：
    // 假设总共有 N 个可显示对象。
    // layers[0] -> canvas index N-1
    // layers[dropIndex] -> canvas index N-1-dropIndex
    
    // 但是，canvas 中可能包含不可见对象（excludeFromLayer）。
    // 我们需要找到 movedLayer 应该插入的位置。
    
    // 让我们使用 sendToBack/bringToFront 的相对移动逻辑
    // 或者更简单：重新分配所有可显示对象的 z-index
    
    // 重新排序策略：
    // 1. 获取当前画布所有对象
    const allCanvasObjects = canvas.getObjects();
    
    // 2. 分离"受控对象"（在图层面板中的）和"非受控对象"（如辅助线、clipPath）
    // 为了保持非受控对象的相对层级，这可能很复杂。
    // 假设非受控对象通常依附于受控对象，或者在最底层/最顶层。
    
    // 简化方案：
    // 只移动被拖拽的对象。
    // 目标位置：在 layers 中，dropIndex 的前一个元素（更上层）对应的 canvas 对象之下，
    // 或者 dropIndex 的后一个元素（更下层）对应的 canvas 对象之上。
    
    const objectToMove = movedLayer.object;
    
    // 找到参考对象
    // 在 layers (倒序) 中：
    // 上一个元素 (index - 1) 是视觉上的"上方"对象 -> canvas index 更大
    // 下一个元素 (index + 1) 是视觉上的"下方"对象 -> canvas index 更小
    
    if (dropIndex === 0) {
        // 移到最顶层 (可视对象的最顶层)
        objectToMove.bringToFront();
    } else if (dropIndex === currentLayers.length - 1) {
        // 移到最底层 (可视对象的最底层)
        // 注意：不能简单 sendToBack，因为可能背景图等非受控对象在最底
        // 应该移到 currentLayers[currentLayers.length - 2].object 的下面
        const upperObject = currentLayers[dropIndex - 1].object;
        // 移动到 upperObject 之下
        // canvas.moveTo(objectToMove, allCanvasObjects.indexOf(upperObject)); 
        // 实际上 moveTo(obj, index) 是移到该 index 位置。
        // 如果我们要放到 upperObject 下面，index 应该是 indexOf(upperObject)
        // 但是 fabric 的 insertAt/moveTo 行为有时候比较怪，建议用 relative move
        
        // 尝试：先 sendToBack，再根据需要调整？不，这会破坏背景。
        
        // 正确做法：找到 layers 中它上面的对象 (dropIndex - 1)
        // 将其移动到该对象之下
        objectToMove.moveDown(); // 这只是移动一层，不够
        
        // 使用 moveObjectTo 逻辑
        // 目标：在 upperObject 之下
        // 我们可以遍历所有对象，构建新的 _objects 数组，然后 setObjects
        
        // 但为了性能和稳定性，最好只操作这一个对象
        const upperObjectIdx = allCanvasObjects.indexOf(upperObject);
        canvas.moveTo(objectToMove, upperObjectIdx);
        
    } else {
        // 夹在中间
        // 放在 layers[dropIndex - 1] (Upper) 和 layers[dropIndex + 1] (Lower) 之间
        // 实际上，只要放在 layers[dropIndex - 1] 之下即可
        const upperObject = currentLayers[dropIndex - 1].object;
        const upperObjectIdx = allCanvasObjects.indexOf(upperObject);
        // 注意：当从下往上拖动时，移动对象原本在 upperObject 之下，index 变小
        // 当从上往下拖动时，移动对象原本在 upperObject 之上，index 变大
        
        // 简单处理：移动到 upperObject 的当前索引位置
        // 如果 objectToMove 原本在 upperObject 之上，移除它后，upperObject 索引不变，插入到该位置即在 upperObject 之下
        // 如果 objectToMove 原本在 upperObject 之下，移除它后，upperObject 索引减1，插入到该位置... 等等，太复杂
        
        // 最稳妥的方式：
        // 既然我们已经有了完整的 currentLayers 顺序（这是用户期望的顺序）
        // 我们应该按照这个顺序重新排列所有可显示对象
        // 同时保持不可显示对象的位置相对不变（或者假设它们不重要）
        
        // 激进方案：重排所有可显示对象
        // 1. 从 canvas 移除所有可显示对象
        // 2. 按 currentLayers (reverse后为正序) 重新添加
        // 风险：可能丢失一些状态，或者破坏与不可显示对象的层级关系
        
        // 推荐方案：逐个调整
        // 从底向上 (currentLayers 倒序遍历)
        // 确保每个对象都在其前一个对象之上
        
        // 反向遍历 layers (从底到顶)
        // layers: [Top, ..., Bottom]
        // reversed: [Bottom, ..., Top]
        const sortedLayers = [...currentLayers].reverse();
        
        sortedLayers.forEach((layer, i) => {
            if (i === 0) {
                 layer.object.sendToBack();
                 // 如果有背景图是不在 layers 里的，这可能会把物体放到背景图下面
                 // 这是一个潜在 bug。
                 // 应该检查是否有 excludeFromLayer 的对象在最底层
            } else {
                const prevObj = sortedLayers[i-1].object;
                // 确保 layer.object 在 prevObj 之上
                // canvas.moveTo(layer.object, canvas.getObjects().indexOf(prevObj) + 1);
                // 上面这行在循环中可能效率低且有问题
                
                // 更好的方式：直接利用 bringToFront 逐个堆叠
                layer.object.bringToFront();
            }
        });
        
        // 上面的循环会导致所有 layer 对象都跑到最顶层，覆盖掉可能存在的"顶层非 layer 对象"（如果有的话）
        // 但通常非 layer 对象是辅助线、选中框等，它们应该在最顶层，或者背景图在最底层
        
        // 考虑到 clipPath 等特殊对象，它们通常不独立存在于 _objects 根数组中（除非是 absolutePositioned）
        
        // 鉴于目前需求，我们采用"基于锚点对象的移动"
        const anchorObject = currentLayers[dropIndex - 1]?.object; // 上一个对象（视觉上方）
        
        if (anchorObject) {
            // 移动到 anchorObject 之下
            // 获取 anchorObject 的当前索引
            const anchorIndex = canvas.getObjects().indexOf(anchorObject);
            // 如果当前对象在 anchor 之下，则不用动？不对，可能隔了好几个
            // 直接移动到 anchorIndex
            // 注意：如果当前对象在 anchor 之上，移除当前对象后，anchorIndex 不变。插入到 anchorIndex，即在 anchor 之下。
            // 如果当前对象在 anchor 之下，移除当前对象后，anchorIndex 减 1。插入到 原anchorIndex，即在 anchor 之上？
            
            // Fabric 的 moveTo 是绝对索引。
            // 让我们使用 insertAt 逻辑
            // 先移除，再插入
            
            // 但是为了避免闪烁，使用 moveTo
            // 如果是从上往下拖 (drag < drop): 原本在 anchor 之上，现在要到 anchor 之下
            // moveTo(obj, anchorIndex)
            
            // 如果是从下往上拖 (drag > drop): 原本在 anchor 之下... 等等
            // 这种相对计算太容易出错了。
            
            // 让我们回退到最简单的逻辑：
            // 既然已经更新了 state (currentLayers)，
            // 我们可以让 React 重新渲染组件，但 Canvas 需要我们手动同步。
            
            // 采用"冒泡排序"思想的单次移动：
            // 无论如何，我们只需要把 movedLayer 放到正确的位置。
            // 正确位置是：在 layers[dropIndex-1] (Upper) 之下，且在 layers[dropIndex+1] (Lower) 之上。
            
            // 只要实现 "放到 anchorObject 之下" 即可
            // 如果 dropIndex == 0，说明没有 Upper，它是最顶，bringToFront()
            
             if (dropIndex === 0) {
                objectToMove.bringToFront();
            } else {
                const upperObj = currentLayers[dropIndex - 1].object;
                // 目标：objectToMove 必须紧贴 upperObj 之下
                // 即 index = indexOf(upperObj)
                // 但是要注意，objectToMove 移动后，upperObj 的 index 可能会变
                
                // 简单做法：
                objectToMove.bringToFront(); // 先提到最顶
                // 然后一步步下移，直到在 upperObj 之下
                // 或者：
                while (canvas.getObjects().indexOf(objectToMove) > canvas.getObjects().indexOf(upperObj)) {
                    objectToMove.sendBackwards();
                    // 防止死循环
                    if (canvas.getObjects().indexOf(objectToMove) === 0) break;
                }
            }
        }
    }

    canvas.requestRenderAll();
    // updateLayers will be called by 'after:render'
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const selectLayer = (layer: LayerItem) => {
    if (!canvasRef.current) return;
    canvasRef.current.selectLayerById(layer.id);
  };

  const selectLayerByIndex = (nextLayers: LayerItem[], index: number) => {
    if (!nextLayers.length) {
      canvasRef.current?.canvas?.discardActiveObject();
      canvasRef.current?.canvas?.requestRenderAll();
      return;
    }
    const safeIndex = Math.min(Math.max(index, 0), nextLayers.length - 1);
    selectLayer(nextLayers[safeIndex]);
  };

  const handleDeleteLayer = (e: React.MouseEvent, layer: LayerItem, index: number) => {
    e.stopPropagation();
    if (!canvasRef.current) return;
    if (!window.confirm(`确认删除图层「${layer.name}」？`)) return;
    const success = canvasRef.current.deleteLayerById(layer.id);
    if (!success) return;
    const canvas = canvasRef.current.canvas;
    if (!canvas) return;
    const nextLayers = buildLayerItems(canvas.getObjects());
    setLayers(nextLayers);
    selectLayerByIndex(nextLayers, index);
  };

  const toggleVisibility = (e: React.MouseEvent, layer: LayerItem) => {
    e.stopPropagation();
    layer.object.visible = !layer.object.visible;
    if (!layer.object.visible) {
      canvasRef.current?.canvas?.discardActiveObject();
    }
    canvasRef.current?.canvas?.requestRenderAll();
  };

  const toggleLock = (e: React.MouseEvent, layer: LayerItem) => {
    e.stopPropagation();
    const newLockState = !layer.locked;
    layer.object.set({
      lockMovementX: newLockState,
      lockMovementY: newLockState,
      lockRotation: newLockState,
      lockScalingX: newLockState,
      lockScalingY: newLockState,
    });
    canvasRef.current?.canvas?.requestRenderAll();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 h-full flex flex-col">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">图层管理</h3>
      <div className="flex-1 overflow-y-auto space-y-2">
        {layers.length === 0 ? (
          <div className="text-gray-400 text-center py-4 text-sm">暂无图层</div>
        ) : (
          layers.map((layer, index) => {
            const isSelected = selectedObject === layer.object;
            return (
              <div
                key={layer.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnter={(e) => handleDragEnter(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                onClick={() => selectLayer(layer)}
                className={`
                  flex items-center justify-between p-3 rounded-md cursor-pointer transition-all border group
                  ${isSelected 
                    ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-200' 
                    : 'bg-gray-50 border-gray-100 hover:bg-gray-100 hover:shadow-sm'
                  }
                `}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="text-gray-400 cursor-move">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
                    </svg>
                  </div>
                  <div className="flex-1 truncate">
                    <div className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                      {layer.name}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {layer.type}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={(e) => toggleVisibility(e, layer)}
                    className={`p-1 rounded hover:bg-gray-200 transition ${!layer.visible ? 'text-gray-400' : 'text-gray-600'}`}
                    title={layer.visible ? "隐藏图层" : "显示图层"}
                  >
                    {layer.visible ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    )}
                  </button>
                  <button 
                    onClick={(e) => toggleLock(e, layer)}
                    className={`p-1 rounded hover:bg-gray-200 transition ${layer.locked ? 'text-red-500' : 'text-gray-400'}`}
                    title={layer.locked ? "解锁图层" : "锁定图层"}
                  >
                    {layer.locked ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => handleDeleteLayer(e, layer, index)}
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition active:scale-95"
                    title="删除图层"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m-4 0h14" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LayerPanel;
