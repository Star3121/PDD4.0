import { describe, it, expect } from 'vitest';
import { applyImageCropAndScaleFromRatios, serializeCanvasData, deserializeCanvasData, buildCanvasLayerMetadata } from './utils';

const sampleCanvasJson = {
  version: '5.5.2',
  objects: [
    { type: 'rect', left: 10, top: 20, width: 100, height: 80, scaleX: 1, scaleY: 1, opacity: 0.8, visible: true, __uid: 'a' },
    { type: 'i-text', left: 40, top: 50, width: 60, height: 20, scaleX: 1.2, scaleY: 1.2, opacity: 1, visible: true, __uid: 'b' }
  ]
};

describe('canvas data serialization', () => {
  it('builds layer metadata with expected fields', () => {
    const layers = buildCanvasLayerMetadata(sampleCanvasJson);
    expect(layers).toHaveLength(2);
    expect(layers[0].id).toBe('a');
    expect(layers[1].type).toBe('text');
    expect(layers[1].width).toBeGreaterThan(0);
  });

  it('serializes and deserializes without compression', async () => {
    const raw = JSON.stringify(sampleCanvasJson);
    const wrapped = await serializeCanvasData(raw, { compress: false });
    const parsed = JSON.parse(wrapped);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.meta.objectCount).toBe(2);
    const restored = await deserializeCanvasData(wrapped);
    expect(restored.canvasData).toBe(raw);
  });

  it('returns raw payload for non-envelope data', async () => {
    const raw = JSON.stringify(sampleCanvasJson);
    const restored = await deserializeCanvasData(raw);
    expect(restored.canvasData).toBe(raw);
  });

  it('recomputes crop area against actual original asset size while preserving display size', () => {
    const imageNode: Record<string, any> = {
      width: 512,
      height: 384,
      scaleX: 1.5,
      scaleY: 0.75,
      _assetNaturalWidth: 1024,
      _assetNaturalHeight: 768,
      _cropXRatio: 0.1,
      _cropYRatio: 0.2,
      _cropWidthRatio: 0.5,
      _cropHeightRatio: 0.5
    };
    const changed = applyImageCropAndScaleFromRatios(imageNode, {
      naturalWidth: 3000,
      naturalHeight: 2400,
      preserveDisplaySize: true
    });
    expect(changed).toBe(true);
    expect(imageNode.cropX).toBe(300);
    expect(imageNode.cropY).toBe(480);
    expect(imageNode.width).toBe(1500);
    expect(imageNode.height).toBe(1200);
    expect(imageNode.scaleX).toBeCloseTo(0.512);
    expect(imageNode.scaleY).toBeCloseTo(0.24);
    expect(imageNode._assetNaturalWidth).toBe(3000);
    expect(imageNode._assetNaturalHeight).toBe(2400);
  });

  it('updates asset natural size even when no crop ratios are present', () => {
    const imageNode: Record<string, any> = {
      width: 320,
      height: 240,
      scaleX: 1,
      scaleY: 1,
      _assetNaturalWidth: 1024,
      _assetNaturalHeight: 768
    };
    const changed = applyImageCropAndScaleFromRatios(imageNode, {
      naturalWidth: 2048,
      naturalHeight: 1536,
      preserveDisplaySize: true
    });
    expect(changed).toBe(false);
    expect(imageNode.width).toBe(320);
    expect(imageNode.height).toBe(240);
    expect(imageNode._assetNaturalWidth).toBe(2048);
    expect(imageNode._assetNaturalHeight).toBe(1536);
  });

  it('falls back to full-image scaling when ratios are missing after original asset switch', () => {
    const imageNode: Record<string, any> = {
      width: 1024,
      height: 1024,
      scaleX: 0.8,
      scaleY: 0.6,
      cropX: 0,
      cropY: 0,
      _assetOriginalPath: '/api/files/images/a.png',
      _assetNaturalWidth: 1024,
      _assetNaturalHeight: 1024
    };
    const changed = applyImageCropAndScaleFromRatios(imageNode, {
      naturalWidth: 2496,
      naturalHeight: 2496,
      preserveDisplaySize: true,
      fallbackToFullImageWhenRatiosMissing: true
    });
    expect(changed).toBe(true);
    expect(imageNode.width).toBe(2496);
    expect(imageNode.height).toBe(2496);
    expect(imageNode.scaleX).toBeCloseTo(0.3282051282);
    expect(imageNode.scaleY).toBeCloseTo(0.2461538461);
    expect(imageNode._assetNaturalWidth).toBe(2496);
    expect(imageNode._assetNaturalHeight).toBe(2496);
  });

  it('clamps ratio-derived crop window into natural image bounds', () => {
    const imageNode: Record<string, any> = {
      width: 512,
      height: 512,
      scaleX: 1,
      scaleY: 1,
      _assetNaturalWidth: 1000,
      _assetNaturalHeight: 1000,
      _cropXRatio: 0.95,
      _cropYRatio: 0.8,
      _cropWidthRatio: 0.4,
      _cropHeightRatio: 0.5
    };
    const changed = applyImageCropAndScaleFromRatios(imageNode, {
      naturalWidth: 1000,
      naturalHeight: 1000,
      preserveDisplaySize: false
    });
    expect(changed).toBe(true);
    expect(imageNode.width).toBe(400);
    expect(imageNode.height).toBe(500);
    expect(imageNode.cropX).toBe(600);
    expect(imageNode.cropY).toBe(500);
  });
});
