# Canvas Upgrade V1 Spec

## Why
The current canvas editing capabilities are basic. Users need more advanced features for creative design, including a material library, varied frame shapes, intuitive layer management, advanced text effects, and image editing tools. This upgrade aims to enhance the user experience and design possibilities.

## What Changes

### 1. Direct Image Upload (New)
- **UI**: A direct "Upload Image" button in the `DesignEditor` sidebar.
- **Functionality**:
  - Implement `handleFileUpload` to add the uploaded image directly to the canvas or a selected frame.
  - Ensure correct file handling and Base64 conversion.
  - (Replaced Material Library with this more direct approach).

### 2. Square Frame (New)
- **UI**: Add "Square Frame" button in toolbar.
- **Functionality**:
  - Implement `addSquareFrame` in `CanvasEditor.tsx`.
  - Logic mirrors `addCircleFrame` but uses `fabric.Rect` for the clip path.
  - Supports drag-and-drop image masking.

### 3. Layer Panel (Visual Upgrade)
- **UI**: Replace "Move Up/Down" buttons with a draggable list `LayerPanel.tsx`.
- **Functionality**:
  - List all canvas objects (reversed order for visual layering).
  - Drag-and-drop reordering updates `canvas.moveTo(object, newIndex)`.
  - Real-time sync with canvas changes.

### 4. Text & Wave Effect (New)
- **UI**: New `TextEditor` panel when text is selected.
- **Functionality**:
  - Basic: Font size, family (upload support), color, spacing.
  - **Wave Effect**:
    - Toggle switch and "Amplitude" slider (-100 to 100).
    - Algorithm: Split text into characters. Calculate `top` offset for each char: `y = amplitude * Math.sin(index * frequency)`.
    - Group characters into a `fabric.Group` or use `fabric.Text` with custom rendering if possible (grouping is more robust for individual char positioning).

### 5. Image Advanced Editing (New)
- **UI**: New `ImageEditor` panel when image is selected.
- **Functionality**:
  - **Filters**: Brightness, Contrast, Hue, Saturation, etc. using `fabric.Image.filters`.
  - **Strokes**:
    1.  **Regular**: `stroke` property on image.
    2.  **Dashed**: `strokeDashArray` on a wrapping `fabric.Rect` or `fabric.Group`.
    3.  **Solid with Padding**: Similar to dashed but solid, using a wrapper object to simulate padding.

## Impact
- **Affected Files**:
  - `src/components/CanvasEditor.tsx`: Core logic updates.
  - `src/pages/DesignEditor.tsx`: UI layout updates.
  - New components in `src/components/`.
- **Dependencies**:
  - `fabric` (already installed).
  - `react-beautiful-dnd` or similar for drag-and-drop layers (need to check if installed, otherwise use standard HTML5 drag-and-drop or a lightweight lib).

## Breaking Changes
- The existing "Move Layer" buttons will be removed.
