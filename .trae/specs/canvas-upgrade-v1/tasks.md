# Tasks

- [x] Task 1: Implement Direct Image Upload
  - [x] Create a direct "Upload Image" button in the `DesignEditor` sidebar.
  - [x] Implement `handleFileUpload` to add the uploaded image directly to the canvas or a selected frame.
  - [x] Ensure correct file handling and Base64 conversion.
  - [x] Remove the `MaterialLibrary` component and its usage.

- [x] Task 2: Implement Square Frame
  - [x] Add `addSquareFrame` function to `CanvasEditor.tsx` (clone & modify `addCircleFrame`).
  - [x] Ensure clipping logic works for `fabric.Rect`.
  - [x] Add toolbar button in `DesignEditor`.

- [x] Task 3: Implement Visual Layer Panel
  - [x] Create `LayerPanel` component.
  - [x] Implement `getObjects` sync from canvas to React state.
  - [x] Implement drag-and-drop reordering logic.
  - [x] call `canvas.moveTo` on drop and re-render canvas.
  - [x] Replace old buttons in `DesignEditor`.

- [x] Task 4: Implement Text Editor & Wave Effect
  - [x] Add "Add Text" button to toolbar.
  - [x] Create `TextEditor` panel (visible when text selected).
  - [x] Implement basic properties binding (fill, fontSize, fontFamily).
  - [x] Implement Wave Effect logic:
    - [x] Create function to convert `fabric.Text` to `fabric.Group` of characters.
    - [x] Apply sine wave offset to character positions based on slider value.
    - [x] Handle re-rendering on slider change.

- [x] Task 5: Implement Image Advanced Editor
  - [x] Create `ImageEditor` panel (visible when image selected).
  - [x] Implement Filter controls (Brightness, Contrast, etc.) binding to `fabric.Image.filters`.
  - [x] Implement Stroke controls:
    - [x] Regular stroke.
    - [x] Border with padding (requires creating a group with a rect behind the image).
    - [x] Dashed border support.
