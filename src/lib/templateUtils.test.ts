import { describe, expect, it } from 'vitest';
import { isTemplateNameUnique, normalizeCanvasSize } from './templateUtils';

describe('templateUtils', () => {
  it('normalizes canvas size to limits', () => {
    const result = normalizeCanvasSize(120, 200);
    expect(result.width).toBeGreaterThanOrEqual(300);
    expect(result.height).toBeGreaterThanOrEqual(300);
  });

  it('checks template name uniqueness', () => {
    const existing = ['测试模板', '示例'];
    expect(isTemplateNameUnique(' 新模板 ', existing)).toBe(true);
    expect(isTemplateNameUnique('示例', existing)).toBe(false);
  });
});
