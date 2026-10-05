import { describe, expect, it } from 'vitest';
import { chooseEngineKind, isLowEnd, parseOverride } from '@/components/flip/select';

const base = { override: null, reducedMotion: false, webgl: true, lowEnd: false } as const;

describe('引擎选择', () => {
  it('默认 WebGL', () => {
    expect(chooseEngineKind({ ...base })).toBe('webgl');
  });
  it('减少动态效果 → reduced', () => {
    expect(chooseEngineKind({ ...base, reducedMotion: true })).toBe('reduced');
  });
  it('WebGL 不可用或低端设备 → css', () => {
    expect(chooseEngineKind({ ...base, webgl: false })).toBe('css');
    expect(chooseEngineKind({ ...base, lowEnd: true })).toBe('css');
  });
  it('URL 强制优先', () => {
    expect(chooseEngineKind({ ...base, override: 'css' })).toBe('css');
    expect(chooseEngineKind({ ...base, reducedMotion: true, override: 'webgl' })).toBe('webgl');
    expect(chooseEngineKind({ ...base, override: 'webgl', webgl: false })).toBe('css');
    expect(chooseEngineKind({ ...base, override: 'reduced' })).toBe('reduced');
  });
  it('解析 ?flip=', () => {
    expect(parseOverride('?flip=css')).toBe('css');
    expect(parseOverride('?debug=flip&flip=webgl')).toBe('webgl');
    expect(parseOverride('?flip=foo')).toBeNull();
    expect(parseOverride('')).toBeNull();
  });
  it('低端设备判定', () => {
    expect(isLowEnd({ hardwareConcurrency: 2 })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
    expect(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(isLowEnd({})).toBe(false);
  });
});
