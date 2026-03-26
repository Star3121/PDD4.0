import { describe, it, expect } from 'vitest';
import { buildLayerItems } from './LayerPanel';

const createObject = (overrides: Record<string, any> = {}) => {
  const base = {
    type: 'rect',
    visible: true,
    lockMovementX: false,
    lockMovementY: false,
    get(key: string) {
      return (this as any)[key];
    }
  };
  return Object.assign(base, overrides);
};

describe('buildLayerItems', () => {
  it('reverses object order and preserves ids', () => {
    const objA = createObject({ type: 'rect', __uid: 'a' });
    const objB = createObject({ type: 'circle', __uid: 'b' });
    const objC = createObject({ type: 'text', __uid: 'c' });
    const items = buildLayerItems([objA, objB, objC]);
    expect(items.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('filters clipPath and excluded objects', () => {
    const objKeep = createObject({ __uid: 'keep' });
    const objClip = createObject({ type: 'clipPath', __uid: 'clip' });
    const objExclude = createObject({ __uid: 'exclude', excludeFromLayer: true });
    const items = buildLayerItems([objKeep, objClip, objExclude]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('keep');
  });

  it('creates ids and resolves layer types', () => {
    const objFrame = createObject({ _isFrame: true });
    const objImage = createObject({ _isImage: true });
    const objText = createObject({ type: 'i-text' });
    const items = buildLayerItems([objFrame, objImage, objText]);
    expect(objFrame.__uid).toBeTruthy();
    expect(objImage.__uid).toBeTruthy();
    expect(objText.__uid).toBeTruthy();
    expect(items.map((item) => item.type)).toEqual(['文字', '图片', '相框']);
  });
});
