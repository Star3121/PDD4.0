# 撤回功能修复与验证指南

## 1. 问题描述
用户反馈在使用“撤回”（Undo）操作后，画布上的相框组件出现功能异常，具体表现为：
- 相框无法调整大小（控制点消失或不可交互）。
- 相框与内部图片的联动关系丢失（旋转/移动相框时图片不跟随）。
- 点击相框无法正确进入编辑模式。

## 2. 问题根因分析
经过代码分析，定位到以下核心问题：

1.  **序列化数据丢失**：
    Fabric.js 的 `toJSON()` 方法默认只序列化标准属性（如 `left`, `top`, `width` 等）。项目中使用的自定义属性（如 `_isFrame`, `_frameId`, `_imageId`, `_isEmptyFrame` 等）未被包含在历史记录中。导致撤回后，恢复的对象变成了普通的矩形/圆形，丢失了“相框”的身份标识。

2.  **对象引用失效**：
    `loadFromJSON` 会销毁旧对象并创建新对象。React 组件中的 `editState` 仍然持有旧对象的引用，导致编辑器状态与画布实际对象不一致。

3.  **关联关系未重建**：
    相框与图片的配对关系（Parent-Child Link）依赖于内存中的对象引用。撤回后，虽然 ID 恢复了，但对象间的直接引用（如 `frame._imageId` 指向的图片对象）未被重新解析和绑定。

## 3. 修复方案

### 3.1 统一自定义属性列表
在 `CanvasEditor.tsx` 中定义了常量 `CANVAS_CUSTOM_PROPS`，包含所有关键的自定义属性：
```typescript
const CANVAS_CUSTOM_PROPS = [
  '_isFrame', '_frameType', '_frameRadius', '_isEmptyFrame',
  '__uid', '_imageId', '_isFrameImage', '_originalScale',
  '_frameId', '_isImage', 'curve', '_imgOffsetX', '_imgOffsetY',
  'id', 'frameId'
];
```

### 3.2 完善序列化逻辑
修改 `saveStateToHistoryImmediate` 和 `getCanvasData`，确保调用 `toJSON(CANVAS_CUSTOM_PROPS)` 时包含上述属性。

### 3.3 增强撤回/重做逻辑
在 `undo` 和 `redo` 方法中，`loadFromJSON` 回调执行后增加以下步骤：
1.  **重建配对**：调用 `rebuildFrameImagePairs()`，根据恢复的 ID 重新绑定相框和图片。
2.  **重置状态**：将 `editState` 重置为 `null`，强制用户重新点击以获取新对象的引用。
3.  **清理视觉**：调用 `clearUnselectedVisuals()` 清除可能残留的选中样式。

## 4. 验证与测试指南

请按照以下步骤验证修复效果：

### 场景一：相框调整大小后的撤回
1.  **操作**：
    - 添加一个相框。
    - 选中相框，调整其大小（例如放大）。
    - 点击“撤回”按钮。
2.  **预期结果**：
    - 相框恢复到调整前的大小。
    - **关键验证**：再次点击该相框，应能正常显示蓝色控制手柄，且能再次调整大小。

### 场景二：相框旋转后的撤回
1.  **操作**：
    - 添加一个相框并上传图片。
    - 旋转相框 45 度（图片应跟随旋转）。
    - 点击“撤回”按钮。
2.  **预期结果**：
    - 相框和图片恢复到旋转前的角度。
    - **关键验证**：再次旋转相框，图片应继续保持同步跟随。

### 场景三：删除图片后的撤回（空相框交互）
1.  **操作**：
    - 选中相框内的图片，点击删除。
    - 此时相框变为空相框。
    - 点击“撤回”按钮。
2.  **预期结果**：
    - 图片恢复显示在相框内。
    - **关键验证**：双击图片应能进入图片编辑模式；单击相框应能进入相框编辑模式。

### 场景四：连续操作撤回
1.  **操作**：
    - 添加相框 -> 移动 -> 缩放 -> 旋转。
    - 连续点击 3 次撤回。
2.  **预期结果**：
    - 画布状态一步步回退。
    - 在任意一步停止撤回后，当前显示的相框都应可交互（可选中、可移动、可缩放）。

## 5. 代码变更摘要
- `src/components/CanvasEditor.tsx`:
  - 新增 `CANVAS_CUSTOM_PROPS` 常量。
  - 修改 `saveStateToHistoryImmediate` 使用自定义属性。
  - 修改 `undo`/`redo` 增加 `rebuildFrameImagePairs` 和状态重置。
  - 修改 `copyCustomProps` 和 `getCanvasData` 使用统一属性列表。
